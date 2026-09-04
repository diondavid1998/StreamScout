'use strict';

const { PAYLOAD_SENTINEL_KEY } = require('./titleCache');

/**
 * Turning an imported Letterboxd diary into the analytics page.
 *
 * Two rules shape this module:
 *
 * 1. **The CSVs are the source of truth.** Ratings, dates, rewatches, tags and
 *    release years all come from the files the user uploaded — never from the
 *    app's own watched list, and never from TMDB. Everything in `summary`,
 *    `rating`, `eras` and `collection` is computable the second the import lands,
 *    with no network at all.
 *
 * 2. **Genre and people are the one exception, and they are opt-in.** No
 *    Letterboxd export contains a director, a cast list or a genre — the files
 *    have five columns and none of them is that. Those sections join to
 *    `title_details_cache`, which fills in only when the user asks for it, and
 *    the payload always says how much of the history has resolved so the page
 *    can be honest about a partial answer.
 */


/** Below this, a mean is an anecdote rather than a preference. */
const MIN_FILMS_FOR_AFFINITY = 3;
const TOP_N = 12;
// Posters shown in the mosaic — a full screen of artwork without paging.
const MOSAIC_SIZE = 24;
// Genres plotted on the taste map. Beyond about this many the points crowd each
// other on a phone no matter how they are labelled.
const QUADRANT_POINTS = 10;

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

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round(value, places = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Group rows by a key each row can supply several of — a film has many genres,
 * many cast members — and summarise each group.
 */
function groupBy(rows, keysOf) {
  const groups = new Map();
  for (const row of rows) {
    for (const key of keysOf(row)) {
      if (!key) continue;
      let group = groups.get(key);
      if (!group) { group = { key, rows: [] }; groups.set(key, group); }
      group.rows.push(row);
    }
  }
  return groups;
}

function summarise(key, rows) {
  const rated = rows.filter((r) => r.rating !== null).map((r) => r.rating);
  const crowd = rows.filter((r) => r.crowdRating !== null).map((r) => r.crowdRating);
  return {
    name: key,
    films: new Set(rows.map((r) => r.filmKey)).size,
    rated: rated.length,
    meanRating: round(mean(rated)),
    crowdMean: round(mean(crowd)),
  };
}

function rankBy(groups, minFilms = 1) {
  return [...groups.values()]
    .map((g) => summarise(g.key, g.rows))
    .filter((g) => g.films >= minFilms)
    .sort((a, b) => b.films - a.films || (b.meanRating ?? 0) - (a.meanRating ?? 0));
}

async function ensureAnalyticsTables(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS letterboxd_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      year        INTEGER,
      -- Lowercased "name|year". Groups the viewings of one film together, and
      -- is what the TMDB resolve step is keyed on.
      film_key    TEXT    NOT NULL,
      rating      REAL,
      watched_on  TEXT,
      is_rewatch  INTEGER NOT NULL DEFAULT 0,
      tags_json   TEXT    NOT NULL DEFAULT '[]',
      uri         TEXT,
      source      TEXT,
      -- movie-550 once resolved; NULL until someone asks for genres and people.
      item_id     TEXT,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  );
  // Added after the table shipped. Both come out of files the import already
  // read and then dropped on the floor: whether the viewing carried a review,
  // and whether the film is in likes.csv.
  for (const [name, ddl] of [
    ['has_review', 'has_review INTEGER NOT NULL DEFAULT 0'],
    ['is_liked', 'is_liked INTEGER NOT NULL DEFAULT 0'],
  ]) {
    const columns = await all(db, 'PRAGMA table_info(letterboxd_entries)');
    if (columns.some((c) => c.name === name)) continue;
    await run(db, `ALTER TABLE letterboxd_entries ADD COLUMN ${ddl}`);
  }

  await run(db, 'CREATE INDEX IF NOT EXISTS idx_lbx_entries_user ON letterboxd_entries(user_id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_lbx_entries_film ON letterboxd_entries(user_id, film_key)');

  // One-off repair, and it has to be genuinely one-off: clearing on every boot
  // would put the films TMDB really has nothing for back in the queue each
  // restart, so the page would keep offering a lookup that can never finish.
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS analytics_repairs (
      name       TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
  const { changes } = await run(
    db,
    "INSERT OR IGNORE INTO analytics_repairs (name) VALUES ('clear-unreliable-miss-markers')"
  );
  if (changes > 0) {
    // The empty string means "the film database has nothing under this name",
    // and a film carrying it is never searched again. It used to be written for
    // a failed request too, so one TMDB outage could retire a whole history —
    // and the page it fed would stay empty with nothing left to press. Every
    // marker written under that rule is unreliable, so they are cleared and
    // earned back a search at a time.
    await run(db, "UPDATE letterboxd_entries SET item_id = NULL WHERE item_id = ''");
  }
}

/**
 * The films saved for later. Kept in the same table under `source='watchlist'`
 * and deliberately never mixed into the watched history — the interesting thing
 * about them is precisely that they are the other list.
 */
async function readWatchlist(db, userId) {
  const rows = await all(
    db,
    `SELECT name, year, film_key FROM letterboxd_entries
      WHERE user_id = ? AND source = 'watchlist'`,
    [userId]
  );
  return rows.map((row) => ({ name: row.name, year: row.year, filmKey: row.film_key }));
}

/**
 * Intent against history: how much of the watchlist you have since watched, and
 * how much is still queued. Both sides are matched on `film_key`, so this needs
 * no TMDB lookup at all — it is a set comparison over names and years.
 */
function buildWatchlist(watchlistRows, watchedRows) {
  const saved = new Map();
  for (const row of watchlistRows) if (!saved.has(row.filmKey)) saved.set(row.filmKey, row);
  if (!saved.size) return null;

  const watched = new Set(watchedRows.map((r) => r.filmKey));
  const seen = [...saved.keys()].filter((key) => watched.has(key));
  const waiting = [...saved.values()].filter((row) => !watched.has(row.filmKey));

  return {
    saved: saved.size,
    watched: seen.length,
    waiting: waiting.length,
    // The share of everything you meant to watch that you actually did.
    conversion: saved.size ? round((seen.length / saved.size) * 100) : null,
    // A few of the oldest still-unwatched entries, as a nudge.
    stillWaiting: waiting.slice(0, TOP_N).map((row) => ({ name: row.name, year: row.year })),
  };
}

/** A /5 crowd score from whichever source has one, or null. */
function pickCrowdRating(imdbRating, details) {
  const imdb = imdbRating === null || imdbRating === undefined ? null : Number(imdbRating);
  if (imdb !== null && Number.isFinite(imdb) && imdb > 0) return imdb / 2;
  const tmdb = details?.voteAverage;
  // TMDB reports an unrated film as 0, which is an absence, not an opinion.
  if (typeof tmdb === 'number' && Number.isFinite(tmdb) && tmdb > 0) return tmdb / 2;
  return null;
}

/**
 * Every diary row, with whatever metadata has resolved for its film.
 *
 * A LEFT JOIN, deliberately: a film whose details have never been fetched still
 * has a rating and a date, and must still count in every section that does not
 * need TMDB.
 */
/**
 * Rows that are films you have *seen*. Watchlist rows share the table but are a
 * record of intent, not history — counting them here would inflate every total
 * on the page, so they are excluded everywhere except `readWatchlist`.
 */
const WATCHED_ONLY = `(e.source IS NULL OR e.source <> 'watchlist')`;

/**
 * The parsed diary, kept between requests.
 *
 * Reading and parsing the diary is ~95% of what an analytics request costs: the
 * scan itself is cheap, but `JSON.parse` over every film's stored payload is
 * not, and it was repeated in full on every lens switch and every filter toggle
 * even though nothing about the history had changed. The aggregation on top of
 * it is a couple of dozen milliseconds, so this is the difference between a tap
 * costing hundreds of milliseconds and costing almost nothing — and because the
 * parse is synchronous, it is also the difference between one large history
 * blocking the event loop for every other user and not.
 *
 * Correctness rests on invalidation, never on expiry. An entry is dropped the
 * moment the rows behind it change, so a stale answer is not something a caller
 * can wait out — see `invalidateDiary`.
 *
 * Keyed by database first so that each connection has its own cache. Tests open
 * a fresh in-memory database per case and reuse low user ids; a cache keyed on
 * the id alone would serve one test's history to the next.
 */
const diaryCaches = new WeakMap();
/** Enough for the readers a small deployment has at once, bounded so a busy one cannot grow without limit. */
const DIARY_CACHE_LIMIT = 8;

function diaryCacheFor(db) {
  let cache = diaryCaches.get(db);
  if (!cache) { cache = new Map(); diaryCaches.set(db, cache); }
  return cache;
}

/**
 * Drop cached diaries whose underlying rows have just changed.
 *
 * With a user id, only that user's entry goes. Without one, the whole database's
 * cache is cleared — which is what a write to `title_details_cache` needs, since
 * those rows are shared and a film resolved for one user changes the answer for
 * everyone who has watched it.
 */
function invalidateDiary(db, userId = null) {
  const cache = diaryCaches.get(db);
  if (!cache) return;
  if (userId === null || userId === undefined) cache.clear();
  else cache.delete(Number(userId));
}

function mapDiaryRows(rows) {
  // Every viewing of a film carries the same payload, so parse it once and let
  // the rewatches share the result. This saves the repeated parse and, because
  // the arrays inside are shared rather than copied, most of the memory the
  // cache above would otherwise hold.
  const detailsByItem = new Map();
  const parseDetails = (itemId, json) => {
    if (!json) return null;
    if (detailsByItem.has(itemId)) return detailsByItem.get(itemId);
    let parsed = null;
    try { parsed = JSON.parse(json); } catch { /* ignore */ }
    // Derived once per film for the same reason: `cast` is the largest array in
    // the payload and every section that reads it wants only the names.
    if (parsed) parsed.castNames = (parsed.cast || []).map((c) => c.name);
    detailsByItem.set(itemId, parsed);
    return parsed;
  };

  return rows.map((row) => {
    const details = parseDetails(row.item_id, row.payload_json);
    let tags = [];
    try { tags = JSON.parse(row.tags_json || '[]'); } catch { /* ignore */ }
    return {
      name: row.name,
      year: row.year,
      filmKey: row.film_key,
      rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
      watchedOn: row.watched_on,
      isRewatch: Boolean(row.is_rewatch),
      // Both from the export, both previously dropped on import.
      hasReview: Boolean(row.has_review),
      isLiked: Boolean(row.is_liked),
      tags,
      // Not `|| null`: the empty string is the marker for a film the database
      // has nothing for, and coalescing it away would hide those films back
      // into the pending count the lookup has already finished with.
      itemId: row.item_id === null || row.item_id === undefined ? null : String(row.item_id),
      // Resolved means "carries what this page reads", not merely "has a cached
      // row". A payload written before the crew and keyword fields existed
      // would otherwise report the history as fully looked up while half the
      // lenses sat empty and the button that would fill them was hidden. The
      // resolve queue tests for the same key, so the two agree on what is left
      // to do.
      resolved: Boolean(details) && PAYLOAD_SENTINEL_KEY in details,
      genres: details?.genres || [],
      directors: details?.directors || [],
      cast: details?.castNames || [],
      runtime: details?.runtime || null,
      language: row.original_language || null,
      // Stored for every resolved film and, until now, read by nothing.
      countries: details?.productionCountries || [],
      posterUrl: details?.posterUrl || null,
      // All of these ride in on responses the app was already making and used
      // to be thrown away with the rest of the payload.
      writers: details?.writers || [],
      cinematographers: details?.cinematographers || [],
      composers: details?.composers || [],
      studios: details?.studios || [],
      keywords: details?.keywords || [],
      certification: details?.certification || null,
      collection: details?.collection || null,
      voteCount: typeof details?.voteCount === 'number' ? details.voteCount : null,
      budget: typeof details?.budget === 'number' ? details.budget : null,
      revenue: typeof details?.revenue === 'number' ? details.revenue : null,
      releaseDate: details?.releaseDate || null,
      // The audience score, rebased from /10 to the same 5-star scale the user's
      // own ratings use, so "you versus the crowd" subtracts like for like.
      // IMDb's is preferred where the catalog happens to have fetched it;
      // otherwise TMDB's, which arrives free with the details every looked-up
      // film already needs. Without the fallback the whole comparison — the
      // offset, the per-person deltas, the biggest disagreements — stays empty
      // for an imported history, since nothing fetches IMDb scores for it.
      crowdRating: pickCrowdRating(row.crowd_rating, details),
    };
  });
}

async function readDiary(db, userId) {
  const cache = diaryCacheFor(db);
  const key = Number(userId);
  if (cache.has(key)) {
    const rows = cache.get(key);
    // Re-inserting moves the entry to the end, so the eviction below drops the
    // reader who has been away longest rather than an active one.
    cache.delete(key);
    cache.set(key, rows);
    return rows;
  }

  const rows = mapDiaryRows(await all(
    db,
    `SELECT e.name, e.year, e.film_key, e.rating, e.watched_on, e.is_rewatch,
            e.tags_json, e.item_id, e.has_review, e.is_liked,
            d.payload_json, d.original_language,
            tr.rating_imdb_num AS crowd_rating
       FROM letterboxd_entries e
       -- Matched on the id column rather than on a string built from it. The
       -- concatenated form ('movie-' || d.tmdb_id) is not something an index
       -- can answer, so SQLite could only narrow to media_type and then scan
       -- every cached film for each diary row in turn — the join was quadratic
       -- in the size of the history, which is why a large one fell off a cliff
       -- rather than simply taking proportionally longer. Comparing the integer
       -- lets it seek straight down the primary key. The LIKE guard carries the
       -- other half of the old condition: without it a 'tv-3' row would take
       -- the substring '3' and match the film with tmdb_id 3.
       LEFT JOIN title_details_cache d
              ON d.media_type = 'movie'
             AND e.item_id LIKE 'movie-%'
             AND d.tmdb_id = CAST(SUBSTR(e.item_id, 7) AS INTEGER)
       LEFT JOIN title_ratings tr ON tr.imdb_id = d.imdb_id
      WHERE e.user_id = ? AND ${WATCHED_ONLY}`,
    [userId]
  ));

  cache.set(key, rows);
  while (cache.size > DIARY_CACHE_LIMIT) cache.delete(cache.keys().next().value);
  // Callers only ever read these rows, and every sort in this module runs on a
  // derived array, so one parse can be handed to every reader of it.
  return rows;
}
function buildSummary(rows) {
  const films = new Set(rows.map((r) => r.filmKey));
  const rated = rows.filter((r) => r.rating !== null);
  const dated = rows.filter((r) => r.watchedOn).map((r) => r.watchedOn).sort();
  const runtimes = rows.filter((r) => r.runtime).map((r) => r.runtime);
  const paired = rows.filter((r) => r.rating !== null && r.crowdRating !== null);
  const userMean = mean(rated.map((r) => r.rating));
  const crowdMean = mean(paired.map((r) => r.crowdRating));

  return {
    films: films.size,
    viewings: rows.length,
    rated: rated.length,
    meanRating: round(userMean),
    // Only over the films where both exist — otherwise the two means describe
    // different collections and the difference between them means nothing.
    crowdMean: round(crowdMean),
    tasteOffset: round(mean(paired.map((r) => r.rating - r.crowdRating))),
    comparedOn: paired.length,
    runtimeMinutes: runtimes.reduce((sum, r) => sum + r, 0),
    runtimeKnownFor: runtimes.length,
    firstWatched: dated[0] || null,
    lastWatched: dated[dated.length - 1] || null,
  };
}

function buildRating(rows) {
  const rated = rows.filter((r) => r.rating !== null);
  const buckets = [];
  for (let star = 0.5; star <= 5.0001; star += 0.5) {
    const value = round(star, 1);
    buckets.push({ rating: value, films: rated.filter((r) => r.rating === value).length });
  }

  const byYear = [...groupBy(rated.filter((r) => r.watchedOn), (r) => [r.watchedOn.slice(0, 4)]).values()]
    .map((g) => ({ year: g.key, films: g.rows.length, meanRating: round(mean(g.rows.map((r) => r.rating))) }))
    .sort((a, b) => a.year.localeCompare(b.year));

  const paired = rated.filter((r) => r.crowdRating !== null);
  const deltas = paired
    .map((r) => ({ name: r.name, year: r.year, rating: r.rating, crowd: round(r.crowdRating), delta: round(r.rating - r.crowdRating) }))
    .sort((a, b) => b.delta - a.delta);

  return {
    histogram: buckets,
    mode: buckets.reduce((best, b) => (b.films > (best?.films ?? -1) ? b : best), null),
    byYear,
    hottestTakes: { above: deltas.slice(0, 5), below: deltas.slice(-5).reverse() },
    highest: rated.filter((r) => r.rating >= 4.5).slice(0, TOP_N).map((r) => ({ name: r.name, year: r.year, rating: r.rating })),
  };
}

function buildEras(rows) {
  const withYear = rows.filter((r) => r.year);
  const decades = [...groupBy(withYear, (r) => [`${Math.floor(r.year / 10) * 10}s`]).values()]
    .map((g) => ({
      decade: g.key,
      films: new Set(g.rows.map((r) => r.filmKey)).size,
      meanRating: round(mean(g.rows.filter((r) => r.rating !== null).map((r) => r.rating))),
    }))
    .sort((a, b) => a.decade.localeCompare(b.decade));

  const lags = rows
    .filter((r) => r.year && r.watchedOn)
    .map((r) => parseInt(r.watchedOn.slice(0, 4), 10) - r.year)
    .filter((lag) => lag >= 0);

  const languages = [...groupBy(rows.filter((r) => r.language), (r) => [r.language]).values()]
    .map((g) => ({
      code: g.key,
      films: new Set(g.rows.map((r) => r.filmKey)).size,
      meanRating: round(mean(g.rows.filter((r) => r.rating !== null).map((r) => r.rating))),
    }))
    .sort((a, b) => b.films - a.films)
    .slice(0, TOP_N);

  return { decades, lagYearsMedian: round(median(lags), 1), lagSample: lags.length, languages };
}

/**
 * The two things worth keeping that need no watch date.
 *
 * There used to be a habits section here — films per month, a weekday chart, a
 * calendar heatmap, longest streak, busiest day. It is gone, for two reasons
 * that point the same way.
 *
 * The first is that nobody asked for it: the questions this page exists to
 * answer are which genres, directors and actors turn up in a history and how
 * they were rated, and "films watched in a day" is not one of them.
 *
 * The second is that it could not have been honest anyway. Letterboxd records a
 * watch date only on films logged to a diary or reviewed — on a real 1,782-film
 * export, 47 of them. Everything else carries the date the row was *entered*,
 * and a bulk rating session puts 161 films on one day. A busiest-day stat built
 * on that reads "161 films on 13 February", which is a data-entry session
 * described as a viewing.
 *
 * Rewatch counts went the same way, and for the first reason rather than the
 * second: they were reportable, just not wanted. `is_rewatch` is still parsed
 * and stored — it costs nothing to keep, and a model trained on this history
 * later would want to know a film was worth returning to.
 *
 * Tags survive because they need no date and answer a question about the films
 * themselves.
 */
function buildCollection(rows) {
  const tagCounts = new Map();
  for (const row of rows) for (const tag of row.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);

  return {
    topTags: [...tagCounts.entries()].map(([tag, films]) => ({ tag, films }))
      .sort((a, b) => b.films - a.films).slice(0, TOP_N),
  };
}


/**
 * Human names for the language codes TMDB returns. Only the ones a film history
 * actually turns up; anything else falls back to the uppercased code, which is
 * still a usable label.
 */
const LANGUAGE_NAMES = {
  en: 'English', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian',
  ja: 'Japanese', ko: 'Korean', zh: 'Chinese', cn: 'Chinese', hi: 'Hindi',
  ru: 'Russian', pt: 'Portuguese', sv: 'Swedish', da: 'Danish', no: 'Norwegian',
  nn: 'Norwegian', fi: 'Finnish', nl: 'Dutch', pl: 'Polish', cs: 'Czech',
  hu: 'Hungarian', el: 'Greek', tr: 'Turkish', fa: 'Persian', ar: 'Arabic',
  he: 'Hebrew', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', ta: 'Tamil',
  te: 'Telugu', ml: 'Malayalam', bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi',
  ro: 'Romanian', uk: 'Ukrainian', sr: 'Serbian', hr: 'Croatian', bg: 'Bulgarian',
  is: 'Icelandic', et: 'Estonian', lv: 'Latvian', lt: 'Lithuanian', ka: 'Georgian',
  eu: 'Basque', ca: 'Catalan', gl: 'Galician', af: 'Afrikaans', sw: 'Swahili',
  tl: 'Tagalog', ms: 'Malay', ur: 'Urdu', xx: 'No dialogue',
};

const languageName = (code) => LANGUAGE_NAMES[String(code).toLowerCase()] || String(code).toUpperCase();

const decadeOf = (year) => (year ? `${Math.floor(year / 10) * 10}s` : null);

/**
 * The lenses the page can be pointed at.
 *
 * The old page was one long scroll of every section at once, which meant the
 * reader did the filtering by thumb. A dimension names one question — who
 * directed these, what language were they in — and the payload answers only
 * that, so each view is short enough to read.
 *
 * `keysOf` is what makes a dimension rankable: a film belongs to several genres
 * and many cast members, so the same grouping machinery serves all of them.
 */
const DIMENSIONS = {
  overview:  { title: 'Overview' },
  ratings:   { title: 'Ratings' },
  directors: {
    title: 'Directors', unit: 'director', filterKey: 'director',
    keysOf: (r) => r.directors, needsResolved: true,
  },
  cast: {
    title: 'Cast', unit: 'actor', filterKey: 'actor',
    keysOf: (r) => r.cast, needsResolved: true,
  },
  genres: {
    title: 'Genres', unit: 'genre', filterKey: 'genre',
    keysOf: (r) => r.genres, needsResolved: true,
  },
  languages: {
    title: 'Languages', unit: 'language', filterKey: 'language',
    keysOf: (r) => [r.language], label: languageName, needsResolved: true,
  },
  countries: {
    title: 'Countries', unit: 'country', filterKey: 'country',
    keysOf: (r) => r.countries, needsResolved: true,
  },
  decades: {
    title: 'Decades', unit: 'decade', filterKey: 'decade',
    keysOf: (r) => [decadeOf(r.year)],
  },
  tags: {
    title: 'Tags', unit: 'tag', filterKey: 'tag',
    keysOf: (r) => r.tags,
  },

  // ── Lenses on crew and description the app was already fetching ───────────

  writers: {
    title: 'Writers', unit: 'writer', filterKey: 'writer',
    keysOf: (r) => r.writers, needsResolved: true,
  },
  cinematographers: {
    title: 'Cinematography', unit: 'cinematographer', filterKey: 'cinematographer',
    keysOf: (r) => r.cinematographers, needsResolved: true,
  },
  composers: {
    title: 'Composers', unit: 'composer', filterKey: 'composer',
    keysOf: (r) => r.composers, needsResolved: true,
  },
  studios: {
    title: 'Studios', unit: 'studio', filterKey: 'studio',
    keysOf: (r) => r.studios, needsResolved: true,
  },
  // What the films are *about*, where genre only says what shelf they sit on.
  keywords: {
    title: 'Themes', unit: 'theme', filterKey: 'keyword',
    keysOf: (r) => r.keywords, needsResolved: true,
  },
};

const DEFAULT_DIMENSION = 'overview';

/** How deep a focused dimension goes. Far longer than the old top-12 teaser. */
const DIMENSION_DEPTH = 60;

/** The filters, and how each one tests a single diary row. */
const FILTERS = {
  language: (row, value) => row.language === value,
  genre:    (row, value) => row.genres.includes(value),
  country:  (row, value) => row.countries.includes(value),
  director: (row, value) => row.directors.includes(value),
  actor:    (row, value) => row.cast.includes(value),
  tag:      (row, value) => row.tags.includes(value),
  decade:   (row, value) => decadeOf(row.year) === value,
  yearMin:  (row, value) => row.year !== null && row.year >= value,
  yearMax:  (row, value) => row.year !== null && row.year <= value,
  ratingMin:(row, value) => row.rating !== null && row.rating >= value,
  ratingMax:(row, value) => row.rating !== null && row.rating <= value,
  // "Only the ones I scored" and its complement, which is a genuinely different
  // question on an export where a third of the history is unrated.
  rated:    (row, value) => (value === 'no' ? row.rating === null : row.rating !== null),
  writer:   (row, value) => row.writers.includes(value),
  cinematographer: (row, value) => row.cinematographers.includes(value),
  composer: (row, value) => row.composers.includes(value),
  studio:   (row, value) => row.studios.includes(value),
  keyword:  (row, value) => row.keywords.includes(value),
  certification: (row, value) => row.certification === value,
  // The two flags the export carries and nothing used to read.
  liked:    (row, value) => (value === 'no' ? !row.isLiked : row.isLiked),
  reviewed: (row, value) => (value === 'no' ? !row.hasReview : row.hasReview),
};

const NUMERIC_FILTERS = new Set(['yearMin', 'yearMax', 'ratingMin', 'ratingMax']);

/**
 * Read filters out of a query string, keeping only the ones that were actually
 * given. An unknown key or an unparseable number is dropped rather than
 * rejected: a stale bookmark should still return a page.
 */
function parseFilters(query = {}) {
  const applied = {};
  for (const key of Object.keys(FILTERS)) {
    const raw = query[key];
    if (raw === undefined || raw === null || raw === '') continue;
    if (NUMERIC_FILTERS.has(key)) {
      const num = Number(raw);
      if (Number.isFinite(num)) applied[key] = num;
    } else if (key === 'rated') {
      const v = String(raw).toLowerCase();
      if (v === 'yes' || v === 'no') applied[key] = v;
    } else {
      applied[key] = String(raw);
    }
  }
  return applied;
}

/**
 * A filter, described the way a removable chip should read it.
 *
 * The client gets a label rather than the raw value, because `ja` and `3` are
 * not chip text — and the mapping from code to name already lives here.
 */
function describeFilter(key, value) {
  switch (key) {
    case 'language': return languageName(value);
    case 'ratingMin': return `${value}\u2605 and up`;
    case 'ratingMax': return `up to ${value}\u2605`;
    case 'yearMin': return `${value} and later`;
    case 'yearMax': return `${value} and earlier`;
    case 'rated': return value === 'no' ? 'Unrated only' : 'Rated only';
    case 'liked': return value === 'no' ? 'Not liked' : 'Liked only';
    case 'reviewed': return value === 'no' ? 'Not reviewed' : 'Reviewed only';
    case 'certification': return `Rated ${value}`;
    default: return String(value);
  }
}

/** Applied filters as an ordered, labelled list the client can render directly. */
function describeApplied(applied) {
  return Object.keys(FILTERS)
    .filter((key) => applied[key] !== undefined)
    .map((key) => ({
      key,
      value: String(applied[key]),
      label: describeFilter(key, applied[key]),
    }));
}

/** Rows matching every applied filter. `skip` leaves one filter out. */
function applyFilters(rows, applied, skip = null) {
  const keys = Object.keys(applied).filter((k) => k !== skip);
  if (!keys.length) return rows;
  return rows.filter((row) => keys.every((key) => FILTERS[key](row, applied[key])));
}

function countFilms(rows) {
  return new Set(rows.map((r) => r.filmKey)).size;
}

/**
 * The option lists behind the filter controls.
 *
 * Each facet is counted against every filter *except its own*, which is what
 * makes a multi-select feel right: having picked English, the language list
 * still shows what switching to Japanese would give you, while the genre list
 * narrows to what English films offer.
 */
function buildFacets(rows, applied) {
  const facet = (key, keysOf, label) => {
    const scoped = applyFilters(rows, applied, key);
    const counts = new Map();
    for (const row of scoped) {
      for (const value of keysOf(row)) {
        if (!value) continue;
        let entry = counts.get(value);
        if (!entry) { entry = new Set(); counts.set(value, entry); }
        entry.add(row.filmKey);
      }
    }
    const list = [...counts.entries()]
      .map(([value, films]) => ({ value, label: label ? label(value) : value, films: films.size }))
      .sort((a, b) => b.films - a.films || a.label.localeCompare(b.label));
    // A value the user has already picked stays listed even when the other
    // filters have counted it down to nothing, or it could never be cleared.
    if (applied[key] !== undefined && !list.some((o) => o.value === applied[key])) {
      list.unshift({ value: applied[key], label: label ? label(applied[key]) : applied[key], films: 0 });
    }
    return list;
  };

  return {
    languages: facet('language', (r) => [r.language], languageName),
    genres:    facet('genre',    (r) => r.genres),
    countries: facet('country',  (r) => r.countries).slice(0, DIMENSION_DEPTH),
    decades:   facet('decade',   (r) => [decadeOf(r.year)]).sort((a, b) => a.value.localeCompare(b.value)),
    directors: facet('director', (r) => r.directors).slice(0, DIMENSION_DEPTH),
    cast:      facet('actor',    (r) => r.cast).slice(0, DIMENSION_DEPTH),
    tags:      facet('tag',      (r) => r.tags).slice(0, DIMENSION_DEPTH),
    writers:   facet('writer',   (r) => r.writers).slice(0, DIMENSION_DEPTH),
    cinematographers: facet('cinematographer', (r) => r.cinematographers).slice(0, DIMENSION_DEPTH),
    composers: facet('composer', (r) => r.composers).slice(0, DIMENSION_DEPTH),
    studios:   facet('studio',   (r) => r.studios).slice(0, DIMENSION_DEPTH),
    keywords:  facet('keyword',  (r) => r.keywords).slice(0, DIMENSION_DEPTH),
    certifications: facet('certification', (r) => [r.certification]),
  };
}

/**
 * One dimension, ranked — the list the focused view is built around.
 *
 * Every entry carries both halves of the question: how much of the history it
 * accounts for, and how it was rated against the reader's own average. `best`
 * and `worst` come off the same ranking so the two ends are measured alike.
 */
function buildBreakdown(dimension, rows, overallMean) {
  const spec = DIMENSIONS[dimension];
  if (!spec || !spec.keysOf) return null;

  const pool = spec.needsResolved ? rows.filter((r) => r.resolved) : rows;
  const ranked = rankBy(groupBy(pool, spec.keysOf)).map((entry) => ({
    ...entry,
    label: spec.label ? spec.label(entry.name) : entry.name,
    delta: entry.meanRating !== null && overallMean !== null
      ? round(entry.meanRating - overallMean)
      : null,
  }));

  const byDelta = ranked
    .filter((e) => e.delta !== null && e.films >= MIN_FILMS_FOR_AFFINITY)
    .sort((a, b) => b.delta - a.delta);

  return {
    id: dimension,
    title: spec.title,
    unit: spec.unit,
    // The filter key tapping an entry should set, so the client needs no map
    // of its own and drill-down is just "add a filter".
    filterKey: spec.filterKey || null,
    total: ranked.length,
    entries: ranked.slice(0, DIMENSION_DEPTH),
    best: byDelta.slice(0, TOP_N),
    worst: byDelta.slice(-TOP_N).reverse(),
    // Only meaningful where the dimension needs TMDB — say so rather than
    // showing an empty list and letting the reader guess why.
    needsLookup: Boolean(spec.needsResolved),
  };
}

/**
 * Genres placed on two axes: how often you watch one against how highly you
 * rate it. The medians travel with the points so the client can draw the
 * crosshair — the four corners are the whole idea, and they only mean anything
 * relative to the rest of *this* history, never an absolute scale.
 */
function buildQuadrant(rows) {
  const resolved = rows.filter((r) => r.resolved);
  const points = rankBy(groupBy(resolved, (r) => r.genres))
    .filter((entry) => entry.meanRating !== null && entry.films >= MIN_FILMS_FOR_AFFINITY)
    .map((entry) => ({ name: entry.name, films: entry.films, meanRating: entry.meanRating }))
    // Capped. TMDB carries nineteen film genres and a broad history qualifies
    // under most of them, which put nineteen points and nineteen labels into a
    // chart a couple of hundred points tall — unreadable, and the tail of it
    // was the genres the reader has seen three films of. `rankBy` has already
    // sorted by how much of the history each accounts for, so this keeps the
    // ones the map is actually about.
    .slice(0, QUADRANT_POINTS);
  if (points.length < 3) return null;

  return {
    points,
    filmsMedian: round(median(points.map((p) => p.films))),
    ratingMedian: round(median(points.map((p) => p.meanRating))),
  };
}

/**
 * Your best-rated films, with the artwork. Analytics is the only screen in a
 * film app with no film on it; these are the posters that fix that.
 */
function buildMosaic(rows) {
  const byFilm = new Map();
  for (const row of rows) {
    if (!row.posterUrl || row.rating === null) continue;
    const existing = byFilm.get(row.filmKey);
    if (!existing || row.rating > existing.rating) {
      byFilm.set(row.filmKey, {
        name: row.name, year: row.year, rating: row.rating, posterUrl: row.posterUrl,
      });
    }
  }
  return [...byFilm.values()]
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name))
    .slice(0, MOSAIC_SIZE);
}

/**
 * The things a diary can say about you once the film database is joined to it,
 * none of which the export contains on its own.
 *
 * This is what took the poster wall's place on the overview. A grid of the
 * artwork you rated highest looked well but answered nothing — it was a list of
 * favourites, which the diary already knew, arranged prettily. Each block below
 * is a distribution instead, and each one comes from a field that was already
 * being fetched and thrown away.
 *
 * Every block returns null rather than an empty shell when the history has
 * nothing to say on it, so a page with an unresolved library shows fewer
 * sections rather than a screenful of zeroes.
 */
function buildProfile(rows) {
  // One row per film. A rewatch should not count its budget twice.
  const films = new Map();
  for (const row of rows) if (!films.has(row.filmKey)) films.set(row.filmKey, row);
  const unique = [...films.values()];
  if (!unique.length) return null;

  /** Films per bucket, with the mean rating of each, dropping empty buckets. */
  const distribution = (values, buckets, valueOf) => {
    const counted = buckets.map((bucket) => ({ ...bucket, films: 0, ratings: [] }));
    let placed = 0;
    for (const row of values) {
      const value = valueOf(row);
      if (value === null || value === undefined) continue;
      const bucket = counted.find((b) => value >= b.min && (b.max === null || value < b.max));
      if (!bucket) continue;
      bucket.films += 1;
      if (row.rating !== null) bucket.ratings.push(row.rating);
      placed += 1;
    }
    if (!placed) return null;
    return {
      covered: placed,
      buckets: counted
        .filter((b) => b.films > 0)
        .map((b) => ({ label: b.label, films: b.films, meanRating: round(mean(b.ratings)) })),
    };
  };

  // How widely seen the films are, by the number of people who have scored them
  // on TMDB. Not a measure of quality — of reach. It is the only thing here
  // that can say whether someone watches what everyone watches, and for a
  // Letterboxd user that is usually the more interesting question.
  const reach = distribution(unique, [
    { label: 'Barely seen',  min: 0,     max: 250 },
    { label: 'Under the radar', min: 250, max: 2000 },
    { label: 'Well known',   min: 2000,  max: 10000 },
    { label: 'Everyone has seen it', min: 10000, max: null },
  ], (r) => r.voteCount);

  // What a film cost to make, which separates a festival film from a franchise
  // one far more cleanly than genre does.
  const scale = distribution(unique, [
    { label: 'Under $1M',  min: 0,          max: 1e6 },
    { label: '$1-10M',     min: 1e6,        max: 1e7 },
    { label: '$10-50M',    min: 1e7,        max: 5e7 },
    { label: '$50-100M',   min: 5e7,        max: 1e8 },
    { label: 'Over $100M', min: 1e8,        max: null },
  ], (r) => r.budget);

  // The US certificate, in the order a cinema would list them rather than
  // alphabetically.
  const CERT_ORDER = ['G', 'PG', 'PG-13', 'R', 'NC-17', 'NR'];
  const certCounts = new Map();
  const certRatings = new Map();
  for (const row of unique) {
    if (!row.certification) continue;
    certCounts.set(row.certification, (certCounts.get(row.certification) || 0) + 1);
    if (row.rating !== null) {
      certRatings.set(row.certification, [...(certRatings.get(row.certification) || []), row.rating]);
    }
  }
  const certifications = certCounts.size
    ? [...certCounts.entries()]
        .map(([label, filmCount]) => ({
          label, films: filmCount, meanRating: round(mean(certRatings.get(label) || [])),
        }))
        .sort((a, b) => {
          const ai = CERT_ORDER.indexOf(a.label);
          const bi = CERT_ORDER.indexOf(b.label);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        })
    : null;

  // How much of the history is franchise films — anything TMDB files under a
  // collection.
  const inCollection = unique.filter((r) => r.collection).length;
  const resolvedFilms = unique.filter((r) => r.resolved).length;
  const franchise = resolvedFilms
    ? {
        films: inCollection,
        resolved: resolvedFilms,
        share: round((inCollection / resolvedFilms) * 100),
      }
    : null;

  // The two columns the export carries that nothing used to read. Free of any
  // lookup: these come straight out of the CSVs.
  const liked = unique.filter((r) => r.isLiked).length;
  const reviewed = unique.filter((r) => r.hasReview).length;
  const engagement = liked || reviewed
    ? {
        films: unique.length,
        liked,
        reviewed,
        // A film can be liked without being scored, which is its own signal.
        likedUnrated: unique.filter((r) => r.isLiked && r.rating === null).length,
      }
    : null;

  if (!reach && !scale && !certifications && !franchise && !engagement) return null;
  return { reach, scale, certifications, franchise, engagement };
}

/**
 * The payload for one lens over one filtered slice of the history.
 *
 * Two things changed here. Sections are now conditional on the dimension, so a
 * reader who asked about directors is not handed genre charts to scroll past;
 * and everything is computed over the filtered rows, so narrowing to Japanese
 * films re-answers every question rather than just hiding rows.
 *
 * `coverage` still comes first, because the page has to be able to say what it
 * has not resolved yet rather than quietly under-reporting.
 */
async function computeAnalytics(db, userId, options = {}) {
  const dimension = DIMENSIONS[options.dimension] ? options.dimension : DEFAULT_DIMENSION;
  const applied = options.filters || {};

  const allRows = await readDiary(db, userId);
  const rows = applyFilters(allRows, applied);

  const films = new Set(rows.map((r) => r.filmKey));
  const resolvedFilms = new Set(rows.filter((r) => r.resolved).map((r) => r.filmKey));
  // Films the lookup has already given its final answer on: TMDB had nothing
  // under that name and year (the empty-string marker), or the only match was a
  // series, which has no entry in the film details cache. Counting these as
  // pending would leave the page permanently offering a lookup that can never
  // move, so they are reported on their own line instead.
  const unmatchedFilms = new Set(
    rows
      .filter((r) => !r.resolved && r.itemId !== null && !String(r.itemId).startsWith('movie-'))
      .map((r) => r.filmKey)
  );
  for (const key of resolvedFilms) unmatchedFilms.delete(key);

  const summary = buildSummary(rows);
  const overallMean = summary.meanRating;

  const payload = {
    dimension,
    // Every lens the client may offer, named by the server so the two cannot
    // drift out of step.
    dimensions: Object.entries(DIMENSIONS).map(([id, spec]) => ({
      id, title: spec.title, needsLookup: Boolean(spec.needsResolved),
    })),
    filters: {
      applied: describeApplied(applied),
      // Counted against the whole history, minus each facet's own filter.
      available: buildFacets(allRows, applied),
    },
    // What the filters did, so the page can say "412 of 1,782 films" rather
    // than looking like the library shrank.
    scope: {
      films: films.size,
      filmsTotal: countFilms(allRows),
      filtered: Object.keys(applied).length > 0,
    },
    coverage: {
      films: films.size,
      resolved: resolvedFilms.size,
      pending: films.size - resolvedFilms.size - unmatchedFilms.size,
      unmatched: unmatchedFilms.size,
      // The sections below that need TMDB; everything else works regardless.
      needsResolution: ['genres', 'directors', 'cast', 'affinity', 'runtime'],
    },
    // The headline numbers stay on every lens: they are the context the rest
    // of the view is read against, and they cost nothing to compute.
    summary,
    breakdown: buildBreakdown(dimension, rows, overallMean),
    rating: null,
    eras: null,
    collection: null,
    highlights: null,
    quadrant: null,
    mosaic: null,
    watchlist: null,
    profile: null,
  };

  // The posters and the quadrant belong to the overview — the lens people land
  // on — and the quadrant is repeated on the genre lens it is built from.
  // The mosaic rides on every lens, not just the overview: it is a couple of
  // dozen small rows, and the share card is built from whatever lens the reader
  // happens to be on — a card with no artwork would be a poor one.
  // Still computed on every lens, but no longer rendered on the page: the share
  // card is built from whichever lens the reader is on, and a card with no
  // artwork on it would be a poor one. The page itself now shows `profile`,
  // which answers something a wall of favourites could not.
  payload.mosaic = buildMosaic(rows);
  if (dimension === 'overview') {
    payload.profile = buildProfile(rows);
    payload.watchlist = buildWatchlist(await readWatchlist(db, userId), allRows);
  }
  if (dimension === 'overview' || dimension === 'genres') {
    payload.quadrant = buildQuadrant(rows);
  }

  // Ratings, and the overview that leads with them.
  if (dimension === 'overview' || dimension === 'ratings') {
    payload.rating = buildRating(rows);
  }
  // The decade lens is the one place the release-year spread and the gap
  // between release and viewing belong.
  if (dimension === 'decades') {
    payload.eras = buildEras(rows);
  }
  if (dimension === 'tags') {
    payload.collection = buildCollection(rows);
  }
  // The overview's job is to point at the other lenses, so it carries the top
  // of each rather than a full ranking of any.
  if (dimension === 'overview') {
    const top = (id) => {
      const b = buildBreakdown(id, rows, overallMean);
      return b ? { id, title: b.title, entries: b.entries.slice(0, 3) } : null;
    };
    payload.highlights = ['directors', 'genres', 'cast', 'languages', 'decades']
      .map(top)
      .filter(Boolean);
  }

  return payload;
}

module.exports = {
  parseFilters,
  DIMENSIONS,
  ensureAnalyticsTables,
  computeAnalytics,
  readDiary,
  invalidateDiary,
  buildSummary,
  buildRating,
  buildEras,
  buildCollection,
  buildProfile,
  MIN_FILMS_FOR_AFFINITY,
};
