'use strict';

/**
 * A durable, per-title cache of what TMDB says about a movie or a show.
 *
 * The rule for the whole app is that a title is fetched from TMDB at most
 * twice: once because nobody had ever asked for it, and again only if someone
 * presses Refresh Catalog. There is no expiry, no nightly sweep, no TTL. A
 * detail page opened a year from now is served out of SQLite.
 *
 * Most of what this stores cannot go out of date anyway — a film's cast,
 * runtime, overview and release date are fixed the moment it ships. The parts
 * that *can* move are a series' status and its next air date, which is exactly
 * why they are lifted out into their own columns: Currently Watching reads them
 * directly, and a refresh rewrites them without anything having to re-parse the
 * blob.
 */

const { fetchTitleWithCredits } = require('./movieService');

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

function run(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); })
  );
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  );
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  );
}

async function ensureTitleCacheTables(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS title_details_cache (
      media_type    TEXT    NOT NULL,
      tmdb_id       INTEGER NOT NULL,
      payload_json  TEXT    NOT NULL,
      series_status TEXT,
      next_air_date TEXT,
      last_air_date TEXT,
      fetched_at    TEXT    NOT NULL,
      PRIMARY KEY (media_type, tmdb_id)
    )`
  );

  // Added after the table shipped, so existing rows have them as NULL. A NULL
  // imdb_id is treated as "not resolved for analytics" rather than migrated,
  // which lets the resolve step refill it on demand instead of forcing a sweep.
  const columns = await new Promise((resolve) =>
    db.all('PRAGMA table_info(title_details_cache)', [], (err, rows) => resolve(err ? [] : rows || []))
  );
  for (const [name, ddl] of [
    ['imdb_id', 'imdb_id TEXT'],
    ['original_language', 'original_language TEXT'],
    ['production_countries', 'production_countries TEXT'],
  ]) {
    if (columns.some((c) => c.name === name)) continue;
    await new Promise((resolve) =>
      db.run(`ALTER TABLE title_details_cache ADD COLUMN ${ddl}`, (err) => {
        if (err) console.warn(`Could not add title_details_cache.${name}: ${err.message}`);
        resolve();
      })
    );
  }
}

/** The three fields the Currently Watching copy is derived from. */
function seriesFields(data) {
  return {
    status: data?.status || null,
    nextAirDate: data?.next_episode_to_air?.air_date || null,
    lastAirDate: data?.last_episode_to_air?.air_date || null,
  };
}

/**
 * TMDB's payload reduced to what the clients actually render. Done once, on the
 * way into the cache, so a cache hit is a SELECT and a JSON.parse.
 */
function normalizeDetails(data, mediaType) {
  const cast = (data.credits?.cast || []).slice(0, 8).map((person) => ({
    id: person.id,
    name: person.name,
    character: person.character || person.roles?.[0]?.character || '',
    profileUrl: person.profile_path ? `${TMDB_IMAGE_BASE}/w185${person.profile_path}` : null,
  }));

  const directors =
    mediaType === 'movie'
      ? (data.credits?.crew || []).filter((m) => m.job === 'Director').map((m) => m.name)
      : (data.created_by || []).map((m) => m.name);

  return {
    id: data.id,
    mediaType,
    title: data.title || data.name,
    tagline: data.tagline || null,
    overview: data.overview || '',
    releaseDate: data.release_date || data.first_air_date || null,
    runtime: data.runtime || null,
    status: data.status || null,
    genres: (data.genres || []).map((g) => g.name),
    posterUrl: data.poster_path ? `${TMDB_IMAGE_BASE}/w500${data.poster_path}` : null,
    backdropUrl: data.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${data.backdrop_path}` : null,
    cast,
    directors,
    numberOfSeasons: data.number_of_seasons || null,
    numberOfEpisodes: data.number_of_episodes || null,
    imdbId: data.external_ids?.imdb_id || null,
    // TMDB's own audience score. Kept because it is the only crowd rating the
    // analytics page can rely on: OMDB is the other source, and its daily quota
    // rules out asking about a history of thousands of films.
    voteAverage: typeof data.vote_average === 'number' ? data.vote_average : null,
    originalLanguage: data.original_language || null,
    productionCountries: (data.production_countries || []).map((c) => c.name),
  };
}

async function readCachedDetails(db, mediaType, tmdbId) {
  const row = await get(
    db,
    'SELECT * FROM title_details_cache WHERE media_type = ? AND tmdb_id = ?',
    [mediaType, tmdbId]
  );
  if (!row) return null;
  try {
    return { payload: JSON.parse(row.payload_json), row };
  } catch {
    // A corrupt blob is treated as a miss rather than a 500; the next fetch
    // overwrites it.
    return null;
  }
}

async function storeDetails(db, mediaType, tmdbId, data) {
  const payload = normalizeDetails(data, mediaType);
  const series = seriesFields(data);
  await run(
    db,
    `INSERT OR REPLACE INTO title_details_cache
       (media_type, tmdb_id, payload_json, series_status, next_air_date, last_air_date,
        imdb_id, original_language, production_countries, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      mediaType,
      tmdbId,
      JSON.stringify(payload),
      series.status,
      series.nextAirDate,
      series.lastAirDate,
      payload.imdbId,
      payload.originalLanguage,
      JSON.stringify(payload.productionCountries || []),
      new Date().toISOString(),
    ]
  );
  return { payload, series };
}

/**
 * Details for one title, from cache when we have them.
 *
 * `forceRefresh` is the refresh button's door in, and the only one — nothing
 * else in the codebase passes it.
 */
async function getTitleDetails(db, mediaType, tmdbId, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = await readCachedDetails(db, mediaType, tmdbId);
    if (cached) return { ...cached.payload, cached: true };
  }

  const data = await fetchTitleWithCredits(mediaType, tmdbId);
  if (!data || !data.id) {
    // TMDB gave us nothing usable. Serve whatever is on disk rather than
    // failing outright — a refresh should never be able to lose data.
    const cached = await readCachedDetails(db, mediaType, tmdbId);
    if (cached) return { ...cached.payload, cached: true };
    throw new Error('Title not found');
  }

  const { payload } = await storeDetails(db, mediaType, tmdbId, data);
  return { ...payload, cached: false };
}

/** Whether a stored payload predates the audience score being kept. */
function payloadHasVoteAverage(payloadJson) {
  if (!payloadJson) return false;
  try { return 'voteAverage' in JSON.parse(payloadJson); } catch { return false; }
}

/**
 * Make sure a film's details are cached, and carry an IMDb id.
 *
 * A row written before `imdb_id` — or before the audience score — was kept is
 * complete for the detail page but short of what the analytics page needs.
 * Treating either gap as a miss refills those rows the first time someone
 * actually needs them, rather than sweeping the whole table.
 */
async function ensureAnalyticsDetails(db, tmdbId) {
  const row = await get(
    db,
    'SELECT imdb_id, payload_json FROM title_details_cache WHERE media_type = ? AND tmdb_id = ?',
    ['movie', tmdbId]
  );
  // A row stored before the audience score was kept has everything else the
  // page needs but cannot answer "versus the crowd". Treating it as a miss
  // refills it on the next lookup rather than stranding it. The test is for the
  // key, not a value: an unrated film legitimately scores null.
  if (row && row.imdb_id && payloadHasVoteAverage(row.payload_json)) return false;
  const data = await fetchTitleWithCredits('movie', tmdbId);
  if (!data?.id) return false;
  await storeDetails(db, 'movie', tmdbId, data);
  return true;
}

/** The stored schedule fields for a set of TMDB series ids, keyed by id. */
async function readSeriesStatuses(db, tmdbIds) {
  if (!tmdbIds.length) return new Map();
  const placeholders = tmdbIds.map(() => '?').join(',');
  const rows = await all(
    db,
    `SELECT tmdb_id, series_status, next_air_date, last_air_date, fetched_at
       FROM title_details_cache
      WHERE media_type = 'tv' AND tmdb_id IN (${placeholders})`,
    tmdbIds
  );
  return new Map(
    rows.map((row) => [
      row.tmdb_id,
      {
        status: row.series_status,
        nextAirDate: row.next_air_date,
        lastAirDate: row.last_air_date,
        fetchedAt: row.fetched_at,
      },
    ])
  );
}

module.exports = {
  ensureTitleCacheTables,
  normalizeDetails,
  seriesFields,
  readCachedDetails,
  storeDetails,
  getTitleDetails,
  ensureAnalyticsDetails,
  readSeriesStatuses,
};
