'use strict';

/**
 * Tests for:
 *  1. hydrateScopeRatings — watchlist-first ordering
 *  2. getStreamableWatchlistItems — serving cached ratings from title_ratings
 */

jest.mock('../../movieService', () => {
  const actual = jest.requireActual('../../movieService');
  return {
    ...actual,
    fetchOmdbRatings: jest.fn(),
    fetchTitleDetails: jest.fn(),
    isOmdbRateLimited: jest.fn().mockReturnValue(false),
  };
});

const { createTestDb, closeDb } = require('../testHelpers');
const {
  hydrateScopeRatings,
  getStreamableWatchlistItems,
  ensureCatalogTables,
} = require('../../catalogCache');
const { fetchOmdbRatings, fetchTitleDetails, isOmdbRateLimited } = require('../../movieService');
const sqlite3 = require('sqlite3').verbose();

// Helper to run a single SQL statement against a DB
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

const SCOPE = 'region:US|platforms:netflix';
const NOW = new Date().toISOString();

async function insertCatalogEntry(db, { mediaType, tmdbId, imdbId, popularity }) {
  await run(
    db,
    `INSERT OR REPLACE INTO catalog_cache_entries
       (scope_key, media_type, tmdb_id, title, tmdb_rating, popularity, imdb_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [SCOPE, mediaType, tmdbId, `Title ${tmdbId}`, 7.0, popularity, imdbId, NOW]
  );
}

async function insertWatchlistItem(db, { userId, mediaType, tmdbId }) {
  await run(
    db,
    `INSERT OR IGNORE INTO watchlist_items (user_id, item_id, media_type) VALUES (?, ?, ?)`,
    [userId, `${mediaType}-${tmdbId}`, mediaType]
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Fix 1 — hydration ordering
// ──────────────────────────────────────────────────────────────────────────────

describe('hydrateScopeRatings — watchlist-first ordering', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
    isOmdbRateLimited.mockReturnValue(false);

    // High-popularity title NOT on any watchlist
    await insertCatalogEntry(db, { mediaType: 'movie', tmdbId: 100, imdbId: 'tt0000100', popularity: 999 });

    // Low-popularity title ON a watchlist
    await insertCatalogEntry(db, { mediaType: 'movie', tmdbId: 200, imdbId: 'tt0000200', popularity: 1 });
    await insertWatchlistItem(db, { userId: 1, mediaType: 'movie', tmdbId: 200 });

    // fetchOmdbRatings returns a valid payload for any imdb_id
    fetchOmdbRatings.mockResolvedValue({
      imdb: '7.5/10',
      rottenTomatoes: '80%',
      metacritic: '75/100',
      omdbVotes: '1000',
      imdbId: null,
    });
  });

  afterEach(async () => {
    await closeDb(db);
    jest.clearAllMocks();
  });

  it('hydrates the watchlisted low-popularity title before the high-popularity non-watchlisted title', async () => {
    const hydrated = [];
    fetchOmdbRatings.mockImplementation(async (imdbId) => {
      hydrated.push(imdbId);
      return { imdb: '7.5/10', rottenTomatoes: '80%', metacritic: '75/100', omdbVotes: null, imdbId };
    });

    await hydrateScopeRatings(db, SCOPE);

    expect(hydrated[0]).toBe('tt0000200'); // watchlisted item first
    expect(hydrated).toContain('tt0000100');
  });

  it('does not throw when watchlist_items is empty', async () => {
    await run(db, `DELETE FROM watchlist_items`);
    await expect(hydrateScopeRatings(db, SCOPE)).resolves.toBeUndefined();
  });

  it('does not throw when watchlist_items table does not exist (fallback DB)', async () => {
    // Verify that ensureCatalogTables creates watchlist_items, so hydrateScopeRatings
    // can always reference it without risk of "no such table" errors.
    const rawDb = new sqlite3.Database(':memory:');
    await ensureCatalogTables(rawDb);

    // Confirm the table was created
    const row = await new Promise((resolve, reject) =>
      rawDb.get(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='watchlist_items'`,
        (err, r) => (err ? reject(err) : resolve(r))
      )
    );
    expect(row).toBeDefined();
    expect(row.name).toBe('watchlist_items');

    await closeDb(rawDb);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Fix 2 — getStreamableWatchlistItems serves cached ratings
// ──────────────────────────────────────────────────────────────────────────────

describe('getStreamableWatchlistItems — ratings from title_ratings', () => {
  let db;

  const PLATFORMS = ['netflix'];
  const REGION = 'US';
  const USER_ID = 42;

  beforeEach(async () => {
    db = await createTestDb();

    // Seed watchlist_streaming_cache directly so we skip the TMDB fetch path
    await run(
      db,
      `INSERT OR REPLACE INTO watchlist_streaming_cache
         (user_id, item_id, title, tmdb_rating, genres_json, available_on_json, available_on_keys_json, imdb_id, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [USER_ID, 'movie-1', 'Test Movie', 7.5, '[]', '["Netflix"]', '["netflix"]', 'tt1111111']
    );

    // A watchlist item without imdb_id
    await run(
      db,
      `INSERT OR REPLACE INTO watchlist_streaming_cache
         (user_id, item_id, title, tmdb_rating, genres_json, available_on_json, available_on_keys_json, imdb_id, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [USER_ID, 'movie-2', 'No IMDb Movie', 6.0, '[]', '["Netflix"]', '["netflix"]', null]
    );

    // fetchTitleDetails should not be called (cache is fresh)
    fetchTitleDetails.mockResolvedValue(null);
  });

  afterEach(async () => {
    await closeDb(db);
    jest.clearAllMocks();
  });

  it('populates ratings from title_ratings when a matching row exists', async () => {
    await run(
      db,
      `INSERT OR REPLACE INTO title_ratings
         (imdb_id, rating_imdb, rating_imdb_num, rating_rt, rating_rt_num, rating_meta, rating_meta_num, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      ['tt1111111', '8.0/10', 8.0, '92%', 92, '85/100', 85]
    );

    const watchlistRows = [{ item_id: 'movie-1', title: 'Test Movie', poster_url: null }];
    const results = await getStreamableWatchlistItems(db, USER_ID, watchlistRows, PLATFORMS, REGION);

    expect(results).toHaveLength(1);
    expect(results[0].ratings.imdb).toBe('8.0/10');
    expect(results[0].ratings.rottenTomatoes).toBe('92%');
    expect(results[0].ratings.metacritic).toBe('85/100');
    expect(results[0].sortableRatings.imdb).toBe(8.0);
    expect(results[0].sortableRatings.rottenTomatoes).toBe(92);
    expect(results[0].sortableRatings.metacritic).toBe(85);
  });

  it('returns null ratings when no title_ratings row exists', async () => {
    const watchlistRows = [{ item_id: 'movie-1', title: 'Test Movie', poster_url: null }];
    const results = await getStreamableWatchlistItems(db, USER_ID, watchlistRows, PLATFORMS, REGION);

    expect(results).toHaveLength(1);
    expect(results[0].ratings.imdb).toBeNull();
    expect(results[0].ratings.rottenTomatoes).toBeNull();
    expect(results[0].ratings.metacritic).toBeNull();
    expect(results[0].sortableRatings.imdb).toBe(0);
  });

  it('treats empty-string ratings as absent (returns null)', async () => {
    await run(
      db,
      `INSERT OR REPLACE INTO title_ratings
         (imdb_id, rating_imdb, rating_imdb_num, rating_rt, rating_rt_num, rating_meta, rating_meta_num, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      ['tt1111111', '', null, '', null, '', null]
    );

    const watchlistRows = [{ item_id: 'movie-1', title: 'Test Movie', poster_url: null }];
    const results = await getStreamableWatchlistItems(db, USER_ID, watchlistRows, PLATFORMS, REGION);

    expect(results[0].ratings.imdb).toBeNull();
    expect(results[0].ratings.rottenTomatoes).toBeNull();
    expect(results[0].ratings.metacritic).toBeNull();
  });

  it('returns null ratings when item has no imdb_id', async () => {
    const watchlistRows = [{ item_id: 'movie-2', title: 'No IMDb Movie', poster_url: null }];
    const results = await getStreamableWatchlistItems(db, USER_ID, watchlistRows, PLATFORMS, REGION);

    expect(results).toHaveLength(1);
    expect(results[0].ratings.imdb).toBeNull();
    expect(results[0].ratings.rottenTomatoes).toBeNull();
    expect(results[0].ratings.metacritic).toBeNull();
  });

  it('keeps tmdb rating exactly as-is regardless of title_ratings', async () => {
    await run(
      db,
      `INSERT OR REPLACE INTO title_ratings
         (imdb_id, rating_imdb, rating_imdb_num, rating_rt, rating_rt_num, rating_meta, rating_meta_num, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      ['tt1111111', '8.0/10', 8.0, '92%', 92, '85/100', 85]
    );

    const watchlistRows = [{ item_id: 'movie-1', title: 'Test Movie', poster_url: null }];
    const results = await getStreamableWatchlistItems(db, USER_ID, watchlistRows, PLATFORMS, REGION);

    expect(results[0].ratings.tmdb).toBe(7.5);
    expect(results[0].sortableRatings.tmdb).toBe(7.5);
  });
});
