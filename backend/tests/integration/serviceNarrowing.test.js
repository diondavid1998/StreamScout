'use strict';

/**
 * Narrowing the catalog to some of the services you picked.
 *
 * Two different questions were answered by one control for a long time. The
 * services tile in Settings decides what the catalog *covers* — it drives the
 * discover query and the cache scope. Nothing decided what it *shows*: the app
 * sent its whole saved selection as the service filter on every request.
 *
 * The gap was most visible with VOD. Ticking it widened the pool to everything
 * rentable, mixed in with everything a subscription already covered, and left
 * no way to look at just the rentable half — so on a popularity sort those
 * titles sat below a page of subscription hits and read as absent.
 *
 * The server could already do this; nothing asked it to. These are the
 * guarantees the new filter leans on.
 */

process.env.JWT_SECRET = 'service-narrowing-secret';
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || 'test-key';

const { createTestDb, closeDb } = require('../testHelpers');
const { readCachedCatalog, buildScopeKey } = require('../../catalogCache');

const PLATFORMS = ['netflix', 'vod'];
const SCOPE = buildScopeKey(PLATFORMS, 'US', []);

// Three shapes a row can have once a sync has resolved availability.
const ROWS = [
  { id: 1, title: 'Netflix only', on: ['Netflix'], keys: ['netflix'], buy: [] },
  { id: 2, title: 'Rent only',    on: [],          keys: ['vod'],     buy: [{ name: 'Apple TV', tiers: ['rent'] }] },
  { id: 3, title: 'Both',         on: ['Netflix'], keys: ['netflix', 'vod'], buy: [{ name: 'Amazon Video', tiers: ['rent'] }] },
];

describe('filtering the catalog to a subset of your services', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
    for (const row of ROWS) {
      await new Promise((res, rej) => db.run(
        `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, year, poster_url,
           popularity, available_on_json, available_on_keys_json, purchase_on_json, updated_at)
         VALUES (?, 'movie', ?, ?, 2020, '/p.jpg', ?, ?, ?, ?, ?)`,
        [SCOPE, row.id, row.title, 100 - row.id,
         JSON.stringify(row.on), JSON.stringify(row.keys), JSON.stringify(row.buy),
         new Date().toISOString()],
        (e) => (e ? rej(e) : res())));
    }
  });
  afterEach(() => closeDb(db));

  const show = (serviceFilters) => readCachedCatalog(db, {
    scopeKey: SCOPE, mediaType: 'all', sortBy: 'popularity', page: 1, pageSize: 24,
    serviceFilters,
  }).then((r) => r.items.map((i) => i.title));

  test('rent or buy alone shows exactly what costs money', async () => {
    // The whole point of the filter. Before it, this list was unreachable.
    expect(await show(['vod'])).toEqual(['Rent only', 'Both']);
  });

  test('one subscription alone leaves out what only rents', async () => {
    expect(await show(['netflix'])).toEqual(['Netflix only', 'Both']);
  });

  test('every service is the union, not the intersection', async () => {
    // Narrowing to both must not mean "on Netflix AND rentable" — that would
    // make picking everything show less than picking one thing.
    expect(await show(['netflix', 'vod'])).toEqual(['Netflix only', 'Rent only', 'Both']);
  });

  test('no filter shows everything the scope holds', async () => {
    // What the app sends when the reader has not narrowed anything, which is
    // the behaviour this filter had to preserve.
    expect(await show([])).toEqual(['Netflix only', 'Rent only', 'Both']);
  });

  test('a rent-only row carries the storefront that sells it', async () => {
    const { items } = await readCachedCatalog(db, {
      scopeKey: SCOPE, mediaType: 'all', sortBy: 'popularity', page: 1, pageSize: 24,
      serviceFilters: ['vod'],
    });
    const rentOnly = items.find((i) => i.title === 'Rent only');
    // Without this the card has nothing to put on it: a poster with no chip
    // cannot say why it is in a rent-or-buy list.
    expect(rentOnly.availableOn).toEqual([]);
    expect(rentOnly.purchaseOn).toEqual([{ name: 'Apple TV', tiers: ['rent'] }]);
  });

  test('one service key cannot match another it is spelled inside of', async () => {
    // The filter is a LIKE against the stored JSON array, and the pattern keeps
    // the quotes: `%"max"%`, not `%max%`. No two keys in the current list are
    // spelled inside each other, so dropping them breaks nothing today — which
    // is exactly why it would get dropped. Add `hbomax` beside `max`, or
    // `amcplus` beside `amc`, and a filter for the short one starts silently
    // returning the long one's titles.
    await new Promise((res, rej) => db.run(
      `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, year, poster_url,
         popularity, available_on_json, available_on_keys_json, purchase_on_json, updated_at)
       VALUES (?, 'movie', 99, 'On a longer key', 2020, '/p.jpg', 50, ?, ?, '[]', ?)`,
      [SCOPE, JSON.stringify(['Vod Plus']), JSON.stringify(['vodplus']), new Date().toISOString()],
      (e) => (e ? rej(e) : res())));

    expect(await show(['vod'])).toEqual(['Rent only', 'Both']);
  });

  test('the count the filter reports is the count it shows', async () => {
    const { items, meta } = await readCachedCatalog(db, {
      scopeKey: SCOPE, mediaType: 'all', sortBy: 'popularity', page: 1, pageSize: 24,
      serviceFilters: ['vod'],
    });
    expect(meta.resultCount).toBe(2);
    expect(meta.visibleCount).toBe(items.length);
    expect(meta.activeServiceFilters).toEqual(['vod']);
  });
});
