'use strict';

/**
 * Regression tests for backfillScopeIdentifiers.
 *
 * The bug these guard: writing NULL back for a title TMDB has no IMDb ID for
 * left the row matching the loop's own `WHERE imdb_id IS NULL` predicate, so
 * the same batch was re-selected forever — roughly 1,000 TMDB calls a second
 * from a single unresolvable title.
 */

jest.mock('../../movieService', () => {
  const actual = jest.requireActual('../../movieService');
  return {
    ...actual,
    fetchTitleDetails: jest.fn(),
    fetchOmdbRatings: jest.fn().mockResolvedValue(null),
    isOmdbRateLimited: jest.fn().mockReturnValue(true),
  };
});

const { createTestDb, closeDb } = require('../testHelpers');
const {
  backfillScopeIdentifiers,
  readCachedCatalog,
  NO_IMDB_ID,
} = require('../../catalogCache');
const { fetchTitleDetails } = require('../../movieService');

const SCOPE = 'region:US|platforms:netflix|languages:';

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
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function insertEntry(db, { mediaType = 'tv', tmdbId, imdbId = null }) {
  await run(
    db,
    `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, imdb_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [SCOPE, mediaType, tmdbId, `Title ${tmdbId}`, imdbId, new Date().toISOString()]
  );
}

describe('backfillScopeIdentifiers', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await closeDb(db);
  });

  it('asks TMDB once for a title that has no IMDb ID, then stops', async () => {
    await insertEntry(db, { tmdbId: 999 });
    fetchTitleDetails.mockResolvedValue({ external_ids: { imdb_id: null } });

    await backfillScopeIdentifiers(db, SCOPE);

    expect(fetchTitleDetails).toHaveBeenCalledTimes(1);
  });

  it('records NO_IMDB_ID so the row is never re-queued', async () => {
    await insertEntry(db, { tmdbId: 999 });
    fetchTitleDetails.mockResolvedValue({ external_ids: { imdb_id: null } });

    await backfillScopeIdentifiers(db, SCOPE);

    const rows = await all(db, 'SELECT imdb_id FROM catalog_cache_entries WHERE tmdb_id = 999');
    expect(rows[0].imdb_id).toBe(NO_IMDB_ID);

    // A second pass must not call TMDB again.
    await backfillScopeIdentifiers(db, SCOPE);
    expect(fetchTitleDetails).toHaveBeenCalledTimes(1);
  });

  it('still stores a real IMDb ID when TMDB has one', async () => {
    await insertEntry(db, { tmdbId: 111 });
    fetchTitleDetails.mockResolvedValue({ external_ids: { imdb_id: 'tt0000111' } });

    await backfillScopeIdentifiers(db, SCOPE);

    const rows = await all(db, 'SELECT imdb_id FROM catalog_cache_entries WHERE tmdb_id = 111');
    expect(rows[0].imdb_id).toBe('tt0000111');
  });

  it('resolves a mixed batch in a single pass', async () => {
    await insertEntry(db, { tmdbId: 1 });
    await insertEntry(db, { tmdbId: 2 });
    await insertEntry(db, { tmdbId: 3 });
    fetchTitleDetails.mockImplementation(async (_mediaType, tmdbId) => ({
      external_ids: { imdb_id: tmdbId === 2 ? null : `tt000000${tmdbId}` },
    }));

    await backfillScopeIdentifiers(db, SCOPE);

    expect(fetchTitleDetails).toHaveBeenCalledTimes(3);
    const rows = await all(
      db,
      'SELECT tmdb_id, imdb_id FROM catalog_cache_entries ORDER BY tmdb_id'
    );
    expect(rows.map((r) => r.imdb_id)).toEqual(['tt0000001', NO_IMDB_ID, 'tt0000003']);
  });
});

describe('readCachedCatalog backfill trigger', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await closeDb(db);
  });

  it('does not re-trigger the backfill for entries already resolved to NO_IMDB_ID', async () => {
    await insertEntry(db, { tmdbId: 555, imdbId: NO_IMDB_ID });
    fetchTitleDetails.mockResolvedValue({ external_ids: { imdb_id: null } });

    await readCachedCatalog(db, { scopeKey: SCOPE });
    // The backfill is fired without await, so give the microtask queue a turn.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchTitleDetails).not.toHaveBeenCalled();
  });

  it('does trigger the backfill for entries never asked about', async () => {
    await insertEntry(db, { tmdbId: 556, imdbId: null });
    fetchTitleDetails.mockResolvedValue({ external_ids: { imdb_id: 'tt0000556' } });

    await readCachedCatalog(db, { scopeKey: SCOPE });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchTitleDetails).toHaveBeenCalledTimes(1);
  });
});
