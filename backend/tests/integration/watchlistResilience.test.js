'use strict';

/**
 * A saved film must not vanish from the watchlist because TMDB had a bad moment.
 *
 * The watchlist views look each saved title up on TMDB to say where it is
 * streaming, and cache the answer. A lookup that failed with nothing cached hit
 * a bare `continue`, so the film was dropped — from the Streaming Watchlist,
 * and from From Watchlist too, which is meant to mirror the whole list. Three
 * refusals in a row open the circuit breaker, which fails every lookup after
 * it, so one bad moment took out the rest of the list:
 *
 *   watchlist holds 30 · From Watchlist shows 10 · Streaming Watchlist shows 5
 *
 * The lookups also ran one at a time, so a long watchlist's first load could
 * outlast the app's thirty-second timeout.
 */

process.env.JWT_SECRET = 'watchlist-resilience-secret';
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || 'test-key';

const request = require('supertest');
const { createApp } = require('../../app');
const { createTestDb, closeDb } = require('../testHelpers');
const { clearApiCaches, resetTmdbBreaker } = require('../../movieService');

const run = (db, sql, p = []) => new Promise((r, j) => db.run(sql, p, (e) => (e ? j(e) : r())));

describe('the watchlist views when TMDB refuses some lookups', () => {
  let db, app, auth, lookups, inFlight, peakInFlight;
  const FAIL_FROM = 11;

  beforeEach(async () => {
    resetTmdbBreaker(); clearApiCaches();
    lookups = 0; inFlight = 0; peakInFlight = 0;
    global.fetch = jest.fn(async (url) => {
      const m = new URL(url).pathname.match(/^\/3\/movie\/(\d+)$/);
      if (!m) return { ok: true, status: 200, text: async () => '{"results":[]}' };
      lookups += 1; inFlight += 1; peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      if (lookups >= FAIL_FROM) { const e = new Error('TMDB request failed: 429'); e.status = 429; throw e; }
      const on = Number(m[1]) % 2 === 0;
      return { ok: true, status: 200, text: async () => JSON.stringify({
        id: Number(m[1]), title: `Film ${m[1]}`,
        'watch/providers': { results: { US: on ? { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } : {} } },
      }) };
    });
    db = await createTestDb();
    app = createApp(db);
    const { body } = await request(app).post('/register').send({ username: 'saver', password: 'password123' });
    auth = { Authorization: `Bearer ${body.token}` };
    await request(app).put('/platforms').set(auth).send({ platforms: ['netflix'], languages: [] });
    for (let i = 1; i <= 30; i++) {
      await run(db, `INSERT INTO watchlist_items (user_id, item_id, media_type, title, poster_url)
                     SELECT id, ?, 'movie', ?, '/saved.jpg' FROM users WHERE username = 'saver'`,
        [`movie-${i}`, `Film ${i}`]);
    }
  });
  afterEach(async () => { delete global.fetch; resetTmdbBreaker(); clearApiCaches(); await closeDb(db); });

  const view = (q) => request(app).get('/movies').query({ watchlistOnly: 'true', limit: 100, ...q }).set(auth);

  test('From Watchlist shows every saved film, looked up or not', async () => {
    const { body } = await view({});
    expect(body.items).toHaveLength(30);
  });

  test('a film it could not look up keeps the title and poster it was saved with', async () => {
    const { body } = await view({});
    const unchecked = body.items.filter((i) => i.availabilityUnknown);
    expect(unchecked.length).toBeGreaterThan(0);
    expect(unchecked[0].title).toMatch(/^Film \d+$/);
    expect(unchecked[0].posterUrl).toBe('/saved.jpg');
    // Unknown, not "on nothing": the card must not claim it is not streaming.
    expect(unchecked[0].availableOn).toEqual([]);
  });

  test('Streaming Watchlist says how many it could not check, rather than hiding them', async () => {
    const { body } = await view({ streamingOnly: 'true' });
    // Only titles whose availability is known can be claimed as streaming…
    expect(body.items.every((i) => !i.availabilityUnknown)).toBe(true);
    // …and the rest are counted, so the app can say so and offer a retry.
    expect(body.meta.uncheckedCount).toBeGreaterThan(0);
    expect(body.items.length + body.meta.uncheckedCount).toBeLessThanOrEqual(30);
  });

  test('lookups run several at a time, not one by one', async () => {
    resetTmdbBreaker(); clearApiCaches();
    global.fetch.mockClear(); lookups = -1000;   // no refusals this time
    await view({});
    expect(peakInFlight).toBeGreaterThan(1);
  });
});

describe('From Watchlist and the service filter the app always sends', () => {
  let db, app, auth;
  beforeEach(async () => {
    resetTmdbBreaker(); clearApiCaches();
    global.fetch = jest.fn(async (url) => {
      const m = new URL(url).pathname.match(/^\/3\/movie\/(\d+)$/);
      if (!m) return { ok: true, status: 200, text: async () => '{"results":[]}' };
      const id = Number(m[1]);
      const flatrate = id % 3 === 0 ? [{ provider_id: 8, provider_name: 'Netflix' }]
        : id % 3 === 1 ? [{ provider_id: 15, provider_name: 'Hulu' }] : [];
      return { ok: true, status: 200, text: async () => JSON.stringify({
        id, title: `Film ${id}`, 'watch/providers': { results: { US: { flatrate } } } }) };
    });
    db = await createTestDb();
    app = createApp(db);
    const { body } = await request(app).post('/register').send({ username: 'mirror', password: 'password123' });
    auth = { Authorization: `Bearer ${body.token}` };
    await request(app).put('/platforms').set(auth).send({ platforms: ['netflix', 'hulu'], languages: [] });
    for (let i = 1; i <= 9; i++) {
      await run(db, `INSERT INTO watchlist_items (user_id, item_id, media_type, title)
                     SELECT id, ?, 'movie', ? FROM users WHERE username = 'mirror'`, [`movie-${i}`, `Film ${i}`]);
    }
  });
  afterEach(async () => { delete global.fetch; clearApiCaches(); await closeDb(db); });

  const count = async (q) => (await request(app).get('/movies')
    .query({ watchlistOnly: 'true', limit: 100, ...q }).set(auth)).body.items.length;

  test('mirrors the whole list when the filter names every service', async () => {
    // Exactly the request the app makes. Three of these nine are on neither
    // service, and the mirror must still show them.
    expect(await count({ serviceFilters: 'netflix,hulu' })).toBe(9);
  });

  test('still narrows when the reader picked fewer services', async () => {
    expect(await count({ serviceFilters: 'netflix' })).toBe(3);
  });

  test('Streaming Watchlist still shows only what streams', async () => {
    expect(await count({ serviceFilters: 'netflix,hulu', streamingOnly: 'true' })).toBe(6);
  });
});
