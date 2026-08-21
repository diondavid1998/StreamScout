'use strict';

/**
 * Tests for the cost of a Letterboxd import.
 *
 * The import used to resolve titles strictly one at a time with a fixed 125ms
 * sleep between them, and re-paid the full TMDB search cost on every upload of
 * the same list. These cover the three things that changed: results are cached
 * across uploads, duplicates inside a batch are searched once, and a batch is
 * no longer capped at 50 titles.
 */

jest.mock('../../movieService', () => {
  const actual = jest.requireActual('../../movieService');
  return {
    ...actual,
    fetchTitleDetails: jest.fn(),
    fetchOmdbRatings: jest.fn(),
    searchTitleOnTmdb: jest.fn(),
    isOmdbRateLimited: jest.fn().mockReturnValue(true),
  };
});

const request = require('supertest');
const { createTestDb, closeDb } = require('../testHelpers');
const { createApp } = require('../../app');
const { searchTitleOnTmdb, isOmdbRateLimited } = require('../../movieService');

function all(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  );
}

describe('Letterboxd import cost', () => {
  let db, app, token;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
    const reg = await request(app).post('/register').send({ username: 'importer', password: 'secret1' });
    token = reg.body.token;
    jest.clearAllMocks();
    isOmdbRateLimited.mockReturnValue(true); // keep rating hydration out of the counts
    searchTitleOnTmdb.mockImplementation(async (name, year) => ({
      itemId: `movie-${name.length}${year}`,
      mediaType: 'movie',
      title: name,
      posterUrl: null,
    }));
  });

  afterEach(() => closeDb(db));

  const post = (body) =>
    request(app).post('/import/letterboxd').set('Authorization', `Bearer ${token}`).send(body);

  it('searches TMDB once per title and never again for the same title', async () => {
    const items = [
      { name: 'Heat', year: 1995 },
      { name: 'Sicario', year: 2015 },
    ];

    const first = await post({ importType: 'watchlist', replaceExisting: true, items });
    expect(first.status).toBe(200);
    expect(first.body.matched).toBe(2);
    expect(searchTitleOnTmdb).toHaveBeenCalledTimes(2);

    // Re-uploading the same list is the common case, because a watchlist upload
    // replaces the saved list rather than adding to it.
    searchTitleOnTmdb.mockClear();
    const second = await post({ importType: 'watchlist', replaceExisting: true, items });
    expect(second.status).toBe(200);
    expect(second.body.matched).toBe(2);
    expect(searchTitleOnTmdb).not.toHaveBeenCalled();
  });

  it('caches a title it could not resolve, so the misses stay cheap too', async () => {
    searchTitleOnTmdb.mockResolvedValue(null);

    const first = await post({ importType: 'watchlist', items: [{ name: 'Nonexistent Film', year: 1922 }] });
    expect(first.body).toMatchObject({ matched: 0, notFound: 1 });
    expect(searchTitleOnTmdb).toHaveBeenCalledTimes(1);

    searchTitleOnTmdb.mockClear();
    const second = await post({ importType: 'watchlist', items: [{ name: 'Nonexistent Film', year: 1922 }] });
    expect(second.body).toMatchObject({ matched: 0, notFound: 1 });
    expect(searchTitleOnTmdb).not.toHaveBeenCalled();
  });

  it('searches once for a title that appears twice in the same batch', async () => {
    await post({
      importType: 'watched',
      items: [
        { name: 'Heat', year: 1995 },
        { name: 'heat', year: 1995 },
        { name: 'Heat ', year: 1995 },
      ],
    });

    expect(searchTitleOnTmdb).toHaveBeenCalledTimes(1);
  });

  it('accepts a batch of 100 titles in one call', async () => {
    const items = Array.from({ length: 120 }, (_, i) => ({ name: `Film ${i}`, year: 2000 + (i % 20) }));

    const res = await post({ importType: 'watched', items });

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(100);
    const rows = await all(db, 'SELECT item_id FROM watched_items WHERE user_id = 1');
    expect(rows.length).toBe(res.body.matched);
  });

  it('resolves a batch without serialising the lookups', async () => {
    let inFlight = 0;
    let peak = 0;
    searchTitleOnTmdb.mockImplementation(async (name) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { itemId: `movie-${name}`, mediaType: 'movie', title: name, posterUrl: null };
    });

    await post({
      importType: 'watched',
      items: Array.from({ length: 24 }, (_, i) => ({ name: `Title ${i}`, year: 2020 })),
    });

    expect(peak).toBeGreaterThan(1);
  });
});
