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
const { ensureAnalyticsTables } = require('../../analytics');

const exec = (sql) => new Promise((resolve, reject) => db.run(sql, (e) => (e ? reject(e) : resolve())));
const countMarkers = () => new Promise((resolve, reject) =>
  db.get("SELECT COUNT(*) AS n FROM letterboxd_entries WHERE item_id = ''", (e, row) =>
    (e ? reject(e) : resolve(row.n))));

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
  const tags = await auth(request(app).get('/analytics?dimension=tags'));
  expect(tags.body.collection.topTags).toEqual([]);
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
    const { body } = await auth(request(app).get('/analytics?dimension=decades'));
    const decades = Object.fromEntries(body.eras.decades.map((d) => [d.decade, d.films]));
    expect(decades['2020s']).toBe(1);
    expect(decades['1990s']).toBe(1);
    expect(decades['1970s']).toBe(1);
    expect(body.eras.lagYearsMedian).toBeGreaterThan(0);
  });

  test('keeps tags, which need no watch date', async () => {
    const { body } = await auth(request(app).get('/analytics?dimension=tags'));
    expect(body.collection.topTags.map((t) => t.tag).sort()).toEqual(['epic', 'imax']);
  });

  test('reports no rewatch stat, but still stores the flag', async () => {
    // Not wanted on the page. Kept in the column because a model trained on
    // this history later would want to know a film was worth returning to.
    const { body } = await auth(request(app).get('/analytics'));
    expect(JSON.stringify(body)).not.toMatch(/rewatch/i);

    const stored = await new Promise((resolve, reject) =>
      db.get('SELECT COUNT(*) AS n FROM letterboxd_entries WHERE is_rewatch = 1', [],
        (err, row) => (err ? reject(err) : resolve(row)))
    );
    expect(stored.n).toBe(1);
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
    const genres = await auth(request(app).get('/analytics?dimension=genres'));
    expect(genres.body.breakdown.entries).toEqual([]);
    const directors = await auth(request(app).get('/analytics?dimension=directors'));
    expect(directors.body.breakdown.entries).toEqual([]);
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
    expect(body.summary.runtimeMinutes).toBe(720);
    // The overview points at the other lenses rather than ranking any of them.
    const dirs = body.highlights.find((h) => h.id === 'directors');
    expect(dirs.entries[0]).toMatchObject({ name: 'Denis Villeneuve', films: 5 });

    const genres = await auth(request(app).get('/analytics?dimension=genres'));
    expect(genres.body.breakdown.entries[0]).toMatchObject({ name: 'Science Fiction', films: 5 });

    const directors = await auth(request(app).get('/analytics?dimension=directors'));
    const top = directors.body.breakdown.entries[0];
    expect(top).toMatchObject({ name: 'Denis Villeneuve', films: 5 });
    // Every entry carries a mean and a distance from the reader's own average —
    // the count alone answers the less interesting half of the question.
    expect(top.meanRating).not.toBeNull();
    expect(top.delta).not.toBeNull();

    const cast = await auth(request(app).get('/analytics?dimension=cast'));
    expect(cast.body.breakdown.entries[0]).toMatchObject({ name: 'An Actor', films: 5 });
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
    expect(res.body.hasDiary).toBe(true);

    const { body } = await auth(request(app).get('/analytics?dimension=tags'));
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

describe('re-importing an export', () => {
  const BASE = [
    'Date,Name,Year,Letterboxd URI,Rating',
    '2026-01-01,Alpha,2001,https://boxd.it/a,4',
    '2026-01-01,Beta,2002,https://boxd.it/b,5',
    '2026-01-01,Gamma,2003,https://boxd.it/c,3',
  ].join('\n');
  const PLUS_ONE = `${BASE}\n2026-02-01,Delta,2004,https://boxd.it/d,4`;

  beforeEach(() => {
    let next = 100;
    searchTitleOnTmdb.mockImplementation(async (name) => ({
      itemId: `movie-${++next}`, mediaType: 'movie', title: name, posterUrl: null,
    }));
    fetchTitleWithCredits.mockImplementation(async (_type, id) => ({
      id, title: `Film ${id}`, genres: [{ name: 'Drama' }], runtime: 100,
      external_ids: { imdb_id: `tt${id}` },
      credits: { cast: [{ id: 1, name: 'An Actor' }], crew: [{ job: 'Director', name: 'A Director' }] },
    }));
  });

  test('only the genuinely new film needs looking up', async () => {
    await auth(request(app).post('/letterboxd/diary')).send({ files: [{ name: 'ratings.csv', text: BASE }] });
    await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });
    expect((await auth(request(app).get('/analytics'))).body.coverage.pending).toBe(0);

    searchTitleOnTmdb.mockClear();
    fetchTitleWithCredits.mockClear();

    // A re-upload writes fresh rows with a NULL item_id. Without adopting what
    // the shared cache already knows, all four would report as pending and the
    // page would offer to look up a whole history to learn one film.
    const reimport = await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'ratings.csv', text: PLUS_ONE }] });
    expect(reimport.body.alreadyKnown).toBe(3);

    const { body } = await auth(request(app).get('/analytics'));
    expect(body.coverage.films).toBe(4);
    expect(body.coverage.resolved).toBe(3);
    expect(body.coverage.pending).toBe(1);

    await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });
    expect(searchTitleOnTmdb).toHaveBeenCalledTimes(1);
    expect(fetchTitleWithCredits).toHaveBeenCalledTimes(1);
  });

  test('an identical re-import leaves nothing to do', async () => {
    await auth(request(app).post('/letterboxd/diary')).send({ files: [{ name: 'ratings.csv', text: BASE }] });
    await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });

    searchTitleOnTmdb.mockClear();
    const again = await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'ratings.csv', text: BASE }] });

    expect(again.body.alreadyKnown).toBe(3);
    expect((await auth(request(app).get('/analytics'))).body.coverage.pending).toBe(0);
    expect(searchTitleOnTmdb).not.toHaveBeenCalled();
  });

  test('a film another user resolved is adopted without a lookup', async () => {
    // The lookup cache is shared, so the second account inherits the first
    // account's work the moment it imports.
    await auth(request(app).post('/letterboxd/diary')).send({ files: [{ name: 'ratings.csv', text: BASE }] });
    await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });

    const second = await request(app).post('/register').send({ username: 'othercinephile', password: 'secret1' });
    const auth2 = (req) => req.set('Authorization', `Bearer ${second.body.token}`);

    searchTitleOnTmdb.mockClear();
    const imported = await auth2(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'ratings.csv', text: BASE }] });

    expect(imported.body.alreadyKnown).toBe(3);
    expect((await auth2(request(app).get('/analytics'))).body.coverage.pending).toBe(0);
    expect(searchTitleOnTmdb).not.toHaveBeenCalled();
  });
});

/**
 * The lookup button's job is to fill in genres, directors and cast. It reported
 * itself finished while every one of those was still empty, because two parts of
 * the service disagreed about what "resolved" meant: the resolve endpoint counted
 * a film done once it had a TMDB id, while the analytics page counted it done
 * only once the details behind that id were cached.
 */
describe('the lookup finishes the job it advertises', () => {
  const RATINGS_ONLY = [
    'Date,Name,Year,Letterboxd URI,Rating',
    '2026-01-01,Alpha,2001,https://boxd.it/a,4',
    '2026-01-01,Beta,2002,https://boxd.it/b,5',
  ].join('\n');

  beforeEach(() => {
    let next = 200;
    searchTitleOnTmdb.mockImplementation(async (name) => ({
      itemId: `movie-${++next}`, mediaType: 'movie', title: name, posterUrl: null,
    }));
    fetchTitleWithCredits.mockImplementation(async (_type, id) => ({
      id, title: `Film ${id}`, genres: [{ name: 'Noir' }], runtime: 100,
      external_ids: { imdb_id: `tt${id}` },
      credits: { cast: [{ id: 7, name: 'Lead Player' }], crew: [{ job: 'Director', name: 'Some Director' }] },
    }));
  });

  test('a history already in the lookup cache still gets its details fetched', async () => {
    // The real starting position: these films were resolved long ago by a
    // watched-list import, which caches TMDB ids but never fetches credits. The
    // analytics import then adopts those ids for free.
    await auth(request(app).post('/import/letterboxd')).send({
      importType: 'watched',
      items: [{ name: 'Alpha', year: 2001 }, { name: 'Beta', year: 2002 }],
    });

    const imported = await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'ratings.csv', text: RATINGS_ONLY }] });
    expect(imported.body.alreadyKnown).toBe(2);

    // Adopted ids are not analytics data. Both films still need their credits.
    const before = await auth(request(app).get('/analytics'));
    expect(before.body.coverage.pending).toBe(2);

    const first = await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });
    expect(first.body.pending).toBe(0);

    const after = await auth(request(app).get('/analytics?dimension=directors'));
    expect(after.body.coverage.pending).toBe(0);
    expect(after.body.coverage.resolved).toBe(2);
    expect(after.body.breakdown.entries.map((d) => d.name)).toContain('Some Director');
    const genres = await auth(request(app).get('/analytics?dimension=genres'));
    expect(genres.body.breakdown.entries.map((g) => g.name)).toContain('Noir');
  });

  test('a film the database has nothing for stops counting as pending', async () => {
    // The empty-string marker is falsy, and coalescing it to null on the way out
    // put those films straight back into the pending count — so the page kept
    // offering a lookup the resolve endpoint had already finished with.
    searchTitleOnTmdb.mockResolvedValue(null);
    await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'ratings.csv', text: RATINGS_ONLY }] });

    const done = await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });
    expect(done.body.pending).toBe(0);

    const { body } = await auth(request(app).get('/analytics'));
    expect(body.coverage).toMatchObject({ films: 2, resolved: 0, pending: 0, unmatched: 2 });
  });

  test('a remembered miss is not re-offered on the next import', async () => {
    searchTitleOnTmdb.mockResolvedValue(null);
    await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'ratings.csv', text: RATINGS_ONLY }] });
    await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });

    // A re-import rewrites every row with a null id. Without adopting the
    // cached miss, both films come back as pending and the page offers a
    // lookup that can only fail again.
    const again = await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'ratings.csv', text: RATINGS_ONLY }] });
    expect(again.body.alreadyKnown).toBe(0);   // a miss is not work the user skips
    expect((await auth(request(app).get('/analytics'))).body.coverage.pending).toBe(0);
  });

  test('the crowd comparison works without any IMDb ratings', async () => {
    // Nothing fetches IMDb scores for an imported history — OMDB's daily quota
    // rules it out for thousands of films — so the comparison has to come from
    // the audience score TMDB already returns with the details.
    fetchTitleWithCredits.mockImplementation(async (_type, id) => ({
      id, title: `Film ${id}`, vote_average: 8.0, genres: [{ name: 'Noir' }], runtime: 100,
      external_ids: { imdb_id: `tt${id}` },
      credits: { cast: [], crew: [{ job: 'Director', name: 'Some Director' }] },
    }));
    await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'ratings.csv', text: RATINGS_ONLY }] });
    await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });

    const { body } = await auth(request(app).get('/analytics'));
    // Alpha 4, Beta 5 against a crowd score of 4 for both.
    expect(body.summary.comparedOn).toBe(2);
    expect(body.summary.crowdMean).toBe(4);
    expect(body.summary.tasteOffset).toBe(0.5);
  });

  test('write-off markers left by the old rule are cleared once, and only once', async () => {
    await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'ratings.csv', text: RATINGS_ONLY }] });
    await exec("UPDATE letterboxd_entries SET item_id = ''");

    // The repair ran when this app was created, so it leaves these alone —
    // otherwise every restart would re-queue films TMDB really has nothing for.
    await ensureAnalyticsTables(db);
    expect(await countMarkers()).toBe(2);

    // On a database that has not had it yet, they go back in the queue.
    await exec('DELETE FROM analytics_repairs');
    await ensureAnalyticsTables(db);
    expect(await countMarkers()).toBe(0);
    expect((await auth(request(app).get('/analytics'))).body.coverage.pending).toBe(2);
  });

  test('a film TMDB could not be reached for is retried, not written off', async () => {
    searchTitleOnTmdb.mockRejectedValue(new Error('fetch failed'));

    await auth(request(app).post('/letterboxd/diary'))
      .send({ files: [{ name: 'ratings.csv', text: RATINGS_ONLY }] });

    const failed = await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });
    expect(failed.body.resolved).toBe(0);
    // Still outstanding — an outage is not an answer about these films.
    expect(failed.body.pending).toBe(2);

    let next = 300;
    searchTitleOnTmdb.mockImplementation(async (name) => ({
      itemId: `movie-${++next}`, mediaType: 'movie', title: name, posterUrl: null,
    }));

    const retried = await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });
    expect(retried.body.resolved).toBe(2);
    expect(retried.body.pending).toBe(0);
  });
});

/**
 * The page is a lens over a filtered slice, not one long scroll. Two things have
 * to hold: a lens returns only its own sections, and a filter re-answers every
 * question rather than hiding rows from a fixed answer.
 */
describe('lenses and filters', () => {
  const RATINGS = [
    'Date,Name,Year,Letterboxd URI,Rating',
    '2026-01-01,Alpha,1995,https://boxd.it/a,5',
    '2026-01-01,Beta,2005,https://boxd.it/b,4',
    '2026-01-01,Gamma,2015,https://boxd.it/c,3',
    '2026-01-01,Delta,2015,https://boxd.it/d,2',
  ].join('\n');

  // Alpha + Beta are Kurosawa in Japanese; Gamma + Delta are Fincher in English.
  const SHAPE = {
    Alpha: { lang: 'ja', dir: 'Akira Kurosawa', genre: 'Drama',    actor: 'Toshiro Mifune', country: 'Japan' },
    Beta:  { lang: 'ja', dir: 'Akira Kurosawa', genre: 'Drama',    actor: 'Toshiro Mifune', country: 'Japan' },
    Gamma: { lang: 'en', dir: 'David Fincher',  genre: 'Thriller', actor: 'Rooney Mara',    country: 'United States of America' },
    Delta: { lang: 'en', dir: 'David Fincher',  genre: 'Thriller', actor: 'Rooney Mara',    country: 'United States of America' },
  };

  beforeEach(async () => {
    const byId = {};
    let next = 700;
    searchTitleOnTmdb.mockImplementation(async (name) => {
      const id = ++next;
      byId[id] = name;
      return { itemId: `movie-${id}`, mediaType: 'movie', title: name, posterUrl: null };
    });
    fetchTitleWithCredits.mockImplementation(async (_type, id) => {
      const shape = SHAPE[byId[id]] || SHAPE.Alpha;
      return {
        id, title: byId[id], runtime: 100, vote_average: 7,
        original_language: shape.lang,
        production_countries: [{ name: shape.country }],
        poster_path: `/p${id}.jpg`,
        genres: [{ name: shape.genre }],
        external_ids: { imdb_id: `tt${id}` },
        credits: {
          cast: [{ id: 1, name: shape.actor }],
          crew: [{ job: 'Director', name: shape.dir }],
        },
      };
    });
    await auth(request(app).post('/letterboxd/diary')).send({ files: [{ name: 'ratings.csv', text: RATINGS }] });
    await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });
  });

  test('the watchlist is stored, and stays out of the watched history', async () => {
    // watchlist.csv used to be parsed and dropped. Now it is kept — but it is
    // intent, not history, so none of it may reach the diary numbers.
    const WL = [
      'Date,Name,Year,Letterboxd URI',
      '2026-02-01,Stalker,1979,https://boxd.it/w1',
      '2026-02-01,Alpha,1995,https://boxd.it/w2',
    ].join('\n');
    const re = await auth(request(app).post('/letterboxd/diary')).send({ files: [
      { name: 'ratings.csv', text: RATINGS }, { name: 'watchlist.csv', text: WL },
    ] });
    expect(re.body.watchlist).toBe(2);

    const res = await auth(request(app).get('/analytics'));
    // Four watched films, not six: Stalker and the saved copy of Alpha are not
    // things the user has seen.
    expect(res.body.summary.films).toBe(4);
    expect(res.body.scope.filmsTotal).toBe(4);

    // Alpha was saved and has since been watched; Stalker is still queued.
    expect(res.body.watchlist).toMatchObject({ saved: 2, watched: 1, waiting: 1 });
    expect(res.body.watchlist.stillWaiting.map((f) => f.name)).toEqual(['Stalker']);
  });

  test('a stored watchlist does not enlarge the lookup queue', async () => {
    const WL = ['Date,Name,Year,Letterboxd URI',
      '2026-02-01,Never Seen One,1970,https://boxd.it/w1',
      '2026-02-01,Never Seen Two,1971,https://boxd.it/w2'].join('\n');
    await auth(request(app).post('/letterboxd/diary')).send({ files: [
      { name: 'ratings.csv', text: RATINGS }, { name: 'watchlist.csv', text: WL },
    ] });
    // Everything watched is already resolved by the outer beforeEach, so the
    // only way pending could be non-zero is the watchlist leaking in.
    await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });
    const again = await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });
    expect(again.body.pending).toBe(0);
  });

  test('countries, the quadrant and the mosaic come through', async () => {
    const countries = await auth(request(app).get('/analytics?dimension=countries'));
    expect(countries.body.breakdown.id).toBe('countries');
    expect(countries.body.breakdown.entries.map((e) => e.name)).toContain('Japan');

    const over = await auth(request(app).get('/analytics'));
    // Posters ride along with the top-rated films.
    expect(over.body.mosaic.length).toBeGreaterThan(0);
    expect(over.body.mosaic[0]).toHaveProperty('posterUrl');
    // Highest-rated first.
    expect(over.body.mosaic[0].rating).toBe(5);
  });

  test('a lens returns its own sections and not the others', async () => {
    const dir = await auth(request(app).get('/analytics?dimension=directors'));
    expect(dir.body.dimension).toBe('directors');
    expect(dir.body.breakdown.id).toBe('directors');
    expect(dir.body.eras).toBeNull();
    expect(dir.body.rating).toBeNull();

    const dec = await auth(request(app).get('/analytics?dimension=decades'));
    expect(dec.body.eras).not.toBeNull();
    expect(dec.body.breakdown.entries.map((e) => e.name).sort())
      .toEqual(['1990s', '2000s', '2010s']);

    // The overview leads with ratings and points at the rest.
    const over = await auth(request(app).get('/analytics'));
    expect(over.body.dimension).toBe('overview');
    expect(over.body.rating).not.toBeNull();
    expect(over.body.highlights.map((h) => h.id))
      .toEqual(['directors', 'genres', 'cast', 'languages', 'decades']);
  });

  test('an unknown lens falls back rather than erroring', async () => {
    const res = await auth(request(app).get('/analytics?dimension=astrology'));
    expect(res.status).toBe(200);
    expect(res.body.dimension).toBe('overview');
  });

  test('a language filter re-answers every question, not just the list', async () => {
    const all = await auth(request(app).get('/analytics?dimension=directors'));
    expect(all.body.scope).toMatchObject({ films: 4, filmsTotal: 4, filtered: false });
    expect(all.body.summary.meanRating).toBe(3.5);

    const ja = await auth(request(app).get('/analytics?dimension=directors&language=ja'));
    expect(ja.body.scope).toMatchObject({ films: 2, filmsTotal: 4, filtered: true });
    // Kurosawa's two films only — and the mean is theirs, not the library's.
    expect(ja.body.breakdown.entries.map((e) => e.name)).toEqual(['Akira Kurosawa']);
    expect(ja.body.summary.meanRating).toBe(4.5);
    // Applied filters arrive as labelled chips, ready to render and remove.
    expect(ja.body.filters.applied).toEqual([
      { key: 'language', value: 'ja', label: 'Japanese' },
    ]);
  });

  test('picking a language restricts the people, not just the numbers', async () => {
    // The exact expectation: filter to English and the Cast list shows only
    // actors who appear in English films — the Japanese-only actor is gone.
    const en = await auth(request(app).get('/analytics?dimension=cast&language=en'));
    const names = en.body.breakdown.entries.map((e) => e.name);
    expect(names).toContain('Rooney Mara');
    expect(names).not.toContain('Toshiro Mifune');

    // The Cast filter options in the sheet are restricted the same way, so you
    // can't pick an actor that would empty the screen.
    const castFacet = en.body.filters.available.cast.map((o) => o.value);
    expect(castFacet).toContain('Rooney Mara');
    expect(castFacet).not.toContain('Toshiro Mifune');

    // But the Language list still offers Japanese — a facet is counted against
    // every filter except its own, so switching languages stays discoverable.
    const langs = Object.fromEntries(en.body.filters.available.languages.map((o) => [o.value, o.films]));
    expect(langs).toMatchObject({ en: 2, ja: 2 });
  });

  test('filters compose, and numeric ones parse', async () => {
    const res = await auth(request(app).get('/analytics?language=en&ratingMin=3&dimension=cast'));
    expect(res.body.scope.films).toBe(1);          // Gamma at 3; Delta at 2 is out
    expect(res.body.breakdown.entries.map((e) => e.name)).toEqual(['Rooney Mara']);

    const decade = await auth(request(app).get('/analytics?decade=2010s&dimension=genres'));
    expect(decade.body.scope.films).toBe(2);
    expect(decade.body.breakdown.entries.map((e) => e.name)).toEqual(['Thriller']);
  });

  test('a nonsense filter value narrows to nothing without crashing', async () => {
    const res = await auth(request(app).get('/analytics?language=zz&dimension=directors'));
    expect(res.status).toBe(200);
    expect(res.body.scope.films).toBe(0);
    expect(res.body.summary.meanRating).toBeNull();
    expect(res.body.breakdown.entries).toEqual([]);
  });

  test('an unparseable number is dropped, not treated as zero', async () => {
    const res = await auth(request(app).get('/analytics?ratingMin=abc'));
    expect(res.body.filters.applied).toEqual([]);
    expect(res.body.scope.films).toBe(4);
  });

  test('each facet is counted against the other filters but not its own', async () => {
    const res = await auth(request(app).get('/analytics?language=ja'));
    const { languages, genres } = res.body.filters.available;

    // Its own filter is left out, so switching language is still an option.
    expect(languages.map((l) => l.value).sort()).toEqual(['en', 'ja']);
    expect(languages.find((l) => l.value === 'ja')).toMatchObject({ label: 'Japanese', films: 2 });
    // Everything else narrows: Japanese films are the two Dramas.
    expect(genres.map((g) => g.value)).toEqual(['Drama']);
  });

  test('a picked value stays listed even once the others count it to zero', async () => {
    // Japanese films are never Thrillers, so this pair matches nothing — but
    // both chips have to stay removable.
    const res = await auth(request(app).get('/analytics?language=ja&genre=Thriller'));
    expect(res.body.scope.films).toBe(0);
    expect(res.body.filters.available.genres.find((g) => g.value === 'Thriller'))
      .toMatchObject({ films: 0 });
  });

  test('drilling in is just another filter', async () => {
    // The breakdown names the filter key, so tapping an entry needs no map on
    // the client side.
    const dir = await auth(request(app).get('/analytics?dimension=directors'));
    expect(dir.body.breakdown.filterKey).toBe('director');

    const drilled = await auth(request(app).get('/analytics?dimension=genres&director=David%20Fincher'));
    expect(drilled.body.scope.films).toBe(2);
    expect(drilled.body.breakdown.entries.map((e) => e.name)).toEqual(['Thriller']);
    expect(drilled.body.summary.meanRating).toBe(2.5);
  });

  test('languages are named, not left as codes', async () => {
    const res = await auth(request(app).get('/analytics?dimension=languages'));
    const labels = res.body.breakdown.entries.map((e) => e.label).sort();
    expect(labels).toEqual(['English', 'Japanese']);
  });
});

test('a numeric filter reads as a chip, not a raw value', async () => {
  const RATINGS = [
    'Date,Name,Year,Letterboxd URI,Rating',
    '2026-01-01,Alpha,1995,https://boxd.it/a,5',
    '2026-01-01,Beta,2005,https://boxd.it/b,2',
  ].join('\n');
  await auth(request(app).post('/letterboxd/diary')).send({ files: [{ name: 'ratings.csv', text: RATINGS }] });

  const res = await auth(request(app).get('/analytics?ratingMin=3&rated=yes&yearMax=2000'));
  expect(res.body.filters.applied).toEqual([
    { key: 'yearMax', value: '2000', label: '2000 and earlier' },
    { key: 'ratingMin', value: '3', label: '3★ and up' },
    { key: 'rated', value: 'yes', label: 'Rated only' },
  ]);
  expect(res.body.scope.films).toBe(1);
});
