'use strict';

/**
 * What a cold scope does when its first sync cannot finish.
 *
 * Ticking a service in Settings changes the scope key — the platform list is
 * part of it — so the catalog for that selection starts empty and has to be
 * built. `ensureScopeSynced` fires that build in the background and returns
 * straight away, which is right: nobody should wait a minute on a page load.
 *
 * But when the build failed, three things used to be wrong at once. Nothing was
 * recorded, so the app got an empty list with `refreshing: false` and no error —
 * indistinguishable from a service that carries nothing. No state row was
 * written, so the scope stayed cold and the *next* request started the whole
 * thousand-request sweep again. And that restart is what turns one refusal into
 * a rate-limited hour.
 */

process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || 'test-key';

// catalogCache destructures its TMDB entry point at require time, so a spy on
// the module object would never be seen. The fetch itself is the one boundary
// mocked here; everything below it is the real cache.
jest.mock('../../movieService', () => ({
  ...jest.requireActual('../../movieService'),
  fetchCatalogByPlatforms: jest.fn(),
}));

const { createTestDb, closeDb } = require('../testHelpers');
const movieService = require('../../movieService');
const {
  buildScopeKey, ensureScopeSynced, syncScope, readCachedCatalog, resetSyncFailures,
} = require('../../catalogCache');

const PLATFORMS = ['netflix', 'vod'];
const SCOPE = buildScopeKey(PLATFORMS, 'US', []);
const scopeArgs = { platforms: PLATFORMS, languages: [], region: 'US' };

const readMeta = (db) => readCachedCatalog(db, {
  scopeKey: SCOPE, mediaType: 'all', sortBy: 'popularity', page: 1, pageSize: 24,
  serviceFilters: PLATFORMS,
}).then((r) => r.meta);

describe('a cold scope whose first sync fails', () => {
  let db, spy;

  beforeEach(async () => {
    db = await createTestDb();
    resetSyncFailures();
    spy = movieService.fetchCatalogByPlatforms;
    spy.mockReset();
  });
  afterEach(async () => { spy.mockReset(); resetSyncFailures(); await closeDb(db); });

  test('says why the shelf is empty instead of letting it read as empty', async () => {
    spy.mockRejectedValue(new Error('TMDB stopped answering while loading your services.'));

    await expect(syncScope(db, scopeArgs)).rejects.toThrow();

    const meta = await readMeta(db);
    expect(meta.resultCount).toBe(0);
    // Without this the app shows a blank grid, no spinner, no explanation.
    expect(meta.syncError).toMatch(/stopped answering/i);
    expect(meta.refreshing).toBe(false);
  });

  test('does not restart the sweep on every request while it is failing', async () => {
    spy.mockRejectedValue(new Error('429'));

    await ensureScopeSynced(db, scopeArgs);
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).toHaveBeenCalledTimes(1);

    // A thousand-request sweep per page load is how a single refusal becomes a
    // rate limit that lasts. The cooldown is the thing that stops the spiral.
    await ensureScopeSynced(db, scopeArgs);
    await ensureScopeSynced(db, scopeArgs);
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('a failure that has since been fixed is not reported again later', async () => {
    // A state row is not forever: a deploy that changes the provider ids drops
    // every one of them, and the refresh button clears the scope's own. So a
    // scope that failed, then synced fine, can go cold again months later — and
    // a failure record left lying around would explain that fresh empty shelf
    // with an outage that ended long ago.
    spy.mockRejectedValueOnce(new Error('429'));
    await expect(syncScope(db, scopeArgs)).rejects.toThrow();
    expect((await readMeta(db)).syncError).toBe('429');

    spy.mockResolvedValue({ items: [], meta: {} });
    await syncScope(db, scopeArgs);

    await new Promise((res, rej) =>
      db.run('DELETE FROM catalog_cache_state WHERE scope_key = ?', [SCOPE], (e) => (e ? rej(e) : res())));

    expect((await readMeta(db)).syncError).toBeNull();
  });

  test('a shelf that filled earlier is not called broken by a later failure', async () => {
    // Once a scope has a state row it has a real catalog behind it, and a
    // refresh that fails is a refresh that failed — not an empty catalog. The
    // titles on screen are still true.
    spy.mockResolvedValue({ items: [], meta: {} });
    await syncScope(db, scopeArgs);

    resetSyncFailures();
    spy.mockRejectedValue(new Error('429'));
    await expect(syncScope(db, scopeArgs)).rejects.toThrow();

    expect((await readMeta(db)).syncError).toBeNull();
  });
});
