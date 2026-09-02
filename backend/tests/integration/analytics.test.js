'use strict';

/**
 * The Letterboxd analytics path, end to end: a whole export goes in, and the
 * numbers that come back are computed from those files and nothing else.
 */

jest.mock('../../movieService', () => {
  const actual = jest.requireActual('../../movieService');
  return {
    ...actual,
    fetchTitleWithCredits: jest.fn(),
    searchTitleOnTmdb: jest.fn(),
    fetchTitleDetails: jest.fn(),
    fetchOmdbRatings: jest.fn(),
    isOmdbRateLimited: jest.fn().mockReturnValue(false),
  };
});

const request = require('supertest');
const { createTestDb, closeDb } = require('../testHelpers');
const { createApp } = require('../../app');
const { fetchTitleWithCredits, searchTitleOnTmdb } = require('../../movieService');

const DIARY = [
  'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date',
  '2026-01-05,Dune: Part Two,2024,https://boxd.it/a,4.5,,"imax, epic",2026-01-05',
  '2026-01-06,Arrival,2016,https://boxd.it/b,5,,,2026-01-06',
  '2026-01-07,Heat,1995,https://boxd.it/c,4,,,2026-01-07',
  '2026-03-02,Dune: Part Two,2024,https://boxd.it/d,5,Yes,,2026-03-02',
].join('\n');

const RATINGS = [
  'Date,Name,Year,Letterboxd URI,Rating',
  '2026-01-05,Dune: Part Two,2024,https://boxd.it/a,4.5',
  '2025-11-01,Solaris,1972,https://boxd.it/e,3',
].join('\n');

const WATCHED = [
  'Date,Name,Year,Letterboxd URI',
  '2026-01-05,Dune: Part Two,2024,https://boxd.it/a',
  '2020-01-01,The Thing,1982,https://boxd.it/f',
].join('\n');

const WATCHLIST = [
  'Date,Name,Year,Letterboxd URI',
  '2026-02-01,Stalker,1979,https://boxd.it/g',
].join('\n');

const EXPORT_FILES = [
  { name: 'diary.csv', text: DIARY },
  { name: 'ratings.csv', text: RATINGS },
  { name: 'watched.csv', text: WATCHED },
  { name: 'watchlist.csv', text: WATCHLIST },
];

let db, app, token;
const auth = (req) => req.set('Authorization', `Bearer ${token}`);

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createTestDb();
  app = createApp(db, { disableRateLimit: true });
  const reg = await request(app).post('/register').send({ username: 'cinephile', password: 'secret1' });
  token = reg.body.token;
});
afterEach(async () => { await closeDb(db); });

describe('importing an export', () => {
  test('merges the three watched files without triple-counting', async () => {
    const res = await auth(request(app).post('/letterboxd/diary')).send({ files: EXPORT_FILES });

    expect(res.status).toBe(200);
    // Dune, Arrival, Heat, Solaris, The Thing — five films, six viewings
    // because Dune was logged twice.
    expect(res.body.films).toBe(5);
    expect(res.body.viewings).toBe(6);
    expect(res.body.rewatches).toBe(1);
    expect(res.body.rated).toBe(5);
    expect(res.body.hasDiary).toBe(true);
    expect(res.body.watchlist).toBe(1);
  });

  test('re-importing replaces rather than doubling', async () => {
    await auth(request(app).post('/letterboxd/diary')).send({ files: EXPORT_FILES });
    await auth(request(app).post('/letterboxd/diary')).send({ files: EXPORT_FILES });

    const res = await auth(request(app).get('/analytics'));
    expect(res.body.summary.films).toBe(5);
    expect(res.body.summary.viewings).toBe(6);
  });

  test('rejects an upload with no films in it', async () => {
    const res = await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'profile.csv', text: 'Username,Given Name\nsomeone,Someone' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/folder/i);
  });

  test('reads the files even when they have been renamed', async () => {
    const res = await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'export-1.csv', text: DIARY }, { name: 'export-2.csv', text: WATCHED }] });
    expect(res.status).toBe(200);
    expect(res.body.files.map((f) => f.kind).sort()).toEqual(['diary', 'watched']);
  });
});

test('a user who has never imported gets zeros, not a crash', async () => {
  // The first-run path: the iOS screen decides between its empty state and the
  // charts on summary.films, so this has to answer rather than 500.
  const res = await auth(request(app).get('/analytics'));
  expect(res.status).toBe(200);
  expect(res.body.summary.films).toBe(0);
  expect(res.body.summary.meanRating).toBeNull();
  expect(res.body.habits.hasDates).toBe(false);
  expect(res.body.coverage).toMatchObject({ films: 0, pending: 0 });
});

describe('analytics from the CSVs alone', () => {
  beforeEach(async () => {
    await auth(request(app).post('/letterboxd/diary')).send({ files: EXPORT_FILES });
  });

  test('needs no TMDB call at all', async () => {
    const res = await auth(request(app).get('/analytics'));
    expect(res.status).toBe(200);
    expect(searchTitleOnTmdb).not.toHaveBeenCalled();
    expect(fetchTitleWithCredits).not.toHaveBeenCalled();
  });

  test('summarises the diary', async () => {
    const { body } = await auth(request(app).get('/analytics'));
    expect(body.summary.films).toBe(5);
    expect(body.summary.rated).toBe(5);
    // 4.5 + 5 + 4 + 5 + 3 = 21.5 over five ratings
    expect(body.summary.meanRating).toBe(4.3);
    expect(body.summary.firstWatched).toBe('2026-01-05');
    expect(body.summary.lastWatched).toBe('2026-03-02');
  });

  test('buckets ratings in half stars and finds the mode', async () => {
    const { body } = await auth(request(app).get('/analytics'));
    expect(body.rating.histogram).toHaveLength(10);
    const five = body.rating.histogram.find((b) => b.rating === 5);
    expect(five.films).toBe(2);
    expect(body.rating.mode.rating).toBe(5);
  });

  test('reads decades and the release-to-watch lag from the Year column', async () => {
    const { body } = await auth(request(app).get('/analytics'));
    const decades = Object.fromEntries(body.eras.decades.map((d) => [d.decade, d.films]));
    expect(decades['2020s']).toBe(1);
    expect(decades['1990s']).toBe(1);
    expect(decades['1970s']).toBe(1);
    expect(body.eras.lagYearsMedian).toBeGreaterThan(0);
  });

  test('derives habits from watched dates', async () => {
    const { body } = await auth(request(app).get('/analytics'));
    expect(body.habits.hasDates).toBe(true);
    // 5 Jan 2026 is a Monday, 6 Jan a Tuesday, 7 Jan a Wednesday — and 2 Mar is
    // exactly eight weeks after 5 Jan, so it lands on a Monday too.
    const weekday = Object.fromEntries(body.habits.weekday.map((w) => [w.day, w.films]));
    expect(weekday.Monday).toBe(2);
    expect(weekday.Tuesday).toBe(1);
    expect(weekday.Wednesday).toBe(1);
    expect(body.habits.streaks.longestStreakDays).toBe(3);
    expect(body.habits.mostRewatched[0]).toMatchObject({ name: 'Dune: Part Two', viewings: 2 });
    expect(body.habits.topTags.map((t) => t.tag).sort()).toEqual(['epic', 'imax']);
  });

  test('says how much is unresolved instead of silently omitting it', async () => {
    const { body } = await auth(request(app).get('/analytics'));
    expect(body.coverage).toMatchObject({ films: 5, resolved: 0, pending: 5 });
    expect(body.people.genres).toEqual([]);
    expect(body.people.directors).toEqual([]);
  });

  test('a date range narrows the diary', async () => {
    const { body } = await auth(request(app).get('/analytics?from=2026-02-01&to=2026-12-31'));
    // Only the March rewatch has a date inside the window; undated films stay,
    // because excluding them would silently drop the rating histogram.
    expect(body.habits.byMonth).toEqual([{ month: '2026-03', films: 1 }]);
  });
});

describe('resolving genres and people', () => {
  beforeEach(async () => {
    await auth(request(app).post('/letterboxd/diary')).send({ files: EXPORT_FILES });
  });

  function movie(id, title, genres, director) {
    return {
      id, title, genres: genres.map((name) => ({ name })), runtime: 120,
      release_date: '2024-01-01', external_ids: { imdb_id: `tt${id}` },
      credits: { cast: [{ id: 1, name: 'An Actor' }], crew: [{ job: 'Director', name: director }] },
    };
  }

  test('fills in directors and genres, and reports what is left', async () => {
    let next = 100;
    searchTitleOnTmdb.mockImplementation(async (name) => ({
      itemId: `movie-${++next}`, mediaType: 'movie', title: name, posterUrl: null,
    }));
    fetchTitleWithCredits.mockImplementation(async (_type, id) =>
      movie(id, `Film ${id}`, ['Science Fiction'], 'Denis Villeneuve')
    );

    const res = await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });
    expect(res.body.resolved).toBe(5);
    expect(res.body.pending).toBe(0);

    const { body } = await auth(request(app).get('/analytics'));
    expect(body.coverage.resolved).toBe(5);
    expect(body.people.genres[0]).toMatchObject({ name: 'Science Fiction', films: 5 });
    expect(body.people.directors[0]).toMatchObject({ name: 'Denis Villeneuve', films: 5 });
    expect(body.summary.runtimeMinutes).toBe(720);
  });

  test('a film TMDB cannot find is not retried forever', async () => {
    searchTitleOnTmdb.mockResolvedValue(null);

    const first = await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });
    expect(first.body.failed).toBe(5);
    expect(first.body.pending).toBe(0);

    searchTitleOnTmdb.mockClear();
    const second = await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });
    expect(second.body.pending).toBe(0);
    expect(searchTitleOnTmdb).not.toHaveBeenCalled();
  });
});
