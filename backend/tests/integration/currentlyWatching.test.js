'use strict';

/**
 * Currently Watching, and the caching rule it depends on: TMDB is called when
 * a title has never been fetched, or when the refresh button asks. Never on a
 * timer, and never twice for the same thing.
 */

jest.mock('../../movieService', () => {
  const actual = jest.requireActual('../../movieService');
  return {
    ...actual,
    fetchTitleWithCredits: jest.fn(),
    fetchTitleDetails: jest.fn(),
    fetchOmdbRatings: jest.fn(),
    searchTitleOnTmdb: jest.fn(),
    isOmdbRateLimited: jest.fn().mockReturnValue(false),
  };
});

const request = require('supertest');
const { createTestDb, closeDb } = require('../testHelpers');
const { createApp } = require('../../app');
const { fetchTitleWithCredits } = require('../../movieService');
const { todayInAppZone } = require('../../seriesSchedule');

function all(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  );
}
function run(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); })
  );
}

/**
 * The add endpoint kicks off the first fetch without awaiting it, so the row is
 * in the list before TMDB answers. Polling the mock is deterministic where a
 * fixed number of ticks is not: the fetch is behind a database read, so how
 * many turns of the loop it takes is an implementation detail.
 */
async function flushBackgroundFetch(expected = 1) {
  for (let i = 0; i < 100 && fetchTitleWithCredits.mock.calls.length < expected; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** A date `days` from today, in the same bare form TMDB uses. */
function offsetDate(days) {
  const base = new Date(`${todayInAppZone()}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function tvPayload({ id = 1399, name = 'Test Show', status = 'Returning Series', next = null, last = null } = {}) {
  return {
    id,
    name,
    status,
    overview: 'An overview',
    first_air_date: '2020-01-01',
    genres: [{ name: 'Drama' }],
    number_of_seasons: 3,
    number_of_episodes: 24,
    created_by: [{ name: 'A Creator' }],
    credits: { cast: [{ id: 5, name: 'An Actor', character: 'Someone' }] },
    next_episode_to_air: next ? { air_date: next, season_number: 3, episode_number: 1 } : null,
    last_episode_to_air: last ? { air_date: last, season_number: 2, episode_number: 10 } : null,
  };
}

let db, app, token;

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createTestDb();
  app = createApp(db, { disableRateLimit: true });
  const registered = await request(app)
    .post('/register')
    .send({ username: 'watcher', password: 'secret1' });
  token = registered.body.token;
});

afterEach(async () => { await closeDb(db); });

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

describe('adding to the list', () => {
  test('films are rejected — the list is series only', async () => {
    const res = await auth(request(app).post('/currently-watching')).send({
      itemId: 'movie-550',
      title: 'Fight Club',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/series only/i);
  });

  test('adding a show removes it from the watchlist', async () => {
    fetchTitleWithCredits.mockResolvedValue(tvPayload());
    await auth(request(app).post('/watchlist')).send({ itemId: 'tv-1399', mediaType: 'tv', title: 'Test Show' });

    await auth(request(app).post('/currently-watching')).send({ itemId: 'tv-1399', title: 'Test Show' });

    const watchlist = await auth(request(app).get('/watchlist'));
    expect(watchlist.body.items).toHaveLength(0);
    const current = await auth(request(app).get('/currently-watching'));
    expect(current.body.items.map((i) => i.itemId)).toEqual(['tv-1399']);
  });

  test('marking a show watched ends the run', async () => {
    fetchTitleWithCredits.mockResolvedValue(tvPayload());
    await auth(request(app).post('/currently-watching')).send({ itemId: 'tv-1399', title: 'Test Show' });

    await auth(request(app).post('/watched')).send({ itemId: 'tv-1399', mediaType: 'tv', title: 'Test Show' });

    const current = await auth(request(app).get('/currently-watching'));
    expect(current.body.items).toHaveLength(0);
  });

  test('adding fetches the show once, and only because it was never fetched', async () => {
    fetchTitleWithCredits.mockResolvedValue(tvPayload());
    await auth(request(app).post('/currently-watching')).send({ itemId: 'tv-1399', title: 'Test Show' });
    await flushBackgroundFetch();

    expect(fetchTitleWithCredits).toHaveBeenCalledTimes(1);

    // Reading the list again touches nothing external.
    await auth(request(app).get('/currently-watching'));
    await auth(request(app).get('/currently-watching'));
    expect(fetchTitleWithCredits).toHaveBeenCalledTimes(1);
  });
});

describe('the three messages', () => {
  async function addWithSchedule(payload) {
    fetchTitleWithCredits.mockResolvedValue(payload);
    await auth(request(app).post('/currently-watching')).send({ itemId: `tv-${payload.id}`, title: payload.name });
    await flushBackgroundFetch(1);
    const res = await auth(request(app).get('/currently-watching'));
    return res.body.items.find((item) => item.tmdbId === payload.id);
  }

  test('a scheduled episode reads as a day of the week', async () => {
    const next = offsetDate(3);
    const item = await addWithSchedule(tvPayload({ id: 1, next }));
    expect(item.state).toBe('airing');
    expect(item.scheduleMessage).toMatch(/^New episodes \w+days?s?$/);
    expect(item.scheduleMessage).toContain('New episodes');
  });

  test('returning with nothing scheduled reads as all episodes out', async () => {
    const item = await addWithSchedule(tvPayload({ id: 2, status: 'Returning Series', next: null }));
    expect(item.state).toBe('all_out');
    expect(item.scheduleMessage).toBe('All episodes out');
  });

  test('an ended show reads as all episodes and seasons out', async () => {
    const item = await addWithSchedule(tvPayload({ id: 3, status: 'Ended', last: '2024-05-19' }));
    expect(item.state).toBe('ended');
    expect(item.scheduleMessage).toBe('All episodes and seasons out');
  });

  test('a show with no cached details says so instead of guessing', async () => {
    fetchTitleWithCredits.mockRejectedValue(new Error('TMDB down'));
    await auth(request(app).post('/currently-watching')).send({ itemId: 'tv-99', title: 'Unknown Show' });
    await flushBackgroundFetch(1);
    const res = await auth(request(app).get('/currently-watching'));
    expect(res.body.items[0].state).toBe('unknown');
  });
});

describe('the new-episode badge', () => {
  test('flags an episode that aired after the user was last caught up', async () => {
    fetchTitleWithCredits.mockResolvedValue(tvPayload({ last: offsetDate(-2) }));
    await auth(request(app).post('/currently-watching')).send({ itemId: 'tv-1399', title: 'Test Show' });
    await flushBackgroundFetch(1);

    // Added today, so an episode from two days ago is not new *to this user*.
    let res = await auth(request(app).get('/currently-watching'));
    expect(res.body.items[0].hasNewEpisode).toBe(false);

    // Backdate the catch-up point: now the same episode is new.
    await run(db, "UPDATE currently_watching SET caught_up_on = ?", [offsetDate(-10)]);
    res = await auth(request(app).get('/currently-watching'));
    expect(res.body.items[0].hasNewEpisode).toBe(true);

    // And the filter finds it.
    res = await auth(request(app).get('/currently-watching?new=1'));
    expect(res.body.items).toHaveLength(1);

    // Marking caught up clears it.
    await auth(request(app).post('/currently-watching/tv-1399/caught-up'));
    res = await auth(request(app).get('/currently-watching?new=1'));
    expect(res.body.items).toHaveLength(0);
  });

  test('caught-up on a show not in the list is a 404', async () => {
    const res = await auth(request(app).post('/currently-watching/tv-1/caught-up'));
    expect(res.status).toBe(404);
  });
});

describe('removing', () => {
  test('one show, then the whole list', async () => {
    fetchTitleWithCredits.mockResolvedValue(tvPayload());
    await auth(request(app).post('/currently-watching')).send({ itemId: 'tv-1', title: 'One' });
    await auth(request(app).post('/currently-watching')).send({ itemId: 'tv-2', title: 'Two' });

    await auth(request(app).delete('/currently-watching/tv-1'));
    let res = await auth(request(app).get('/currently-watching'));
    expect(res.body.items.map((i) => i.itemId)).toEqual(['tv-2']);

    res = await auth(request(app).delete('/currently-watching'));
    expect(res.body.removed).toBe(1);
    res = await auth(request(app).get('/currently-watching'));
    expect(res.body.items).toHaveLength(0);
  });
});

describe('the durable title cache', () => {
  test('details are fetched once and served from SQLite thereafter', async () => {
    fetchTitleWithCredits.mockResolvedValue(tvPayload());

    const first = await auth(request(app).get('/titles/tv/1399/details'));
    expect(first.status).toBe(200);
    expect(first.body.title).toBe('Test Show');
    expect(first.body.cached).toBe(false);

    for (let i = 0; i < 5; i++) {
      const again = await auth(request(app).get('/titles/tv/1399/details'));
      expect(again.body.cached).toBe(true);
      expect(again.body.title).toBe('Test Show');
      expect(again.body.cast[0].name).toBe('An Actor');
    }
    expect(fetchTitleWithCredits).toHaveBeenCalledTimes(1);

    const rows = await all(db, 'SELECT * FROM title_details_cache');
    expect(rows).toHaveLength(1);
    expect(rows[0].series_status).toBe('Returning Series');
  });
});

describe('refreshing', () => {
  test('the refresh button, and nothing else, re-reads a show', async () => {
    fetchTitleWithCredits.mockResolvedValue(tvPayload({ status: 'Returning Series', next: offsetDate(4) }));
    await auth(request(app).post('/currently-watching')).send({ itemId: 'tv-1399', title: 'Test Show' });
    await flushBackgroundFetch();
    expect(fetchTitleWithCredits).toHaveBeenCalledTimes(1);

    const { refreshSeriesSchedules } = require('../../currentlyWatching');
    const user = await new Promise((resolve, reject) =>
      db.get('SELECT id FROM users WHERE username = ?', ['watcher'], (e, r) => (e ? reject(e) : resolve(r)))
    );

    fetchTitleWithCredits.mockResolvedValue(tvPayload({ status: 'Ended', last: '2026-01-01' }));
    const result = await refreshSeriesSchedules(db, user.id);
    expect(result).toEqual({ checked: 1, skipped: 0, failed: 0 });

    const res = await auth(request(app).get('/currently-watching'));
    expect(res.body.items[0].state).toBe('ended');
  });

  test('a finished show is not re-fetched — there is nothing left to learn', async () => {
    fetchTitleWithCredits.mockResolvedValue(tvPayload({ status: 'Ended', last: '2024-05-19' }));
    await auth(request(app).post('/currently-watching')).send({ itemId: 'tv-1399', title: 'Test Show' });
    await flushBackgroundFetch(1);

    const { refreshSeriesSchedules } = require('../../currentlyWatching');
    const user = await new Promise((resolve, reject) =>
      db.get('SELECT id FROM users WHERE username = ?', ['watcher'], (e, r) => (e ? reject(e) : resolve(r)))
    );

    fetchTitleWithCredits.mockClear();
    const result = await refreshSeriesSchedules(db, user.id);
    expect(result).toEqual({ checked: 0, skipped: 1, failed: 0 });
    expect(fetchTitleWithCredits).not.toHaveBeenCalled();
  });

  test('one unreachable show does not abandon the rest', async () => {
    fetchTitleWithCredits.mockResolvedValue(tvPayload({ id: 1 }));
    await auth(request(app).post('/currently-watching')).send({ itemId: 'tv-1', title: 'One' });
    fetchTitleWithCredits.mockResolvedValue(tvPayload({ id: 2 }));
    await auth(request(app).post('/currently-watching')).send({ itemId: 'tv-2', title: 'Two' });
    await flushBackgroundFetch(1);

    const { refreshSeriesSchedules } = require('../../currentlyWatching');
    const user = await new Promise((resolve, reject) =>
      db.get('SELECT id FROM users WHERE username = ?', ['watcher'], (e, r) => (e ? reject(e) : resolve(r)))
    );

    fetchTitleWithCredits.mockImplementation((mediaType, id) =>
      id === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(tvPayload({ id: 2 }))
    );
    const result = await refreshSeriesSchedules(db, user.id);
    expect(result.checked).toBe(2);
    expect(result.failed).toBe(1);
  });
});
