'use strict';

/**
 * Changing what VOD means has to reach rows already written.
 *
 * Nothing in this app refreshes on a clock: a catalog row and a watchlist
 * availability row are both served until someone presses Refresh Catalog. So
 * when the provider rules change — VOD now reads rentals only and leaves
 * Fandango out — every row written under the old rules goes on showing a
 * buy-only title, or a Fandango chip, indefinitely. The provider config
 * version is how a deploy says "those rows answer an old question".
 */

const { createTestDb, closeDb } = require('../testHelpers');
const { ensureCatalogTables } = require('../../catalogCache');

const run = (db, sql, p = []) => new Promise((r, j) => db.run(sql, p, (e) => (e ? j(e) : r())));
const get = (db, sql, p = []) => new Promise((r, j) => db.get(sql, p, (e, row) => (e ? j(e) : r(row))));

describe('a deploy that changes the provider rules', () => {
  let db;
  beforeEach(async () => { db = await createTestDb(); });
  afterEach(() => closeDb(db));

  async function seedUnderOldRules() {
    await run(db, `UPDATE app_settings SET value = '4' WHERE key = 'provider_config_version'`);
    await run(db, `INSERT INTO catalog_cache_state (scope_key, platforms_json, languages_json, region, last_synced_at, item_count)
                   VALUES ('region:US|platforms:vod|languages:', '["vod"]', '[]', 'US', ?, 1)`, [new Date().toISOString()]);
    await run(db, `INSERT INTO watchlist_streaming_cache (user_id, item_id, checked_at, purchase_on_json)
                   VALUES ('1', 'movie-1', ?, '[{"name":"Fandango At Home","tiers":["buy"]}]')`, [new Date().toISOString()]);
  }

  test('sends every catalog scope back to be resynced', async () => {
    await seedUnderOldRules();
    await ensureCatalogTables(db);
    expect(await get(db, 'SELECT COUNT(*) AS n FROM catalog_cache_state')).toEqual({ n: 0 });
  });

  test('marks cached watchlist availability for re-fetch, without deleting it', async () => {
    // Marked rather than deleted, as the refresh button does: a re-fetch that
    // fails must still have the old answer to fall back on.
    await seedUnderOldRules();
    await ensureCatalogTables(db);
    const row = await get(db, "SELECT checked_at, purchase_on_json FROM watchlist_streaming_cache WHERE item_id = 'movie-1'");
    expect(row.checked_at).toBe('1970-01-01T00:00:00.000Z');
    expect(row.purchase_on_json).toContain('Fandango');
  });

  test('runs once, not on every boot', async () => {
    await seedUnderOldRules();
    await ensureCatalogTables(db);
    await run(db, `UPDATE watchlist_streaming_cache SET checked_at = '2026-11-02T00:00:00.000Z'`);
    await ensureCatalogTables(db);
    const row = await get(db, "SELECT checked_at FROM watchlist_streaming_cache WHERE item_id = 'movie-1'");
    expect(row.checked_at).toBe('2026-11-02T00:00:00.000Z');
  });
});
