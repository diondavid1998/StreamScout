'use strict';

/**
 * Tests for managing the saved lists:
 *   - clearing each list wholesale
 *   - import semantics: a watchlist upload replaces, a watched upload merges
 *   - rating hydration for saved titles, including ones the catalog snapshot
 *     never contained
 */

jest.mock('../../movieService', () => {
  const actual = jest.requireActual('../../movieService');
  return {
    ...actual,
    fetchTitleDetails: jest.fn(),
    fetchOmdbRatings: jest.fn(),
    searchTitleOnTmdb: jest.fn(),
    isOmdbRateLimited: jest.fn().mockReturnValue(false),
  };
});

const request = require('supertest');
const { createTestDb, closeDb } = require('../testHelpers');
const { createApp } = require('../../app');
const { hydrateSavedTitleRatings } = require('../../catalogCache');
const {
  fetchTitleDetails,
  fetchOmdbRatings,
  searchTitleOnTmdb,
  isOmdbRateLimited,
} = require('../../movieService');

const NETFLIX = 8;

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); });
  });
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );
}

const OMDB = {
  imdb: '8.3/10',
  rottenTomatoes: '94%',
  metacritic: '88/100',
  omdbVotes: '900',
  imdbId: null,
};

describe('clearing the saved lists', () => {
  let db, app, token;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
    const reg = await request(app).post('/register').send({ username: 'clearer', password: 'secret1' });
    token = reg.body.token;
    await run(db, `INSERT INTO watched_items (user_id,item_id,title) VALUES (1,'movie-1','A'),(1,'movie-2','B')`);
    await run(db, `INSERT INTO watchlist_items (user_id,item_id,title) VALUES (1,'movie-3','C'),(1,'movie-4','D')`);
    await run(
      db,
      `INSERT INTO watchlist_streaming_cache (user_id,item_id,checked_at) VALUES ('1','movie-3',?)`,
      [new Date().toISOString()]
    );
  });

  afterEach(() => closeDb(db));

  it('clears every watched entry and reports how many went', async () => {
    const res = await request(app).delete('/watched').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(2);
    expect(await all(db, 'SELECT * FROM watched_items')).toHaveLength(0);
    // The other list is untouched.
    expect(await all(db, 'SELECT * FROM watchlist_items')).toHaveLength(2);
  });

  it('clears every watchlist entry and its availability cache', async () => {
    const res = await request(app).delete('/watchlist').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(2);
    expect(await all(db, 'SELECT * FROM watchlist_items')).toHaveLength(0);
    // Otherwise cleared titles resurface until the 24-hour TTL expires.
    expect(await all(db, 'SELECT * FROM watchlist_streaming_cache')).toHaveLength(0);
    expect(await all(db, 'SELECT * FROM watched_items')).toHaveLength(2);
  });

  it('does not touch another user\'s lists', async () => {
    await run(db, `INSERT INTO users (id,username,password) VALUES (2,'other','x')`);
    await run(db, `INSERT INTO watchlist_items (user_id,item_id,title) VALUES (2,'movie-9','Theirs')`);

    await request(app).delete('/watchlist').set('Authorization', `Bearer ${token}`);

    const theirs = await all(db, 'SELECT * FROM watchlist_items WHERE user_id = 2');
    expect(theirs).toHaveLength(1);
  });

  it('still clears when the list is already empty', async () => {
    await request(app).delete('/watched').set('Authorization', `Bearer ${token}`);
    const res = await request(app).delete('/watched').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(0);
  });
});

describe('Letterboxd import semantics', () => {
  let db, app, token;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
    const reg = await request(app).post('/register').send({ username: 'importer', password: 'secret1' });
    token = reg.body.token;
    jest.clearAllMocks();
    isOmdbRateLimited.mockReturnValue(true); // keep hydration out of these assertions
    searchTitleOnTmdb.mockImplementation(async (name) => ({
      itemId: `movie-${name.length}00`,
      mediaType: 'movie',
      title: name,
      posterUrl: null,
    }));
  });

  afterEach(() => closeDb(db));

  it('replaces the watchlist when the upload says so', async () => {
    await run(db, `INSERT INTO watchlist_items (user_id,item_id,title) VALUES (1,'movie-old','Stale Pick')`);

    const res = await request(app)
      .post('/import/letterboxd')
      .set('Authorization', `Bearer ${token}`)
      .send({ importType: 'watchlist', replaceExisting: true, items: [{ name: 'Fresh', year: 2024 }] });

    expect(res.status).toBe(200);
    expect(res.body.replaced).toBe(1);
    const rows = await all(db, 'SELECT item_id FROM watchlist_items WHERE user_id = 1');
    expect(rows.map((r) => r.item_id)).toEqual(['movie-500']);
  });

  it('appends on later batches of the same watchlist upload', async () => {
    await request(app).post('/import/letterboxd').set('Authorization', `Bearer ${token}`)
      .send({ importType: 'watchlist', replaceExisting: true, items: [{ name: 'First', year: 2024 }] });
    // The client sets replaceExisting on batch 0 only.
    await request(app).post('/import/letterboxd').set('Authorization', `Bearer ${token}`)
      .send({ importType: 'watchlist', items: [{ name: 'Second!', year: 2024 }] });

    const rows = await all(db, 'SELECT item_id FROM watchlist_items WHERE user_id = 1');
    expect(rows).toHaveLength(2);
  });

  it('merges a watched upload into the existing history', async () => {
    await run(db, `INSERT INTO watched_items (user_id,item_id,title) VALUES (1,'movie-old','Seen Long Ago')`);

    const res = await request(app)
      .post('/import/letterboxd')
      .set('Authorization', `Bearer ${token}`)
      .send({ importType: 'watched', items: [{ name: 'Fresh', year: 2024 }] });

    expect(res.status).toBe(200);
    expect(res.body.replaced).toBe(0);
    const rows = await all(db, 'SELECT item_id FROM watched_items WHERE user_id = 1 ORDER BY item_id');
    expect(rows.map((r) => r.item_id)).toEqual(['movie-500', 'movie-old']);
  });

  it('refuses replaceExisting on a watched upload', async () => {
    const res = await request(app)
      .post('/import/letterboxd')
      .set('Authorization', `Bearer ${token}`)
      .send({ importType: 'watched', replaceExisting: true, items: [{ name: 'Fresh', year: 2024 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/watchlist/i);
  });
});

describe('rating hydration for saved titles', () => {
  let db, app, token;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
    const reg = await request(app).post('/register').send({ username: 'saver', password: 'secret1' });
    token = reg.body.token;
    await run(db, `UPDATE users SET platforms='["netflix"]' WHERE id=1`);
    jest.clearAllMocks();
    isOmdbRateLimited.mockReturnValue(false);
    fetchOmdbRatings.mockResolvedValue(OMDB);
  });

  afterEach(() => closeDb(db));

  it('rates a watchlist title the catalog snapshot never contained', async () => {
    // This is the case that previously produced zero OMDB calls, forever: an
    // obscure title on the watchlist but absent from the popular snapshot.
    await run(db, `INSERT INTO watchlist_items (user_id,item_id,media_type,title) VALUES (1,'movie-777','movie','Obscure')`);
    await run(
      db,
      `INSERT INTO watchlist_streaming_cache (user_id,item_id,imdb_id,checked_at) VALUES ('1','movie-777','tt0000777',?)`,
      [new Date().toISOString()]
    );

    const result = await hydrateSavedTitleRatings(db, 1);

    expect(result.fetched).toBe(1);
    expect(fetchOmdbRatings).toHaveBeenCalledWith('tt0000777');
    const cached = await all(db, `SELECT * FROM title_ratings WHERE imdb_id = 'tt0000777'`);
    expect(cached).toHaveLength(1);
    expect(cached[0].rating_rt).toBe('94%');
    expect(cached[0].rating_rt_num).toBe(94);
  });

  it('serves those ratings back on the watchlist view', async () => {
    await run(db, `INSERT INTO watchlist_items (user_id,item_id,media_type,title) VALUES (1,'movie-777','movie','Obscure')`);
    fetchTitleDetails.mockResolvedValue({
      id: 777, title: 'Obscure', genres: [], external_ids: { imdb_id: 'tt0000777' },
      'watch/providers': { results: { US: { flatrate: [{ provider_id: NETFLIX }] } } },
    });

    // First visit resolves the imdb_id and kicks hydration in the background.
    await request(app).get('/movies?watchlistOnly=true').set('Authorization', `Bearer ${token}`);
    await new Promise((r) => setTimeout(r, 250));

    const second = await request(app).get('/movies?watchlistOnly=true').set('Authorization', `Bearer ${token}`);
    const item = second.body.items[0];
    expect(item.ratings.imdb).toBe('8.3/10');
    expect(item.ratings.rottenTomatoes).toBe('94%');
    expect(item.ratings.metacritic).toBe('88/100');
  });

  it('rates watchlist entries before watched ones', async () => {
    await run(db, `INSERT INTO watched_items (user_id,item_id) VALUES (1,'movie-100')`);
    await run(db, `INSERT INTO watchlist_items (user_id,item_id) VALUES (1,'movie-200')`);
    const now = new Date().toISOString();
    await run(db, `INSERT INTO catalog_cache_entries (scope_key,media_type,tmdb_id,title,imdb_id,updated_at)
                   VALUES ('s','movie',100,'Watched','tt0000100',?)`, [now]);
    await run(db, `INSERT INTO catalog_cache_entries (scope_key,media_type,tmdb_id,title,imdb_id,updated_at)
                   VALUES ('s','movie',200,'Watchlist','tt0000200',?)`, [now]);

    const order = [];
    fetchOmdbRatings.mockImplementation(async (id) => { order.push(id); return OMDB; });

    await hydrateSavedTitleRatings(db, 1);

    expect(order[0]).toBe('tt0000200');
    expect(order).toContain('tt0000100');
  });

  it('skips titles already in the shared cache', async () => {
    await run(db, `INSERT INTO watchlist_items (user_id,item_id) VALUES (1,'movie-777')`);
    await run(
      db,
      `INSERT INTO watchlist_streaming_cache (user_id,item_id,imdb_id,checked_at) VALUES ('1','movie-777','tt0000777',?)`,
      [new Date().toISOString()]
    );
    await run(
      db,
      `INSERT INTO title_ratings (imdb_id,rating_imdb,fetched_at) VALUES ('tt0000777','9.9/10',?)`,
      [new Date().toISOString()]
    );

    const result = await hydrateSavedTitleRatings(db, 1);

    expect(result.fetched).toBe(0);
    expect(fetchOmdbRatings).not.toHaveBeenCalled();
  });

  it('mirrors a fetched rating into any scope already holding that title', async () => {
    await run(db, `INSERT INTO watchlist_items (user_id,item_id) VALUES (1,'movie-300')`);
    await run(db, `INSERT INTO catalog_cache_entries (scope_key,media_type,tmdb_id,title,imdb_id,updated_at)
                   VALUES ('scope-a','movie',300,'Shared','tt0000300',?)`, [new Date().toISOString()]);
    await run(db, `INSERT INTO catalog_cache_entries (scope_key,media_type,tmdb_id,title,imdb_id,updated_at)
                   VALUES ('scope-b','movie',300,'Shared','tt0000300',?)`, [new Date().toISOString()]);

    await hydrateSavedTitleRatings(db, 1);

    const rows = await all(db, `SELECT scope_key, rating_rt FROM catalog_cache_entries WHERE imdb_id='tt0000300'`);
    expect(rows.map((r) => r.rating_rt)).toEqual(['94%', '94%']);
  });

  it('stays quiet when OMDB is rate limited', async () => {
    isOmdbRateLimited.mockReturnValue(true);
    await run(db, `INSERT INTO watchlist_items (user_id,item_id) VALUES (1,'movie-777')`);
    await run(
      db,
      `INSERT INTO watchlist_streaming_cache (user_id,item_id,imdb_id,checked_at) VALUES ('1','movie-777','tt0000777',?)`,
      [new Date().toISOString()]
    );

    const result = await hydrateSavedTitleRatings(db, 1);

    expect(result.skipped).toBe('omdb_rate_limited');
    expect(fetchOmdbRatings).not.toHaveBeenCalled();
  });

  it('leaves a failed fetch uncached so the next run retries it', async () => {
    await run(db, `INSERT INTO watchlist_items (user_id,item_id) VALUES (1,'movie-777')`);
    await run(
      db,
      `INSERT INTO watchlist_streaming_cache (user_id,item_id,imdb_id,checked_at) VALUES ('1','movie-777','tt0000777',?)`,
      [new Date().toISOString()]
    );
    fetchOmdbRatings.mockResolvedValue(null);

    const result = await hydrateSavedTitleRatings(db, 1);

    expect(result.fetched).toBe(0);
    expect(await all(db, 'SELECT * FROM title_ratings')).toHaveLength(0);
  });

  it('only considers the calling user\'s saved titles', async () => {
    await run(db, `INSERT INTO users (id,username,password) VALUES (2,'other','x')`);
    await run(db, `INSERT INTO watchlist_items (user_id,item_id) VALUES (2,'movie-888')`);
    await run(
      db,
      `INSERT INTO watchlist_streaming_cache (user_id,item_id,imdb_id,checked_at) VALUES ('2','movie-888','tt0000888',?)`,
      [new Date().toISOString()]
    );

    const result = await hydrateSavedTitleRatings(db, 1);

    expect(result.fetched).toBe(0);
    expect(fetchOmdbRatings).not.toHaveBeenCalled();
  });
});
