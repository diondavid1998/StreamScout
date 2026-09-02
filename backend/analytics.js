'use strict';

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
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_lbx_entries_user ON letterboxd_entries(user_id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_lbx_entries_film ON letterboxd_entries(user_id, film_key)');
}

/**
 * Every diary row, with whatever metadata has resolved for its film.
 *
 * A LEFT JOIN, deliberately: a film whose details have never been fetched still
 * has a rating and a date, and must still count in every section that does not
 * need TMDB.
 */
async function readDiary(db, userId) {
  const rows = await all(
    db,
    `SELECT e.name, e.year, e.film_key, e.rating, e.watched_on, e.is_rewatch,
            e.tags_json, e.item_id,
            d.payload_json, d.original_language,
            tr.rating_imdb_num AS crowd_rating
       FROM letterboxd_entries e
       LEFT JOIN title_details_cache d
              ON d.media_type = 'movie'
             AND ('movie-' || d.tmdb_id) = e.item_id
       LEFT JOIN title_ratings tr ON tr.imdb_id = d.imdb_id
      WHERE e.user_id = ?`,
    [userId]
  );

  return rows.map((row) => {
    let details = null;
    if (row.payload_json) { try { details = JSON.parse(row.payload_json); } catch { /* ignore */ } }
    let tags = [];
    try { tags = JSON.parse(row.tags_json || '[]'); } catch { /* ignore */ }
    return {
      name: row.name,
      year: row.year,
      filmKey: row.film_key,
      rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
      watchedOn: row.watched_on,
      isRewatch: Boolean(row.is_rewatch),
      tags,
      resolved: Boolean(details),
      genres: details?.genres || [],
      directors: details?.directors || [],
      cast: (details?.cast || []).map((c) => c.name),
      runtime: details?.runtime || null,
      language: row.original_language || null,
      // IMDb's audience score, rebased from /10 to the same 5-star scale the
      // user's own ratings use, so "you versus the crowd" subtracts like for like.
      crowdRating: row.crowd_rating === null || row.crowd_rating === undefined
        ? null
        : Number(row.crowd_rating) / 2,
    };
  });
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
    rewatches: rows.filter((r) => r.isRewatch).length,
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
 * Tags and rewatch counts survive because neither needs a date.
 */
function buildCollection(rows) {
  const tagCounts = new Map();
  for (const row of rows) for (const tag of row.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);

  // A rewatch shows up two different ways depending on the export.
  //
  // With a diary, the same film has several rows and counting them is enough.
  // Without one, the film has a single row carrying Rewatch=Yes — so counting
  // rows alone reported zero rewatched films on an export whose summary said
  // five. A flagged row means at least one viewing before it, so the count is
  // the greater of the two readings.
  const viewings = new Map();
  for (const row of rows) {
    const entry = viewings.get(row.filmKey)
      || { name: row.name, year: row.year, rows: 0, flagged: 0 };
    entry.rows += 1;
    if (row.isRewatch) entry.flagged += 1;
    viewings.set(row.filmKey, entry);
  }

  const rewatched = [...viewings.values()]
    .map((f) => ({
      name: f.name,
      year: f.year,
      viewings: Math.max(f.rows, f.flagged + 1),
    }))
    .filter((f) => f.viewings > 1);

  return {
    topTags: [...tagCounts.entries()].map(([tag, films]) => ({ tag, films }))
      .sort((a, b) => b.films - a.films).slice(0, TOP_N),
    mostRewatched: rewatched.sort((a, b) => b.viewings - a.viewings).slice(0, TOP_N),
  };
}

/**
 * The heart of the page: who and what a history is made of, and how it was
 * rated.
 *
 * Every list here carries a mean alongside its count, because the count on its
 * own answers the less interesting half of the question — seeing forty thrillers
 * says something, but rating them half a star below your own average says more.
 *
 * `delta` is that comparison made explicit: the group's mean against the
 * overall mean, so a reader does not have to hold their own average in their
 * head while scanning a list.
 */
function buildPeopleAndGenres(rows, overallMean) {
  const resolved = rows.filter((r) => r.resolved);

  const withDelta = (list) => list.map((entry) => ({
    ...entry,
    delta: entry.meanRating !== null && overallMean !== null
      ? round(entry.meanRating - overallMean)
      : null,
  }));

  const genres = withDelta(rankBy(groupBy(resolved, (r) => r.genres)));
  const directors = withDelta(rankBy(groupBy(resolved, (r) => r.directors)));
  const cast = withDelta(rankBy(groupBy(resolved, (r) => r.cast)));

  // A single film is an anecdote, not a preference — so the "you love this
  // person" list needs a floor, where the most-watched lists do not.
  const ranked = (list) => list
    .filter((d) => d.films >= MIN_FILMS_FOR_AFFINITY && d.delta !== null)
    .sort((a, b) => b.delta - a.delta);

  const directorAffinity = ranked(directors);
  const castAffinity = ranked(cast);
  const genreRanked = genres.filter((g) => g.delta !== null).sort((a, b) => b.delta - a.delta);

  return {
    genres: genres.slice(0, TOP_N),
    directors: directors.slice(0, TOP_N),
    cast: cast.slice(0, TOP_N),
    // Best and worst treated, from the same ranking, so the two ends are
    // guaranteed to be measured the same way.
    affinity: directorAffinity.slice(0, TOP_N),
    leastFavouriteDirectors: directorAffinity.slice(-TOP_N).reverse(),
    castAffinity: castAffinity.slice(0, TOP_N),
    bestRatedGenres: genreRanked.slice(0, TOP_N),
    worstRatedGenres: genreRanked.slice(-TOP_N).reverse(),
  };
}

/**
 * The whole payload. `coverage` comes first because the page has to be able to
 * say what it has not resolved yet rather than quietly under-reporting.
 */
async function computeAnalytics(db, userId) {
  const rows = await readDiary(db, userId);
  const films = new Set(rows.map((r) => r.filmKey));
  const resolvedFilms = new Set(rows.filter((r) => r.resolved).map((r) => r.filmKey));
  const summary = buildSummary(rows);
  const overallMean = summary.meanRating;

  return {
    coverage: {
      films: films.size,
      resolved: resolvedFilms.size,
      pending: films.size - resolvedFilms.size,
      // The sections below that need TMDB; everything else works regardless.
      needsResolution: ['genres', 'directors', 'cast', 'affinity', 'runtime'],
    },
    summary,
    rating: buildRating(rows),
    eras: buildEras(rows),
    collection: buildCollection(rows),
    people: buildPeopleAndGenres(rows, overallMean),
  };
}

module.exports = {
  ensureAnalyticsTables,
  computeAnalytics,
  readDiary,
  buildSummary,
  buildRating,
  buildEras,
  buildCollection,
  buildPeopleAndGenres,
  MIN_FILMS_FOR_AFFINITY,
};
