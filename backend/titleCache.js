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
       (media_type, tmdb_id, payload_json, series_status, next_air_date, last_air_date, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      mediaType,
      tmdbId,
      JSON.stringify(payload),
      series.status,
      series.nextAirDate,
      series.lastAirDate,
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
  readSeriesStatuses,
};
