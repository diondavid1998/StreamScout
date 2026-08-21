'use strict';

/**
 * Regression tests for the backend hardening pass.
 *
 * Each block pins behaviour that was previously wrong: deleted accounts being
 * silently recreated, shared email addresses making password reset ambiguous,
 * unvalidated ids reaching the outbound TMDB URL, CORS rejections answering
 * with an HTML 500, and "hide watched" binding one SQL variable per title.
 */

jest.mock('../../movieService', () => {
  const actual = jest.requireActual('../../movieService');
  return {
    ...actual,
    fetchTitleDetails: jest.fn(),
    fetchTitleWithCredits: jest.fn(),
    fetchOmdbRatings: jest.fn().mockResolvedValue(null),
    isOmdbRateLimited: jest.fn().mockReturnValue(true),
  };
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createTestDb, closeDb } = require('../testHelpers');
const { createApp } = require('../../app');
const { readCachedCatalog } = require('../../catalogCache');
const { fetchTitleWithCredits } = require('../../movieService');

const SCOPE = 'region:US|platforms:netflix|languages:';

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  );
}

describe('deleted accounts are not silently recreated', () => {
  let db, app;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
  });

  afterEach(() => closeDb(db));

  it('answers 401 on /platforms for a token whose user row is gone', async () => {
    const token = jwt.sign({ id: 4242, username: 'ghost', tokenVersion: 0 }, process.env.JWT_SECRET);

    const res = await request(app).get('/platforms').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    const row = await get(db, 'SELECT id FROM users WHERE id = 4242');
    expect(row).toBeUndefined();
  });

  it('answers 401 on /movies for a token whose user row is gone', async () => {
    const token = jwt.sign({ id: 4243, username: 'ghost', tokenVersion: 0 }, process.env.JWT_SECRET);

    const res = await request(app).get('/movies').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    const row = await get(db, 'SELECT id FROM users WHERE id = 4243');
    expect(row).toBeUndefined();
  });
});

describe('email addresses are unique across accounts', () => {
  let db, app;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
  });

  afterEach(() => closeDb(db));

  it('rejects a second registration using the same email', async () => {
    const first = await request(app)
      .post('/register')
      .send({ username: 'victim', password: 'secret1', email: 'Shared@Example.com' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/register')
      .send({ username: 'attacker', password: 'secret2', email: 'shared@example.com' });

    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/email/i);
  });

  it('still allows accounts without an email address', async () => {
    const first = await request(app).post('/register').send({ username: 'nomail1', password: 'secret1' });
    const second = await request(app).post('/register').send({ username: 'nomail2', password: 'secret2' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('rejects a malformed email at registration', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'baddress', password: 'secret1', email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid email/i);
  });
});

describe('title details validates the TMDB id', () => {
  let db, app, token;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
    const reg = await request(app).post('/register').send({ username: 'detailer', password: 'secret1' });
    token = reg.body.token;
    jest.clearAllMocks();
  });

  afterEach(() => closeDb(db));

  it('rejects a path-traversal id without calling TMDB', async () => {
    const res = await request(app)
      .get(`/titles/movie/${encodeURIComponent('../../authentication')}/details`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(fetchTitleWithCredits).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric id', async () => {
    const res = await request(app)
      .get('/titles/movie/not-a-number/details')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(fetchTitleWithCredits).not.toHaveBeenCalled();
  });

  it('accepts a plain numeric id', async () => {
    fetchTitleWithCredits.mockResolvedValue({ id: 550, title: 'Fight Club', genres: [], credits: {} });

    const res = await request(app)
      .get('/titles/movie/550/details')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(fetchTitleWithCredits).toHaveBeenCalledWith('movie', 550);
  });
});

describe('errors are returned as JSON', () => {
  let db, app;

  beforeEach(async () => {
    db = await createTestDb();
    app = createApp(db, { disableRateLimit: true });
  });

  afterEach(() => closeDb(db));

  it('answers a disallowed CORS origin with a JSON 403, not an HTML 500', async () => {
    const res = await request(app).get('/').set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CORS/i);
    expect(res.text).not.toMatch(/<!DOCTYPE html>/i);
  });

  it('still serves an allowed origin', async () => {
    const res = await request(app).get('/').set('Origin', 'http://localhost:3000');
    expect(res.status).toBe(200);
  });
});

describe('hide watched scales past the SQL variable limit', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
    await run(
      db,
      `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, updated_at)
       VALUES (?, 'movie', 1, 'Kept', ?)`,
      [SCOPE, new Date().toISOString()]
    );
    await run(
      db,
      `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, updated_at)
       VALUES (?, 'movie', 2, 'Watched', ?)`,
      [SCOPE, new Date().toISOString()]
    );
  });

  afterEach(() => closeDb(db));

  it('excludes watched titles for the given user', async () => {
    await run(
      db,
      `INSERT INTO watched_items (user_id, item_id) VALUES (1, 'movie-2')`
    );

    const result = await readCachedCatalog(db, { scopeKey: SCOPE, excludeWatchedForUserId: 1 });

    expect(result.items.map((i) => i.title)).toEqual(['Kept']);
  });

  it('does not exclude another user\'s watched titles', async () => {
    await run(db, `INSERT INTO watched_items (user_id, item_id) VALUES (2, 'movie-2')`);

    const result = await readCachedCatalog(db, { scopeKey: SCOPE, excludeWatchedForUserId: 1 });

    expect(result.items.map((i) => i.title).sort()).toEqual(['Kept', 'Watched']);
  });

  it('handles a 40,000-title watched list', async () => {
    // The old NOT IN list bound one variable per watched item and blew SQLite's
    // 32,766-variable ceiling. The correlated subquery binds exactly one.
    await run(db, 'BEGIN TRANSACTION');
    for (let i = 0; i < 40000; i += 1) {
      await run(db, 'INSERT INTO watched_items (user_id, item_id) VALUES (1, ?)', [`movie-${i + 100}`]);
    }
    await run(db, 'COMMIT');

    const result = await readCachedCatalog(db, { scopeKey: SCOPE, excludeWatchedForUserId: 1 });

    expect(result.items).toHaveLength(2);
  }, 60000);
});
