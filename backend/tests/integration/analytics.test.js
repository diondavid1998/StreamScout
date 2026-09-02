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
  expect(res.body.collection.mostRewatched).toEqual([]);
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

  test('keeps tags and rewatches, which need no watch date', async () => {
    const { body } = await auth(request(app).get('/analytics'));
    expect(body.collection.mostRewatched[0]).toMatchObject({ name: 'Dune: Part Two', viewings: 2 });
    expect(body.collection.topTags.map((t) => t.tag).sort()).toEqual(['epic', 'imax']);
  });

  test('reports no day-frequency stats at all', async () => {
    // Letterboxd stamps a watch date only on logged or reviewed films, and the
    // Date column on everything else is when the row was entered — a bulk
    // rating session puts 161 films on one day. Anything counting films per day
    // would be describing data entry, so none of it is computed.
    const { body } = await auth(request(app).get('/analytics'));
    expect(body.habits).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/busiestDay|longestStreak|weekday|byMonth|calendar/);
  });

  test('says how much is unresolved instead of silently omitting it', async () => {
    const { body } = await auth(request(app).get('/analytics'));
    expect(body.coverage).toMatchObject({ films: 5, resolved: 0, pending: 5 });
    expect(body.people.genres).toEqual([]);
    expect(body.people.directors).toEqual([]);
  });

  test('a date range is ignored rather than half-applied', async () => {
    // It used to filter on watched_on while keeping undated rows, so a range
    // answered with the whole history plus a filter's worth of confusion.
    const ranged = await auth(request(app).get('/analytics?from=2026-02-01&to=2026-12-31'));
    const plain = await auth(request(app).get('/analytics'));
    expect(ranged.body.summary).toEqual(plain.body.summary);
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
    // Every list carries a mean and a distance from the reader's own average —
    // the count alone answers the less interesting half of the question.
    expect(body.people.directors[0].meanRating).not.toBeNull();
    expect(body.people.directors[0].delta).not.toBeNull();
    expect(body.people.cast[0]).toMatchObject({ name: 'An Actor', films: 5 });
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

describe('a large export', () => {
  test('a body past the global 2 MB limit is still accepted', async () => {
    // Five figures of watch history runs past 2 MB as JSON. The global parser
    // would have rejected it with a 413 and no useful message.
    const rows = ['Date,Name,Year,Letterboxd URI,Rating'];
    for (let i = 0; i < 40000; i++) {
      rows.push(`2026-01-01,A Film With A Reasonably Long Title ${i},2001,https://boxd.it/x${i},4`);
    }
    const text = rows.join('\n');
    expect(Buffer.byteLength(text)).toBeGreaterThan(2 * 1024 * 1024);

    const res = await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'ratings.csv', text }] });

    expect(res.status).toBe(200);
    expect(res.body.films).toBe(40000);
  }, 60000);
});

describe('an export with no diary.csv', () => {
  // Shaped after a real Letterboxd export that arrived as ratings, watched,
  // reviews, watchlist and profile — no diary at all. reviews.csv was then the
  // only file carrying a watch date, a rewatch flag or a tag.
  const REVIEWS = [
    'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date',
    '2026-01-05,Sinners,2025,https://boxd.it/a,5,,A single-line review,imax,2026-01-04',
    '2026-01-08,Nosferatu,2024,https://boxd.it/b,3.5,Yes,"Pros:',
    'The bat.',
    '',
    'Cons:',
    'Everything else",,2026-01-07',
  ].join('\n');

  const RATINGS_ONLY = [
    'Date,Name,Year,Letterboxd URI,Rating',
    '2026-01-05,Sinners,2025,https://boxd.it/a,5',
    '2020-01-01,Heat,1995,https://boxd.it/c,4',
  ].join('\n');

  const WATCHED_ONLY = [
    'Date,Name,Year,Letterboxd URI',
    '2026-01-05,Sinners,2025,https://boxd.it/a',
    '2019-01-01,The Thing,1982,https://boxd.it/d',
  ].join('\n');

  const PROFILE = 'Date Joined,Username,Given Name,Family Name,Email Address\n2020-05-16,someone,A,B,a@b.c';

  test('reads dates, rewatches and tags out of reviews.csv', async () => {
    const res = await auth(request(app).post('/letterboxd/diary')).send({
      files: [
        { name: 'reviews.csv', text: REVIEWS },
        { name: 'ratings.csv', text: RATINGS_ONLY },
        { name: 'watched.csv', text: WATCHED_ONLY },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.films).toBe(4);
    // Both reviewed films carry a date; nothing else in the export does.
    expect(res.body.dated).toBe(2);
    expect(res.body.rewatches).toBe(1);
    expect(res.body.hasDiary).toBe(true);

    const { body } = await auth(request(app).get('/analytics'));
    expect(body.collection.topTags).toEqual([{ tag: 'imax', films: 1 }]);
    // A review body spanning five lines with a blank line in the middle is one
    // record, not five broken ones.
    expect(body.summary.films).toBe(4);
  });

  test('profile.csv is not read — it is the file with the email address', async () => {
    const res = await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'profile.csv', text: PROFILE }, { name: 'ratings.csv', text: RATINGS_ONLY }] });

    expect(res.status).toBe(200);
    expect(res.body.files.find((f) => f.name === 'profile.csv').kind).toBe('unknown');
    expect(res.body.films).toBe(2);
  });

  test('a hashed filename prefix still classifies', async () => {
    const res = await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'af56586c-ratings.csv', text: RATINGS_ONLY }] });
    expect(res.body.files[0].kind).toBe('ratings');
  });
});

test('a rewatch flagged on a single row still counts as a rewatch', async () => {
  // Without a diary.csv a rewatched film has one row carrying Rewatch=Yes,
  // not two rows. Counting rows alone reported zero rewatched films on an
  // export whose own summary said five.
  const reviews = [
    'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date',
    '2026-01-05,Nosferatu,2024,https://boxd.it/a,3.5,Yes,Seen it before,,2026-01-04',
  ].join('\n');

  const res = await auth(request(app).post('/letterboxd/diary')).send({
    files: [{ name: 'reviews.csv', text: reviews }],
  });
  expect(res.body.rewatches).toBe(1);

  const { body } = await auth(request(app).get('/analytics'));
  expect(body.summary.rewatches).toBe(1);
  expect(body.collection.mostRewatched).toEqual([
    { name: 'Nosferatu', year: 2024, viewings: 2 },
  ]);
});
