'use strict';

/**
 * The catalog offers two watchlist views, and they must differ:
 *
 *   watchlistOnly                  → every watchlist item ("From watchlist")
 *   watchlistOnly + streamingOnly  → only those streaming on the user's
 *                                    platforms ("Streaming watchlist")
 *
 * Previously both sent the same request and both silently dropped titles that
 * weren't streaming anywhere, so "From watchlist" never showed the watchlist.
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

const request = require('supertest');
const { createTestDb, closeDb } = require('../testHelpers');
const { createApp } = require('../../app');
const { fetchTitleDetails } = require('../../movieService');

const NETFLIX_PROVIDER_ID = 8;

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

describe('watchlist views', () => {
  let db, app, token;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });

    const reg = await request(app).post('/register').send({ username: 'wluser', password: 'secret1' });
    token = reg.body.token;
    await run(db, `UPDATE users SET platforms = '["netflix"]' WHERE username = 'wluser'`);

    await run(
      db,
      `INSERT INTO watchlist_items (user_id, item_id, media_type, title) VALUES (1, 'movie-10', 'movie', 'On Netflix')`
    );
    await run(
      db,
      `INSERT INTO watchlist_items (user_id, item_id, media_type, title) VALUES (1, 'movie-20', 'movie', 'Not Streaming')`
    );

    fetchTitleDetails.mockImplementation(async (_mediaType, id) => ({
      id,
      title: id === 10 ? 'On Netflix' : 'Not Streaming',
      genres: [],
      popularity: id === 10 ? 50 : 90,
      vote_average: id === 10 ? 8 : 6,
      'watch/providers':
        id === 10
          ? { results: { US: { flatrate: [{ provider_id: NETFLIX_PROVIDER_ID }] } } }
          : { results: {} },
    }));
  });

  afterEach(() => closeDb(db));

  it('returns the whole watchlist for "From watchlist"', async () => {
    const res = await request(app)
      .get('/movies?watchlistOnly=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.title).sort()).toEqual(['Not Streaming', 'On Netflix']);
    expect(res.body.meta.streamingOnly).toBe(false);
  });

  it('returns only streamable titles for "Streaming watchlist"', async () => {
    const res = await request(app)
      .get('/movies?watchlistOnly=true&streamingOnly=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.title)).toEqual(['On Netflix']);
    expect(res.body.meta.streamingOnly).toBe(true);
  });

  it('still lists the watchlist when the user has no platforms selected', async () => {
    await run(db, `UPDATE users SET platforms = '[]' WHERE username = 'wluser'`);

    const res = await request(app)
      .get('/movies?watchlistOnly=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  it('returns nothing for the streaming view when no platforms are selected', async () => {
    await run(db, `UPDATE users SET platforms = '[]' WHERE username = 'wluser'`);

    const res = await request(app)
      .get('/movies?watchlistOnly=true&streamingOnly=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('honours every sort option, not just four', async () => {
    // 'Not Streaming' is the more popular of the two, so a sort that silently
    // fell back to popularity would put it first. Title A–Z must not.
    const byTitle = await request(app)
      .get('/movies?watchlistOnly=true&sortBy=title')
      .set('Authorization', `Bearer ${token}`);
    expect(byTitle.body.items.map((i) => i.title)).toEqual(['Not Streaming', 'On Netflix']);

    const byPopularity = await request(app)
      .get('/movies?watchlistOnly=true&sortBy=popularity')
      .set('Authorization', `Bearer ${token}`);
    expect(byPopularity.body.items.map((i) => i.title)).toEqual(['Not Streaming', 'On Netflix']);

    // TMDb rating inverts the popularity order — proving the option is applied.
    const byTmdb = await request(app)
      .get('/movies?watchlistOnly=true&sortBy=tmdb')
      .set('Authorization', `Bearer ${token}`);
    expect(byTmdb.body.items.map((i) => i.title)).toEqual(['On Netflix', 'Not Streaming']);
  });

  it('sorts by recently added', async () => {
    await run(db, `UPDATE watchlist_items SET added_at = '2020-01-01 00:00:00' WHERE item_id = 'movie-10'`);
    await run(db, `UPDATE watchlist_items SET added_at = '2024-01-01 00:00:00' WHERE item_id = 'movie-20'`);

    const res = await request(app)
      .get('/movies?watchlistOnly=true&sortBy=recently_added')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.items.map((i) => i.title)).toEqual(['Not Streaming', 'On Netflix']);
  });
});
