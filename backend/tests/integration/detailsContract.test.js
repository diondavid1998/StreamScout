'use strict';

/**
 * The shape the title sheet decodes.
 *
 * The cached payload stores people as `{ id, name }` so the analytics page can
 * group a history by who someone *is* rather than by a display string. The app
 * was never told. Its `TitleDetails` still declared `directors: [String]?`, and
 * a Swift optional only forgives a missing key — an array of objects where it
 * expects strings throws, and the throw discards the whole response. So every
 * title sheet lost its cast, directors, genres, runtime and tagline together and
 * said "Could not load cast & details." instead.
 *
 * It spread rather than broke at once: a payload cached before the change kept
 * decoding, and the sentinel that marks old payloads stale refetched each one,
 * in the new shape, the next time it was opened.
 *
 * The installed app cannot be fixed from here, so the server keeps the contract
 * it was built against. The ids stay in the cache, where analytics reads them.
 */

process.env.JWT_SECRET = 'details-contract-secret';
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || 'test-key';

const request = require('supertest');
const { createApp } = require('../../app');
const { createTestDb, closeDb } = require('../testHelpers');
const { clearApiCaches, resetTmdbBreaker } = require('../../movieService');

const FIGHT_CLUB = {
  id: 550, title: 'Fight Club', release_date: '1999-10-15', runtime: 139, overview: 'x',
  tagline: 'Mischief. Mayhem. Soap.', genres: [{ id: 18, name: 'Drama' }],
  vote_average: 8.4, vote_count: 30000, original_language: 'en',
  credits: {
    cast: [{ id: 819, name: 'Edward Norton', character: 'Narrator', profile_path: '/a.jpg' }],
    crew: [
      { id: 7467, name: 'David Fincher', job: 'Director' },
      { id: 7468, name: 'Jim Uhls', job: 'Screenplay' },
    ],
  },
  external_ids: { imdb_id: 'tt0137523' }, keywords: { keywords: [] }, release_dates: { results: [] },
};

describe('GET /titles/:mediaType/:id/details', () => {
  let db, app, auth;

  beforeEach(async () => {
    resetTmdbBreaker(); clearApiCaches();
    global.fetch = jest.fn(async (url) => {
      const path = new URL(url).pathname;
      const body = path === '/3/movie/550' ? FIGHT_CLUB : {};
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    });
    db = await createTestDb();
    app = createApp(db);
    const { body } = await request(app).post('/register')
      .send({ username: 'contract', password: 'password123' });
    auth = { Authorization: `Bearer ${body.token}` };
  });
  afterEach(async () => { delete global.fetch; clearApiCaches(); await closeDb(db); });

  const open = () => request(app).get('/titles/movie/550/details').set(auth);

  test('directors arrive as names, the type the app decodes', async () => {
    const { status, body } = await open();
    expect(status).toBe(200);
    // Every element a string. One object here and the app loses the sheet.
    expect(body.directors).toEqual(['David Fincher']);
  });

  test('the cast the sheet shows comes through intact', async () => {
    const { body } = await open();
    expect(body.cast).toEqual([{
      id: 819, name: 'Edward Norton', character: 'Narrator',
      profileUrl: 'https://image.tmdb.org/t/p/w185/a.jpg',
    }]);
  });

  test('the second open, served from the cache, has the same shape', async () => {
    // The cache is where the object form lives, so a cache hit is the case
    // that matters — the first open happens once per title, the rest forever.
    await open();
    global.fetch.mockClear();
    const { body } = await open();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(body.directors).toEqual(['David Fincher']);
  });

  test('the ids analytics groups on are still in the cache', async () => {
    // Translating at the response must not undo the reason for the change.
    await open();
    const row = await new Promise((res, rej) => db.get(
      "SELECT payload_json FROM title_details_cache WHERE media_type = 'movie' AND tmdb_id = 550",
      (e, r) => (e ? rej(e) : res(r))));
    expect(JSON.parse(row.payload_json).directors).toEqual([{ id: 7467, name: 'David Fincher' }]);
  });

  test('a director stored the old way, as a bare name, still arrives as one', async () => {
    // Payloads from before the change are served until something refetches
    // them, so both shapes are in the table at once.
    await open();
    await new Promise((res, rej) => db.run(
      "UPDATE title_details_cache SET payload_json = json_set(payload_json, '$.directors', json('[\"David Fincher\"]')) WHERE tmdb_id = 550",
      (e) => (e ? rej(e) : res())));
    const { body } = await open();
    expect(body.directors).toEqual(['David Fincher']);
  });
});
