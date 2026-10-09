'use strict';

/**
 * A service selection is only ever stored in its canonical form.
 *
 * A platform key is not a label. It is persisted in `users.platforms`, it is
 * part of the catalog scope key, it is what `buildProviderSelection` turns into
 * TMDB provider ids, and it is what the service filter matches against
 * `available_on_keys_json`. An unrecognised key therefore fails three ways at
 * once and reports none of them:
 *
 *   - the providers behind it are never requested, so VOD under its old name
 *     fetched no rent or buy data at all;
 *   - it still goes into the scope key, so the reader lands on a scope nobody
 *     else shares and the sync has no reason to fill;
 *   - the filter asks for a key no cached row can carry.
 *
 * `PUT /platforms` used to store whatever array arrived, so an older client
 * naming VOD `pvod` wrote exactly that. The one-off rename repair could not
 * save it: a repair marks itself done, and the next write puts the key back.
 */

process.env.JWT_SECRET = 'platform-keys-test-secret';
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || 'test-key';

const request = require('supertest');
const { createApp } = require('../../app');
const { createTestDb, closeDb } = require('../testHelpers');
const { buildScopeKey } = require('../../catalogCache');
const { normalizePlatformKeys } = require('../../movieService');

describe('storing a service selection', () => {
  let db, app, token;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db);
    await request(app).post('/register').send({ username: 'keys', password: 'password123' });
    const res = await request(app).post('/login').send({ username: 'keys', password: 'password123' });
    token = res.body.token;
  });
  afterEach(() => closeDb(db));

  const put = (platforms) => request(app)
    .put('/platforms').set('Authorization', `Bearer ${token}`)
    .send({ platforms, languages: [] });
  const get = () => request(app).get('/platforms').set('Authorization', `Bearer ${token}`);
  const storedRow = () => new Promise((res, rej) => db.get(
    'SELECT platforms FROM users WHERE username = ?', ['keys'],
    (e, row) => (e ? rej(e) : res(JSON.parse(row.platforms)))));

  test('renames a key the app once used before writing it down', async () => {
    await put(['netflix', 'pvod']);
    // Not just in the answer — in the column, where every other reader looks.
    expect(await storedRow()).toEqual(['netflix', 'vod']);
    expect((await get()).body.platforms).toEqual(['netflix', 'vod']);
  });

  test('drops a service this server does not have', async () => {
    // The list was trimmed from thirty-one to fifteen. A selection naming one
    // of the sixteen that went would otherwise sit in the array invisibly:
    // absent from the settings screen, still poisoning the scope key.
    await put(['netflix', 'a-service-that-retired']);
    expect(await storedRow()).toEqual(['netflix']);
  });

  test('heals a row written before any of this', async () => {
    // What an older client left behind, and what the one-off repair can no
    // longer reach. The read every launch makes is what fixes it.
    await new Promise((res, rej) => db.run(
      'UPDATE users SET platforms = ? WHERE username = ?',
      [JSON.stringify(['pvod', 'netflix', 'gone']), 'keys'],
      (e) => (e ? rej(e) : res())));

    expect((await get()).body.platforms).toEqual(['vod', 'netflix']);
    expect(await storedRow()).toEqual(['vod', 'netflix']);
  });

  test('keeps a selection that was already right, and does not reorder it', async () => {
    await put(['vod', 'netflix', 'hulu']);
    expect(await storedRow()).toEqual(['vod', 'netflix', 'hulu']);
  });

  test('a stale filter from the app still asks for a key rows can carry', async () => {
    // The client sends its own saved selection as the service filter, and that
    // copy can predate a rename by a launch.
    await put(['netflix', 'vod']);
    const res = await request(app).get('/movies')
      .query({ serviceFilters: 'netflix,pvod', limit: 5 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.activeServiceFilters).toEqual(['netflix', 'vod']);
  });
});

describe('naming a catalog scope', () => {
  test('a renamed key names the same scope as the key it became', async () => {
    // Otherwise ticking VOD moved the reader to a scope that had never been
    // synced and never would be, and the catalog was empty for good.
    expect(buildScopeKey(['netflix', 'pvod'], 'US', []))
      .toBe(buildScopeKey(['netflix', 'vod'], 'US', []));
  });

  test('a dead key does not get a scope of its own', async () => {
    expect(buildScopeKey(['netflix', 'vod', 'retired'], 'US', []))
      .toBe(buildScopeKey(['vod', 'netflix'], 'US', []));
  });
});

describe('canonicalising keys', () => {
  test('renames, prunes, dedupes, and keeps the order the user chose', () => {
    expect(normalizePlatformKeys(['netflix', 'pvod', 'bogus', 'netflix', 'vod']))
      .toEqual(['netflix', 'vod']);
  });

  test('survives anything that is not a list of strings', () => {
    expect(normalizePlatformKeys(null)).toEqual([]);
    expect(normalizePlatformKeys('netflix')).toEqual([]);
    expect(normalizePlatformKeys([null, 7, {}, 'netflix'])).toEqual(['netflix']);
  });
});
