'use strict';

/**
 * Hide Watched has to know about films the reader watched somewhere else.
 *
 * Two importers write two different tables. The Settings import fills
 * `watched_items`; the one-button export import on the Analytics page — the
 * one people actually use, because it takes the whole folder — fills
 * `letterboxd_entries` and nothing else. Hide Watched read only the first, so a
 * history imported the second way was invisible to it: every film in it stayed
 * in the catalog no matter how long anyone waited.
 *
 * The For You page had already hit this and patched it for itself, by matching
 * titles after the query. The catalog never got the same treatment. The fix is
 * in the shared exclusion, so every page built on it agrees.
 */

process.env.JWT_SECRET = 'hide-watched-diary-secret';
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || 'test-key';

const request = require('supertest');
const { createApp } = require('../../app');
const { createTestDb, closeDb } = require('../testHelpers');
const { buildScopeKey, readCachedCatalog } = require('../../catalogCache');

const SCOPE = buildScopeKey(['netflix'], 'US', []);
const run = (db, sql, p = []) => new Promise((r, j) => db.run(sql, p, (e) => (e ? j(e) : r())));

const FILMS = [
  // id, media, title, year
  [10, 'movie', 'Resolved In Diary', 2001],
  [20, 'movie', 'Unresolved In Diary', 2002],
  [30, 'movie', 'Only On Letterboxd Watchlist', 2003],
  [40, 'movie', 'Never Seen', 2004],
  [50, 'movie', 'Marked In The App', 2005],
  [60, 'movie', 'Same Name Different Year', 2010],
];

describe('Hide Watched and the imported diary', () => {
  let db, app, auth, userId;

  beforeEach(async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => '{"results":[]}' }));
    db = await createTestDb();
    app = createApp(db);
    const { body } = await request(app).post('/register')
      .send({ username: 'diaryreader', password: 'password123' });
    auth = { Authorization: `Bearer ${body.token}` };
    await request(app).put('/platforms').set(auth).send({ platforms: ['netflix'], languages: [] });
    userId = await new Promise((r) => db.get("SELECT id FROM users WHERE username = 'diaryreader'", (e, row) => r(row.id)));

    await run(db, `INSERT INTO catalog_cache_state (scope_key, platforms_json, languages_json, region, last_synced_at, item_count)
                   VALUES (?, '["netflix"]', '[]', 'US', ?, ?)`, [SCOPE, new Date().toISOString(), FILMS.length]);
    for (const [id, mt, title, year] of FILMS) {
      await run(db, `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, year, popularity,
                       available_on_json, available_on_keys_json, purchase_on_json, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, '["Netflix"]', '["netflix"]', '[]', ?)`,
        [SCOPE, mt, id, title, year, 100 - id, new Date().toISOString()]);
    }

    const diary = (name, year, itemId, source = 'diary') => run(db,
      `INSERT INTO letterboxd_entries (user_id, name, year, film_key, item_id, source) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, name, year, `${name.toLowerCase()}|${year}`, itemId, source]);

    await diary('Resolved In Diary', 2001, 'movie-10');
    // Resolution runs when the Analytics page asks for it, so a fresh import
    // has rows with no id yet. They are still films the reader has seen.
    await diary('Unresolved In Diary', 2002, null);
    // Kept in the same table under its own source. Wanting to see a film is
    // the opposite of having seen it.
    await diary('Only On Letterboxd Watchlist', 2003, null, 'watchlist');
    // Same title, different year: a different film, not a match.
    await diary('Same Name Different Year', 1980, null);

    await request(app).post('/watched').set(auth).send({ itemId: 'movie-50', mediaType: 'movie', title: 'Marked In The App' });
  });
  afterEach(async () => { delete global.fetch; await closeDb(db); });

  const titles = async (q) => {
    const res = await request(app).get('/movies').query({ limit: 50, ...q }).set(auth);
    return res.body.items.map((i) => i.title);
  };

  test('a film from the imported diary is hidden', async () => {
    expect(await titles({ hideWatched: 'true' })).not.toContain('Resolved In Diary');
  });

  test('so is one the import has not resolved to an id yet', async () => {
    expect(await titles({ hideWatched: 'true' })).not.toContain('Unresolved In Diary');
  });

  test('a film only on the Letterboxd watchlist stays', async () => {
    expect(await titles({ hideWatched: 'true' })).toContain('Only On Letterboxd Watchlist');
  });

  test('a different film that shares a name stays', async () => {
    expect(await titles({ hideWatched: 'true' })).toContain('Same Name Different Year');
  });

  test('films marked watched in the app are still hidden too', async () => {
    expect(await titles({ hideWatched: 'true' })).not.toContain('Marked In The App');
  });

  test('exactly the unseen films remain, and the count agrees', async () => {
    const res = await request(app).get('/movies').query({ limit: 50, hideWatched: 'true' }).set(auth);
    expect(res.body.items.map((i) => i.title).sort()).toEqual(
      ['Never Seen', 'Only On Letterboxd Watchlist', 'Same Name Different Year']);
    expect(res.body.meta.resultCount).toBe(3);
  });

  test('with the filter off, nothing is hidden', async () => {
    expect(await titles({})).toHaveLength(FILMS.length);
  });

  test('an explicit "false" shows everything, and so does no value at all', async () => {
    // The app now always says which it wants, because hiding is on by default
    // there and "false" is how the reader turns it off. No value must keep
    // meaning off: builds already installed send nothing when it is off, and
    // a server default of on would leave them no way to show watched films.
    expect(await titles({ hideWatched: 'false' })).toHaveLength(FILMS.length);
    expect(await titles({})).toHaveLength(FILMS.length);
    expect(await titles({ hideWatched: 'true' })).toHaveLength(3);
  });

  test('another reader\'s diary hides nothing of yours', async () => {
    // The exclusion is keyed on the reader. A shared catalog scope must not
    // carry one person's history into someone else's view.
    const other = await readCachedCatalog(db, {
      scopeKey: SCOPE, mediaType: 'all', sortBy: 'popularity', page: 1, pageSize: 50,
      excludeWatchedForUserId: userId + 999,
    });
    expect(other.items).toHaveLength(FILMS.length);
  });
});
