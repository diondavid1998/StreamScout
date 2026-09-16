'use strict';

/**
 * Swipe to discover: matching what is on the reader's services against the
 * taste their diary already describes.
 *
 * The design and its reasoning live in `docs/swipe-discovery-spec.md`. Two
 * things from it shape every line here and are worth repeating where the code
 * is:
 *
 * 1. **The diary and the catalog do not describe titles the same way.** The
 *    diary knows directors, writers, cast and keywords; the catalog knows
 *    genre, language, decade and the crowd scores. So scoring a candidate on
 *    "directed by someone you rate highly" costs a TMDB call for that title.
 *    Hence two tiers: score everything on what is already cached, and enrich
 *    only the handful that could still change places.
 *
 * 2. **A left swipe is not the opposite of a right one.** Right is a clear
 *    positive. Left means "not tonight", "seen the trailer", or "never again",
 *    and there is no way to tell which — so it suppresses the title and only
 *    counts against its attributes once a value has collected several passes
 *    and no rights at all.
 */

const { readDiary, toPeople } = require('./analytics');
const { ensureAnalyticsDetails, readCachedDetails, readCachedDetailsBulk } = require('./titleCache');

/** Below this many films, a mean is an anecdote. Mirrors the analytics rule. */
const MIN_FILMS_FOR_CONFIDENCE = 3;
/** A diary thinner than this is blended with the crowd rather than trusted. */
const CONFIDENT_DIARY_FILMS = 30;
/** How many candidates tier 2 will pay a TMDB call for. */
const ENRICH_LIMIT = 40;
/** Share of each batch deliberately outside the reader's usual. */
const EXPLORATION_SHARE = 0.2;
/** Passes on one value with no rights before it counts against. */
const SUPPRESS_AFTER_PASSES = 4;

/**
 * What a match on each lens is worth, and how many of them one film may count.
 *
 * Every lens used to contribute equally and without limit, which quietly made
 * the cast lens the loudest thing in the room: a film has one director and
 * fifteen billed actors, so "shares four actors with films you liked" scored
 * four times a shared director, and a genre — which a fifth of the catalog
 * shares — counted the same as the person who made the film.
 *
 * The weights are ordered by how *specific* a shared value is, which is close
 * to the inverse of how many films carry it. A cinematographer is the rarest
 * and most telling: nobody keeps landing on the same one by accident, and it is
 * the clearest statement about what a reader likes to look at. A genre is the
 * broadest thing two films can share and is weighted accordingly — it still
 * counts, it just no longer decides.
 *
 * `maxHits` caps how many values of one lens a single film may bank at all.
 * It is the hard stop; `applyLens` also halves each match after the strongest,
 * so the two together stop breadth of credits standing in for strength of
 * match. Lenses a film carries one of (language, decade) cap at one because a
 * second would mean the data is wrong.
 */
const LENS_WEIGHTS = {
  directors:        { weight: 1.4, maxHits: 2 },
  cinematographers: { weight: 1.2, maxHits: 2 },
  writers:          { weight: 1.1, maxHits: 3 },
  composers:        { weight: 1.0, maxHits: 2 },
  keywords:         { weight: 0.8, maxHits: 4 },
  cast:             { weight: 0.7, maxHits: 3 },
  genres:           { weight: 0.6, maxHits: 3 },
  languages:        { weight: 0.5, maxHits: 1 },
  studios:          { weight: 0.5, maxHits: 2 },
  decades:          { weight: 0.4, maxHits: 1 },
};
const DEFAULT_LENS_WEIGHT = { weight: 1, maxHits: 3 };

function run(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); })
  );
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  );
}

async function ensureDiscoveryTables(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS discovery_swipes (
      user_id    INTEGER NOT NULL,
      item_id    TEXT    NOT NULL,
      -- 'right' saves, 'left' passes. Kept as text rather than a flag because a
      -- third answer ("not interested, ever") is the obvious next addition.
      direction  TEXT    NOT NULL,
      -- What the title was, so a pass can teach without re-fetching it.
      genres_json TEXT   NOT NULL DEFAULT '[]',
      language   TEXT,
      swiped_at  TEXT    NOT NULL,
      PRIMARY KEY (user_id, item_id)
    )`
  );
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_swipes_user ON discovery_swipes(user_id, swiped_at DESC)');
}

// ── The taste profile ───────────────────────────────────────────────────────

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * How much weight a name earns from sheer volume, on top of how it is rated.
 *
 * "Most watched" and "highest rated" are different claims and a recommender
 * needs both: a director someone has seen thirty times is a fact about their
 * viewing whatever the mean says about it. Log-scaled so the first few films
 * count for most of it and a prolific career does not run away with the queue.
 */
function volumeWeight(filmCount) {
  if (!filmCount || filmCount < 1) return 0;
  return 1 + Math.log10(filmCount) / 2;
}

/**
 * How much better than their own average the reader rates each value of each
 * lens, damped by how much evidence there is for it.
 *
 * The damping is the important half. One five-star film by a director is not a
 * preference, and undamped it would outrank a director with twenty films at a
 * steady four — which is the difference between a recommendation and a
 * coincidence.
 *
 * Rewatches and likes contribute beyond the rating, because both are
 * endorsements the rating scale does not carry: a rewatch is the reader
 * spending their time twice, and a like is the unscored yes. Reviews are
 * treated as evidence of engagement rather than of approval — a scathing review
 * is still engagement — so they raise confidence and never direction.
 */
function buildTasteProfile(rows) {
  const rated = rows.filter((r) => r.rating !== null);
  const overallMean = mean(rated.map((r) => r.rating));
  const films = new Set(rows.map((r) => r.filmKey)).size;

  const LENSES = {
    genres:    (r) => r.genres,
    languages: (r) => [r.language],
    decades:   (r) => [r.year ? `${Math.floor(r.year / 10) * 10}s` : null],
    directors: (r) => r.directors,
    cast:      (r) => r.cast,
    writers:   (r) => r.writers,
    // The two crew lenses the diary has always carried and this file never
    // read. A cinematographer is the strongest style signal on a film after the
    // director — someone who keeps returning to Deakins or Doyle is describing
    // what they like to look at, not a coincidence — and a composer is the same
    // claim about how a film sounds. Both cost nothing: they are already in the
    // cached payload and already normalised onto every diary row.
    cinematographers: (r) => r.cinematographers,
    composers: (r) => r.composers,
    keywords:  (r) => r.keywords,
    studios:   (r) => r.studios,
  };

  const affinities = {};
  for (const [lens, keysOf] of Object.entries(LENSES)) {
    const byValue = new Map();
    for (const row of rows) {
      for (const entry of keysOf(row) || []) {
        // People arrive as {key, label} and everything else as a string. The
        // affinity table is keyed on identity either way, so that a candidate
        // can be looked up by the same key the diary was counted under.
        const value = typeof entry === 'string' ? entry : entry?.key;
        if (!value) continue;
        let bucket = byValue.get(value);
        if (!bucket) { bucket = { ratings: [], films: new Set(), bonus: 0 }; byValue.set(value, bucket); }
        bucket.films.add(row.filmKey);
        if (row.rating !== null) bucket.ratings.push(row.rating);
        // Half a star's worth of credit apiece, never compounding past one.
        if (row.isRewatch) bucket.bonus = Math.min(1, bucket.bonus + 0.5);
        if (row.isLiked) bucket.bonus = Math.min(1, bucket.bonus + 0.5);
      }
    }

    const scores = {};
    for (const [value, bucket] of byValue) {
      const filmCount = bucket.films.size;
      const valueMean = mean(bucket.ratings);
      const confidence = Math.min(1, filmCount / MIN_FILMS_FOR_CONFIDENCE);
      const delta = valueMean !== null && overallMean !== null ? valueMean - overallMean : 0;
      scores[value] = {
        // Two different questions, and the old score only answered one.
        //
        // `confidence` asks "is this preference real yet", and it is satisfied
        // at three films — correctly, because a mean over three is no longer an
        // accident. But it then caps, so a director with three films and one
        // with thirty scored identically, and how much of someone's viewing a
        // name accounts for carried no weight at all past the third film.
        //
        // `volumeWeight` asks the other question: how much of this reader's
        // attention this name has actually held. Logarithmic because the
        // difference between three films and thirty is real and the difference
        // between thirty and three hundred is mostly a long career — 3 films
        // gives ~1.24, 30 gives ~1.74, 300 gives ~2.24.
        score: (delta + bucket.bonus * 0.25) * confidence * volumeWeight(filmCount),
        films: filmCount,
        meanRating: valueMean,
      };
    }
    affinities[lens] = scores;
  }

  return {
    overallMean,
    films,
    // Everything below this is blended toward the crowd — see `blendWeight`.
    ratedFilms: rated.length,
    affinities,
  };
}

/**
 * How far to trust the profile over the crowd.
 *
 * A reader four films in has not described a personality, and treating four
 * films as one is the fastest way to produce a queue that feels arbitrary and
 * confident at the same time.
 */
function blendWeight(profile) {
  if (!profile || !profile.ratedFilms) return 0;
  return Math.min(1, profile.ratedFilms / CONFIDENT_DIARY_FILMS);
}

// ── Scoring ─────────────────────────────────────────────────────────────────

/** The crowd's opinion, normalised to roughly -1..1 around a mediocre film. */
function crowdScore(candidate) {
  const imdb = candidate.ratings?.imdb ? parseFloat(candidate.ratings.imdb) : null;
  const tmdb = typeof candidate.tmdbRating === 'number' ? candidate.tmdbRating : null;
  const outOfTen = imdb ?? tmdb;
  if (outOfTen === null || !Number.isFinite(outOfTen)) return 0;
  return (outOfTen - 6.5) / 3.5;
}

function decadeOf(year) {
  return year ? `${Math.floor(year / 10) * 10}s` : null;
}

/**
 * Score one candidate against the profile.
 *
 * `lenses` says which axes to use, which is the whole tier mechanism: tier 1
 * passes the three the catalog can answer, tier 2 passes those plus the ones
 * that needed a lookup.
 */
function scoreCandidate(candidate, profile, lenses, details = null) {
  const reasons = [];
  let score = 0;

  // Entries are strings (a genre) or people ({key, label}). Scoring uses the
  // key; the reason on the card uses the label, because "because of p:12345"
  // is not a reason anyone can read.
  const applyLens = (lens, entries, kind, describe) => {
    if (!lenses.includes(lens)) return;
    const table = profile.affinities[lens] || {};
    const { weight, maxHits } = LENS_WEIGHTS[lens] || DEFAULT_LENS_WEIGHT;

    const hits = [];
    for (const entry of entries || []) {
      const key = typeof entry === 'string' ? entry : entry?.key;
      const label = typeof entry === 'string' ? entry : entry?.label;
      const hit = key && table[key];
      if (!hit || hit.films < MIN_FILMS_FOR_CONFIDENCE) continue;
      hits.push({ hit, label });
    }

    // Strongest first, then capped, then each one after the first worth less.
    //
    // A film carries one director and a dozen billed actors, so a lens that
    // simply sums its matches lets the cast outvote everything else: four
    // familiar faces in an ordinary film beat a favourite director in a good
    // one, which is not what the reader meant by either signal.
    //
    // The cap is the blunt half. The division is the honest one: the second
    // familiar face genuinely tells you less than the first did, and the third
    // less again. Halving and thirding says so, and keeps one strong match
    // worth more than a pile of weak ones without pretending the pile is
    // worth nothing.
    hits.sort((a, b) => b.hit.score - a.hit.score);
    hits.slice(0, maxHits).forEach(({ hit, label }, rank) => {
      const contribution = (hit.score * weight) / (rank + 1);
      score += contribution;
      if (contribution > 0) {
        reasons.push({ kind, value: label, detail: describe(hit), strength: contribution });
      }
    });
  };

  const stars = (hit) => `you rate these ${hit.meanRating.toFixed(1)} over ${hit.films} films`;

  applyLens('genres', candidate.genres, 'genre', stars);
  applyLens('languages', [candidate.originalLanguage], 'language', stars);
  applyLens('decades', [decadeOf(candidate.year)], 'decade', stars);

  if (details) {
    // Through the same normaliser the diary went through, or the keys would not
    // meet: the profile counts a director by TMDB id and a raw payload carries
    // {id, name}. Reading the payload directly is what would silently score
    // every crew lens as "no match".
    applyLens('directors', toPeople(details.directors), 'director', stars);
    applyLens('cast', toPeople(details.cast), 'cast', stars);
    applyLens('writers', toPeople(details.writers), 'writer', stars);
    applyLens('cinematographers', toPeople(details.cinematographers), 'cinematographer', stars);
    applyLens('composers', toPeople(details.composers), 'composer', stars);
    applyLens('keywords', details.keywords, 'theme', stars);
    applyLens('studios', toPeople(details.studios), 'studio', stars);
  }

  // The crowd carries the whole score for a reader with no diary, and a
  // diminishing share as one accumulates.
  const weight = blendWeight(profile);
  const blended = score * weight + crowdScore(candidate) * (1 - weight);

  // Strongest reasons first, and only a couple: a card listing eight reasons
  // reads as a machine justifying itself.
  //
  // This compared `b.value.length - a.value.length`, which sorts by how long
  // the name is. The card therefore led with whichever match had the longest
  // label — so "Hoyte van Hoytema" outranked a director the reader has watched
  // thirty times, and the stated intent and the code disagreed silently. Now it
  // sorts on what each match actually contributed.
  reasons.sort((a, b) => b.strength - a.strength);
  return {
    score: blended,
    // `strength` is an internal ranking key, not something the card shows.
    reasons: reasons.slice(0, 3).map(({ strength, ...reason }) => reason),
  };
}

/**
 * Values the reader has passed on repeatedly and never once saved.
 *
 * Deliberately reluctant. A pass is ambiguous, so this needs several of them
 * against a value with no rights at all before it counts — otherwise a run of
 * "not tonight" quietly deletes a genre from someone's queue.
 */
function suppressedValues(swipes) {
  const tally = new Map();
  for (const swipe of swipes) {
    let genres = [];
    try { genres = JSON.parse(swipe.genres_json || '[]'); } catch { /* ignore */ }
    for (const genre of genres) {
      let counts = tally.get(genre);
      if (!counts) { counts = { left: 0, right: 0 }; tally.set(genre, counts); }
      counts[swipe.direction === 'right' ? 'right' : 'left'] += 1;
    }
  }
  return new Set(
    [...tally.entries()]
      .filter(([, c]) => c.right === 0 && c.left >= SUPPRESS_AFTER_PASSES)
      .map(([genre]) => genre)
  );
}

// ── The queue ───────────────────────────────────────────────────────────────

/**
 * A batch of cards, best match first.
 *
 * Tier 2 runs inline here rather than behind the response, which is a
 * deliberate simplification for the first version: the enrichment is capped and
 * the results are permanent, so the cost falls away after the first few
 * sessions on a given service. If it proves too slow on a cold cache the fix is
 * to return tier 1 immediately and enrich behind — the shape of this function
 * does not change, only who waits for it.
 */
async function buildDiscoveryQueue(db, userId, {
  scopeKey,
  mediaType = 'all',
  hideWatched = true,
  limit = 20,
  platforms = [],
  // The same narrowing the catalog page offers. Applied to the slice the
  // scoring runs over rather than to the cards it produces, so asking for
  // Japanese films gives twenty Japanese suggestions instead of whichever of
  // the twenty best happened to be Japanese.
  genreFilters = [],
  languageFilters = [],
  serviceFilters = [],
  yearMin = null,
  yearMax = null,
} = {}) {
  const diary = await readDiary(db, userId);
  const profile = buildTasteProfile(diary);

  const swipes = await all(
    db, 'SELECT item_id, direction, genres_json FROM discovery_swipes WHERE user_id = ?', [userId]
  );
  const alreadySwiped = new Set(swipes.map((s) => s.item_id));
  const suppressed = suppressedValues(swipes);

  // Films the diary says were watched, which the catalog's own watched-items
  // exclusion knows nothing about — they were imported, not marked here.
  const diaryKeys = new Set(diary.map((r) => `${(r.name || '').toLowerCase()}|${r.year || ''}`));

  // Required here rather than at the top of the file. `catalogCache` is the
  // schema bootstrap and creates this module's table, so it requires this one;
  // requiring it back at load time makes a cycle, and whichever of the two is
  // imported second would see a half-built module — `readCachedCatalog` came
  // back undefined depending only on import order, which is the kind of bug
  // that survives every test and fails in production.
  const { readCachedCatalog } = require('./catalogCache');

  const { items } = await readCachedCatalog(db, {
    scopeKey,
    mediaType,
    sortBy: 'popularity',
    page: 1,
    // A wide net: scoring re-orders it entirely, so the sort above only decides
    // which slice of the catalog is considered at all.
    pageSize: 400,
    // A service filter narrows to a subset of what the reader subscribes to;
    // with none given the whole subscription is the pool.
    serviceFilters: serviceFilters.length ? serviceFilters : platforms,
    languageFilters,
    genreFilters,
    yearMin,
    yearMax,
    excludeWatchedForUserId: hideWatched ? userId : null,
    // Unconditional, and not tied to hideWatched. A right swipe *adds* to the
    // watchlist, so a card for something already on it offers the reader a
    // thing they already have and a swipe that changes nothing. There is no
    // setting under which that is what someone wanted.
    excludeWatchlistForUserId: userId,
  });

  const candidates = items.filter((item) => {
    if (alreadySwiped.has(item.id)) return false;
    if (hideWatched && diaryKeys.has(`${(item.title || '').toLowerCase()}|${item.year || ''}`)) return false;
    if ((item.genres || []).some((g) => suppressed.has(g))) return false;
    return true;
  });

  if (!candidates.length) {
    return { cards: [], profile: describeProfile(profile), exhausted: true };
  }

  const TIER_ONE = ['genres', 'languages', 'decades'];
  const TIER_TWO = [
    ...TIER_ONE,
    'directors', 'cast', 'writers', 'cinematographers', 'composers', 'keywords', 'studios',
  ];

  const hasProfile = blendWeight(profile) > 0;

  /**
   * Everything already known about these candidates, for nothing.
   *
   * The two tiers exist because the crew lenses need a payload the catalog does
   * not carry — but "does not carry" was being read as "costs a TMDB call", and
   * it only costs one for a title nobody has looked at yet. Plenty of this pool
   * is already in `title_details_cache`: resolved by the analytics page, pulled
   * for a detail sheet, enriched by an earlier session.
   *
   * Reading those in one query changes which films can win. Before, the crew
   * lenses only ever saw the forty candidates that ranked highest on genre,
   * language and decade — so a film by the reader's most-watched director sat
   * wherever its genre put it, and if that was rank two hundred nothing ever
   * looked at who made it. Now every candidate we already know about is scored
   * on the whole profile, and the capped TMDB budget goes to the ones we do not.
   */
  const knownDetails = hasProfile
    ? await readCachedDetailsBulk(
      db,
      'movie',
      candidates
        .filter((c) => c.mediaType === 'movie')
        .map((c) => parseInt(String(c.id).split('-')[1], 10))
    )
    : new Map();

  const tierOne = candidates
    .map((candidate) => {
      const tmdbId = parseInt(String(candidate.id).split('-')[1], 10);
      const details = candidate.mediaType === 'movie' ? knownDetails.get(tmdbId) : null;
      if (details) {
        return { candidate, ...scoreCandidate(candidate, profile, TIER_TWO, details), tier: 2 };
      }
      return { candidate, ...scoreCandidate(candidate, profile, TIER_ONE) };
    })
    .sort((a, b) => b.score - a.score);

  // The TMDB budget, spent only on candidates nothing is known about yet.
  //
  // Anything scored from the cache above is already on the full profile, so
  // paying for it again would buy the same answer. Skipping those means the
  // forty calls reach forty *new* titles rather than forty rows that were in
  // SQLite all along — which is what makes a cold service warm up in one pass
  // instead of forty.
  const unknown = hasProfile ? tierOne.filter((entry) => entry.tier !== 2) : [];
  const shortlist = unknown.slice(0, ENRICH_LIMIT);
  const shortlisted = new Set(shortlist.map((entry) => entry.candidate.id));
  const enriched = await Promise.all(shortlist.map(async (entry) => {
    if (entry.candidate.mediaType !== 'movie') return entry;
    const tmdbId = parseInt(String(entry.candidate.id).split('-')[1], 10);
    if (!Number.isInteger(tmdbId)) return entry;
    try {
      // Refill first — a payload written before the crew and keyword fields
      // existed has the columns tier 2 reads as empty arrays, which would score
      // as "no match" rather than "not known yet". Then read it back; that half
      // is a cache hit whenever the refill was a no-op, which is most of the time.
      await ensureAnalyticsDetails(db, tmdbId);
      const cached = await readCachedDetails(db, 'movie', tmdbId);
      const details = cached?.payload;
      if (!details) return entry;
      return {
        candidate: entry.candidate,
        ...scoreCandidate(entry.candidate, profile, TIER_TWO, details),
        tier: 2,
      };
    } catch {
      // TMDB unreachable, or this title has no details. Tier 1's answer stands
      // rather than the card dropping out — a blunter reason is better than none.
      return entry;
    }
  }));

  // By identity rather than by slice position: the shortlist is now a filtered
  // subset of `tierOne`, not its head, so `slice(shortlist.length)` would drop
  // whichever entries happened to sit in those positions and keep the ones it
  // had just re-scored — losing cards and duplicating others.
  const ranked = [...enriched, ...tierOne.filter((entry) => !shortlisted.has(entry.candidate.id))]
    .sort((a, b) => b.score - a.score);

  return {
    cards: withExploration(ranked, limit).map(toCard),
    profile: describeProfile(profile),
    exhausted: false,
  };
}

/**
 * Reserve part of the batch for titles the crowd rates well and the profile
 * does not, marked as such.
 *
 * Scoring purely on affinity converges: within a week the queue is the same
 * five genres and the reader stops opening it. This trades precision for range
 * on purpose, and says so on the card rather than quietly.
 */
function withExploration(ranked, limit) {
  const exploreSlots = Math.max(1, Math.round(limit * EXPLORATION_SHARE));
  const mainCount = limit - exploreSlots;
  const main = ranked.slice(0, mainCount);
  const taken = new Set(main.map((r) => r.candidate.id));

  const explorers = ranked
    .filter((r) => !taken.has(r.candidate.id) && crowdScore(r.candidate) > 0.3)
    .sort((a, b) => crowdScore(b.candidate) - crowdScore(a.candidate))
    .slice(0, exploreSlots)
    .map((r) => ({ ...r, exploration: true }));

  // Interleaved rather than appended: a block of "outside your usual" at the
  // end is a block nobody reaches.
  const out = [];
  const every = Math.max(2, Math.floor(limit / Math.max(1, explorers.length)));
  let e = 0;
  for (let i = 0; i < main.length; i++) {
    out.push(main[i]);
    if ((i + 1) % every === 0 && e < explorers.length) out.push(explorers[e++]);
  }
  while (e < explorers.length) out.push(explorers[e++]);
  return out.slice(0, limit);
}

function toCard(entry) {
  const c = entry.candidate;
  return {
    itemId: c.id,
    title: c.title,
    year: c.year,
    mediaType: c.mediaType,
    posterUrl: c.posterUrl,
    overview: c.overview,
    genres: c.genres || [],
    availableOn: c.availableOn || [],
    // Without this a rent-only suggestion carries no line about where to watch
    // it at all: `availableOn` is empty for a title no subscription covers.
    purchaseOn: c.purchaseOn || [],
    ratings: c.ratings || null,
    because: entry.exploration
      ? [{ kind: 'exploration', value: 'Outside your usual', detail: 'highly rated, but not your normal fare' }]
      : entry.reasons,
    tier: entry.tier || 1,
    exploration: Boolean(entry.exploration),
  };
}

/** What the queue is built on, so the screen can be honest about it. */
function describeProfile(profile) {
  const weight = blendWeight(profile);
  return {
    basis: weight === 0 ? 'crowd' : weight < 1 ? 'blended' : 'diary',
    ratedFilms: profile.ratedFilms,
    films: profile.films,
    confidence: weight === 0 ? 'none' : weight < 0.5 ? 'low' : weight < 1 ? 'medium' : 'high',
  };
}

async function recordSwipe(db, userId, { itemId, direction, genres = [], language = null }) {
  await run(
    db,
    `INSERT INTO discovery_swipes (user_id, item_id, direction, genres_json, language, swiped_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET
       direction = excluded.direction,
       swiped_at = excluded.swiped_at`,
    [userId, itemId, direction === 'right' ? 'right' : 'left',
     JSON.stringify(genres), language, new Date().toISOString()]
  );
}

/** Undo. A mis-swipe on a card that is gone forever is the worst failure here. */
async function forgetSwipe(db, userId, itemId) {
  await run(db, 'DELETE FROM discovery_swipes WHERE user_id = ? AND item_id = ?', [userId, itemId]);
}

module.exports = {
  ensureDiscoveryTables,
  buildTasteProfile,
  blendWeight,
  scoreCandidate,
  suppressedValues,
  buildDiscoveryQueue,
  recordSwipe,
  forgetSwipe,
  MIN_FILMS_FOR_CONFIDENCE,
  CONFIDENT_DIARY_FILMS,
};
