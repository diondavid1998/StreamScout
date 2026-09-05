'use strict';

/**
 * The swipe queue, end to end.
 *
 * The interesting behaviour is not "does it return cards" — it is the set of
 * judgements the spec argues for: that a thin diary is not trusted like a thick
 * one, that a pass is not treated as the opposite of a save, and that the
 * queue does not converge on one genre.
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
const { fetchTitleWithCredits } = require('../../movieService');
const { buildTasteProfile, blendWeight, suppressedValues } = require('../../discovery');

const SCOPE = 'region:US|platforms:netflix|languages:';

let db, app, token;
const auth = (req) => req.set('Authorization', `Bearer ${token}`);

/** A catalog row on the reader's service. */
async function addCandidate({ id, title, genres = ['Drama'], language = 'en', year = 2015, imdb = '7.5' }) {
  await new Promise((resolve, reject) => db.run(
    `INSERT INTO catalog_cache_entries
       (scope_key, media_type, tmdb_id, title, year, release_date, popularity, updated_at,
        first_seen_at, genres_json, original_language, rating_imdb, rating_imdb_num,
        available_on_keys_json, available_on_json)
     VALUES (?, 'movie', ?, ?, ?, ?, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, '["netflix"]', '["Netflix"]')`,
    [SCOPE, id, title, String(year), `${year}-01-01`, JSON.stringify(genres), language, imdb, parseFloat(imdb)],
    (e) => (e ? reject(e) : resolve())
  ));
}

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createTestDb();
  app = createApp(db, { disableRateLimit: true });
  const reg = await request(app).post('/register').send({ username: 'swiper', password: 'secret1' });
  token = reg.body.token;
  await auth(request(app).put('/platforms')).send({ platforms: ['netflix'], languages: [] });
});
afterEach(async () => { await closeDb(db); });

describe('the taste profile', () => {
  const diary = (rows) => rows.map((r, i) => ({
    filmKey: `f${i}`, name: `Film ${i}`, year: 2010, rating: r.rating ?? null,
    genres: r.genres || [], language: 'en', directors: r.directors || [],
    cast: [], writers: [], keywords: [], studios: [],
    isRewatch: Boolean(r.rewatch), isLiked: Boolean(r.liked), hasReview: false,
    countries: [], tags: [], crowdRating: null, resolved: true,
  }));

  test('one great film is not a preference, twenty steady ones are', () => {
    const profile = buildTasteProfile(diary([
      // A single five-star Western against a body of solid Dramas.
      { rating: 5, genres: ['Western'] },
      ...Array.from({ length: 20 }, () => ({ rating: 4.5, genres: ['Drama'] })),
      ...Array.from({ length: 10 }, () => ({ rating: 2, genres: ['Horror'] })),
    ]));

    const western = profile.affinities.genres.Western;
    const drama = profile.affinities.genres.Drama;
    // The Western scores higher per film and still loses, because one film is
    // not evidence.
    expect(drama.score).toBeGreaterThan(western.score);
    expect(profile.affinities.genres.Horror.score).toBeLessThan(0);
  });

  test('a rewatch and a like count beyond the score', () => {
    const plain = buildTasteProfile(diary(
      Array.from({ length: 4 }, () => ({ rating: 4, genres: ['Drama'] }))
    ));
    const endorsed = buildTasteProfile(diary(
      Array.from({ length: 4 }, () => ({ rating: 4, genres: ['Drama'], rewatch: true, liked: true }))
    ));
    expect(endorsed.affinities.genres.Drama.score)
      .toBeGreaterThan(plain.affinities.genres.Drama.score);
  });

  test('a thin diary is blended toward the crowd rather than believed', () => {
    const thin = buildTasteProfile(diary([{ rating: 5, genres: ['Drama'] }]));
    const thick = buildTasteProfile(diary(
      Array.from({ length: 60 }, () => ({ rating: 4, genres: ['Drama'] }))
    ));
    expect(blendWeight(thin)).toBeLessThan(0.2);
    expect(blendWeight(thick)).toBe(1);
    // And no diary at all leans entirely on the crowd.
    expect(blendWeight(buildTasteProfile([]))).toBe(0);
  });
});

describe('what a swipe means', () => {
  test('a few passes do not delete a genre, a run of them does', () => {
    const pass = (genre) => ({ direction: 'left', genres_json: JSON.stringify([genre]) });
    const save = (genre) => ({ direction: 'right', genres_json: JSON.stringify([genre]) });

    // Three passes is "not tonight" three times.
    expect(suppressedValues([pass('Horror'), pass('Horror'), pass('Horror')]).size).toBe(0);
    // Four with nothing saved starts to mean something.
    expect(suppressedValues([pass('Horror'), pass('Horror'), pass('Horror'), pass('Horror')]))
      .toContain('Horror');
    // But one save is enough to keep it in play, however many passes there are.
    expect(suppressedValues([
      pass('Horror'), pass('Horror'), pass('Horror'), pass('Horror'), save('Horror'),
    ]).size).toBe(0);
  });
});

describe('the queue', () => {
  test('a reader with no diary still gets cards, and is told what they rest on', async () => {
    await addCandidate({ id: 1, title: 'Well Regarded', imdb: '8.5' });
    await addCandidate({ id: 2, title: 'Poorly Regarded', imdb: '4.0' });

    const res = await auth(request(app).get('/discovery'));
    expect(res.status).toBe(200);
    expect(res.body.cards.length).toBeGreaterThan(0);
    // Honest about it: this is the crowd's opinion, not the reader's.
    expect(res.body.profile.basis).toBe('crowd');
    expect(res.body.profile.confidence).toBe('none');
  });

  test('a swiped title never comes back', async () => {
    await addCandidate({ id: 10, title: 'Seen It Already' });
    await addCandidate({ id: 11, title: 'Still New' });

    const before = await auth(request(app).get('/discovery'));
    expect(before.body.cards.map((c) => c.title)).toContain('Seen It Already');

    await auth(request(app).post('/discovery/swipe'))
      .send({ itemId: 'movie-10', direction: 'left', genres: ['Drama'] });

    const after = await auth(request(app).get('/discovery'));
    expect(after.body.cards.map((c) => c.title)).not.toContain('Seen It Already');
    expect(after.body.cards.map((c) => c.title)).toContain('Still New');
  });

  test('a right swipe saves to the watchlist in the same call', async () => {
    await addCandidate({ id: 20, title: 'Saved For Later' });

    await auth(request(app).post('/discovery/swipe')).send({
      itemId: 'movie-20', direction: 'right', mediaType: 'movie', title: 'Saved For Later',
    });

    const list = await auth(request(app).get('/watchlist'));
    expect(list.body.items.map((i) => i.itemId)).toContain('movie-20');
  });

  test('undo puts the card back and takes the watchlist entry with it', async () => {
    await addCandidate({ id: 30, title: 'Swiped By Mistake' });

    await auth(request(app).post('/discovery/swipe')).send({
      itemId: 'movie-30', direction: 'right', mediaType: 'movie', title: 'Swiped By Mistake',
    });
    await auth(request(app).delete('/discovery/swipe/movie-30'));

    const after = await auth(request(app).get('/discovery'));
    expect(after.body.cards.map((c) => c.title)).toContain('Swiped By Mistake');
    const list = await auth(request(app).get('/watchlist'));
    expect(list.body.items.map((i) => i.itemId)).not.toContain('movie-30');
  });

  test('hideWatched keeps out films the imported diary already knows about', async () => {
    await addCandidate({ id: 40, title: 'Heat', year: 1995 });
    await addCandidate({ id: 41, title: 'Unseen Film', year: 1995 });

    const RATINGS = ['Date,Name,Year,Letterboxd URI,Rating', '2026-01-01,Heat,1995,https://boxd.it/a,5'].join('\n');
    await auth(request(app).post('/letterboxd/diary')).send({ files: [{ name: 'ratings.csv', text: RATINGS }] });

    const hidden = await auth(request(app).get('/discovery?hideWatched=true'));
    expect(hidden.body.cards.map((c) => c.title)).not.toContain('Heat');
    expect(hidden.body.cards.map((c) => c.title)).toContain('Unseen Film');

    // And asking for them back works, because "seen it" is sometimes the point.
    const shown = await auth(request(app).get('/discovery?hideWatched=false'));
    expect(shown.body.cards.map((c) => c.title)).toContain('Heat');
  });

  test('the media filter narrows to one kind', async () => {
    await addCandidate({ id: 50, title: 'A Film' });
    await new Promise((resolve, reject) => db.run(
      `INSERT INTO catalog_cache_entries
         (scope_key, media_type, tmdb_id, title, year, popularity, updated_at, genres_json,
          original_language, available_on_keys_json, available_on_json)
       VALUES (?, 'tv', 51, 'A Series', '2015', 50, CURRENT_TIMESTAMP, '["Drama"]', 'en',
               '["netflix"]', '["Netflix"]')`,
      [SCOPE], (e) => (e ? reject(e) : resolve())
    ));

    const movies = await auth(request(app).get('/discovery?mediaType=movie'));
    expect(movies.body.cards.every((c) => c.mediaType === 'movie')).toBe(true);
    const series = await auth(request(app).get('/discovery?mediaType=tv'));
    expect(series.body.cards.map((c) => c.title)).toEqual(['A Series']);
  });

  test('every card says why it is there', async () => {
    for (let i = 60; i < 70; i++) await addCandidate({ id: i, title: `Film ${i}` });
    const res = await auth(request(app).get('/discovery'));
    // Either a reason drawn from the diary, or an honest label saying it is not.
    expect(res.body.cards.every((c) => Array.isArray(c.because))).toBe(true);
  });

  test('an empty catalog says so rather than returning an empty list', async () => {
    const res = await auth(request(app).get('/discovery'));
    expect(res.body.cards).toEqual([]);
    expect(res.body.exhausted).toBe(true);
  });
});

/**
 * Tier 2 is the half that costs money, so it needs to be shown doing something
 * a cheaper tier could not — and shown *not* running when it would buy nothing.
 */
describe('the second tier', () => {
  const DIARY = [
    'Date,Name,Year,Letterboxd URI,Rating',
    // A body of work by one director, rated well above everything else.
    ...Array.from({ length: 8 }, (_, i) => `2026-01-0${(i % 9) + 1},Mann Film ${i},200${i},https://boxd.it/m${i},5`),
    ...Array.from({ length: 30 }, (_, i) => `2026-02-01,Other Film ${i},1999,https://boxd.it/o${i},2.5`),
  ].join('\n');

  test('a director you rate highly lifts a film the catalog alone could not tell apart', async () => {
    let next = 5000;
    const byId = {};
    const { searchTitleOnTmdb } = require('../../movieService');
    searchTitleOnTmdb.mockImplementation(async (name) => {
      const id = ++next; byId[id] = name;
      return { itemId: `movie-${id}`, mediaType: 'movie', title: name, posterUrl: null };
    });
    fetchTitleWithCredits.mockImplementation(async (_type, id) => ({
      id,
      title: byId[id] || `Title ${id}`,
      runtime: 100, vote_average: 7, vote_count: 900, original_language: 'en',
      genres: [{ name: 'Drama' }], external_ids: { imdb_id: `tt${id}` },
      keywords: { keywords: [] }, release_dates: { results: [] },
      production_countries: [], production_companies: [],
      credits: {
        cast: [],
        // Every film in the diary is by Michael Mann; the two candidates differ
        // only in who directed them.
        crew: [{ job: 'Director', name: String(byId[id] || '').startsWith('Mann') || id === 900 ? 'Michael Mann' : 'Someone Else' }],
      },
    }));

    await auth(request(app).post('/letterboxd/diary')).send({ files: [{ name: 'ratings.csv', text: DIARY }] });
    await auth(request(app).post('/analytics/resolve')).send({ limit: 100 });

    // Two candidates the catalog describes identically: same genre, language,
    // decade and crowd score. Only the director differs, and only tier 2 knows it.
    await addCandidate({ id: 900, title: 'By Michael Mann', genres: ['Drama'], year: 2015, imdb: '7.0' });
    await addCandidate({ id: 901, title: 'By Someone Else', genres: ['Drama'], year: 2015, imdb: '7.0' });

    const res = await auth(request(app).get('/discovery?limit=10'));
    const titles = res.body.cards.map((c) => c.title);
    expect(titles.indexOf('By Michael Mann')).toBeLessThan(titles.indexOf('By Someone Else'));

    const lifted = res.body.cards.find((c) => c.title === 'By Michael Mann');
    expect(lifted.tier).toBe(2);
    // And it says why, in the reader's own terms.
    expect(lifted.because.some((r) => r.kind === 'director' && r.value === 'Michael Mann')).toBe(true);
  });

  test('with no diary it does not spend a single call', async () => {
    for (let i = 800; i < 810; i++) await addCandidate({ id: i, title: `Film ${i}` });

    const res = await auth(request(app).get('/discovery'));

    expect(res.body.cards.length).toBeGreaterThan(0);
    // Nothing to match against, so the extra axes would buy nothing and the
    // calls are not made.
    expect(fetchTitleWithCredits).not.toHaveBeenCalled();
    expect(res.body.cards.every((c) => c.tier === 1)).toBe(true);
  });
});
