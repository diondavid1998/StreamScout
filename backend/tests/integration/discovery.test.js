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
async function addCandidate({
  id, title, genres = ['Drama'], language = 'en', year = 2015, imdb = '7.5',
  // A title no subscription covers: `availableOn` is empty and the storefronts
  // are the only thing that can tell the reader where to watch it.
  keys = ['netflix'], on = ['Netflix'], stores = [],
}) {
  await new Promise((resolve, reject) => db.run(
    `INSERT INTO catalog_cache_entries
       (scope_key, media_type, tmdb_id, title, year, release_date, popularity, updated_at,
        first_seen_at, genres_json, original_language, rating_imdb, rating_imdb_num,
        available_on_keys_json, available_on_json, purchase_on_json)
     VALUES (?, 'movie', ?, ?, ?, ?, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)`,
    [SCOPE, id, title, String(year), `${year}-01-01`, JSON.stringify(genres), language, imdb,
     parseFloat(imdb), JSON.stringify(keys), JSON.stringify(on), JSON.stringify(stores)],
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
    cinematographers: r.cinematographers || [], composers: r.composers || [],
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

  test('how much of your viewing a name holds counts, not just how you rate it', () => {
    // "Most watched" and "highest rated" are different claims and the profile
    // owes the reader both. Confidence is satisfied at three films and then
    // caps, so without a volume term a director with three films and one with
    // thirty scored identically — and the one the reader has actually built
    // their viewing around carried no extra weight at all.
    const person = (id) => [{ key: `p:${id}`, label: `Director ${id}` }];
    const profile = buildTasteProfile(diary([
      ...Array.from({ length: 3 }, () => ({ rating: 4.5, directors: person(1) })),
      ...Array.from({ length: 30 }, () => ({ rating: 4.5, directors: person(2) })),
      ...Array.from({ length: 20 }, () => ({ rating: 2, genres: ['Horror'] })),
    ]));

    const occasional = profile.affinities.directors['p:1'];
    const habitual = profile.affinities.directors['p:2'];
    // Rated identically. Only the volume differs.
    expect(occasional.meanRating).toBeCloseTo(habitual.meanRating, 5);
    expect(habitual.score).toBeGreaterThan(occasional.score);
  });

  test('the crew the diary always carried is now part of the profile', () => {
    // Both were on every diary row and in every cached payload, and the
    // recommender read neither.
    const profile = buildTasteProfile(diary([
      ...Array.from({ length: 5 }, () => ({
        rating: 5,
        cinematographers: [{ key: 'p:10', label: 'Roger Deakins' }],
        composers: [{ key: 'p:20', label: 'Jóhann Jóhannsson' }],
      })),
      ...Array.from({ length: 10 }, () => ({ rating: 2.5 })),
    ]));

    expect(profile.affinities.cinematographers['p:10'].score).toBeGreaterThan(0);
    expect(profile.affinities.composers['p:20'].score).toBeGreaterThan(0);
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

  test('a title already on the watchlist is never suggested', async () => {
    // The reported bug. The catalog's exclusion only ever covered watched_items,
    // so a title saved from the Discover page — or imported from Letterboxd's
    // watchlist.csv — kept turning up as a suggestion. A right swipe adds to the
    // watchlist, so the card was offering the reader something they already had
    // and a swipe that would change nothing.
    await addCandidate({ id: 40, title: 'Already Saved' });
    await addCandidate({ id: 41, title: 'Genuinely New' });

    await auth(request(app).post('/watchlist')).send({
      itemId: 'movie-40', mediaType: 'movie', title: 'Already Saved',
    });

    const res = await auth(request(app).get('/discovery'));
    const titles = res.body.cards.map((c) => c.title);
    expect(titles).not.toContain('Already Saved');
    expect(titles).toContain('Genuinely New');
  });

  test('the watchlist is excluded even with hideWatched turned off', async () => {
    // The two are different questions. "Show me things I have seen" is a real
    // request; "show me things already sitting in my watchlist" is not, because
    // saving them again is the only thing a card can do.
    await addCandidate({ id: 45, title: 'Saved And Asked For' });

    await auth(request(app).post('/watchlist')).send({
      itemId: 'movie-45', mediaType: 'movie', title: 'Saved And Asked For',
    });

    const res = await auth(request(app).get('/discovery?hideWatched=false'));
    expect(res.body.cards.map((c) => c.title)).not.toContain('Saved And Asked For');
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
describe('narrowing the deck', () => {
  beforeEach(async () => {
    await addCandidate({ id: 60, title: 'Old Japanese Drama', genres: ['Drama'], language: 'ja', year: 1954 });
    await addCandidate({ id: 61, title: 'New English Horror', genres: ['Horror'], language: 'en', year: 2022 });
    await addCandidate({ id: 62, title: 'New Japanese Horror', genres: ['Horror'], language: 'ja', year: 2021 });
  });

  const titles = (res) => res.body.cards.map((c) => c.title);

  test('a genre filter narrows the pool the scoring runs over', async () => {
    // Applied to the slice rather than to the finished cards, which is the part
    // that matters: filtering afterwards would give whichever of the twenty best
    // happened to be Horror, and could easily be none of them.
    const res = await auth(request(app).get('/discovery?genreFilters=Horror'));
    expect(titles(res).sort()).toEqual(['New English Horror', 'New Japanese Horror']);
  });

  test('a language filter narrows it too, and the two combine', async () => {
    const one = await auth(request(app).get('/discovery?languageFilters=ja'));
    expect(one.body.cards).toHaveLength(2);

    const both = await auth(request(app).get('/discovery?languageFilters=ja&genreFilters=Horror'));
    expect(titles(both)).toEqual(['New Japanese Horror']);
  });

  test('a year range narrows it', async () => {
    const res = await auth(request(app).get('/discovery?yearMin=2000'));
    expect(titles(res)).not.toContain('Old Japanese Drama');

    const window = await auth(request(app).get('/discovery?yearMin=2022&yearMax=2022'));
    expect(titles(window)).toEqual(['New English Horror']);
  });

  test('a service the reader does not have is ignored rather than emptying the deck', async () => {
    // A stale filter — a service dropped since the sheet was last opened —
    // would otherwise produce a blank screen with nothing on it to explain why.
    const res = await auth(request(app).get('/discovery?serviceFilters=disney'));
    expect(res.status).toBe(200);
    expect(res.body.cards.length).toBeGreaterThan(0);
  });

  test('a filter that matches nothing says the queue is exhausted', async () => {
    // Not an error, and not an empty list with no explanation: the screen needs
    // to tell the difference between "nothing left" and "nothing loaded".
    const res = await auth(request(app).get('/discovery?genreFilters=Western'));
    expect(res.status).toBe(200);
    expect(res.body.cards).toEqual([]);
    expect(res.body.exhausted).toBe(true);
  });
});

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


describe('a suggestion nobody streams', () => {
  it('carries the storefronts, so the card can say where to watch it', async () => {
    // A reader who picked VOD. Their scope key names both services, and the
    // candidate query filters on the same keys — so a rentable title is only
    // ever suggested to someone who asked for rentable titles.
    await auth(request(app).put('/platforms')).send({ platforms: ['netflix', 'vod'], languages: [] });
    const vodScope = 'region:US|platforms:netflix,vod|languages:';

    await new Promise((resolve, reject) => db.run(
      `INSERT INTO catalog_cache_entries
         (scope_key, media_type, tmdb_id, title, year, release_date, popularity, updated_at,
          first_seen_at, genres_json, original_language, rating_imdb, rating_imdb_num,
          available_on_keys_json, available_on_json, purchase_on_json)
       VALUES (?, 'movie', 9001, 'Rent Only Pick', '2026', '2026-01-01', 90, CURRENT_TIMESTAMP,
               CURRENT_TIMESTAMP, '["Drama"]', 'en', '7.8', 7.8, '["vod"]', '[]', '[{"name":"Apple TV","tiers":["rent"]}]')`,
      [vodScope],
      (e) => (e ? reject(e) : resolve())
    ));

    const res = await auth(request(app).get('/discovery'));
    const card = res.body.cards.find((c) => c.title === 'Rent Only Pick');
    expect(card).toBeDefined();
    // Nothing a subscription covers, so without the storefronts this card would
    // render no availability line at all.
    expect(card.availableOn).toEqual([]);
    expect(card.purchaseOn).toEqual([{ name: 'Apple TV', tiers: ['rent'] }]);
  });
});


/**
 * What the ranking weighs, now that it weighs more than genre.
 *
 * The queue used to score everything on genre, language and decade, then buy a
 * TMDB call for the best forty and score only those on who made the film. Two
 * consequences the reader could feel: a film by the director they have watched
 * thirty times sat wherever its genre put it, and a film sharing four familiar
 * faces outranked one sharing an author, because every lens counted the same
 * and none of them had a ceiling.
 */
describe('what the ranking weighs', () => {
  // A reader with a clear author and a clear set of favourite faces, both rated
  // well above their own average.
  const DIARY = [
    'Date,Name,Year,Letterboxd URI,Rating',
    ...Array.from({ length: 8 }, (_, i) => `2026-01-0${(i % 9) + 1},Auteur Film ${i},200${i},https://boxd.it/a${i},5`),
    ...Array.from({ length: 8 }, (_, i) => `2026-03-0${(i % 9) + 1},Ensemble Film ${i},200${i},https://boxd.it/e${i},5`),
    ...Array.from({ length: 30 }, (_, i) => `2026-02-01,Filler Film ${i},1999,https://boxd.it/f${i},2.5`),
  ].join('\n');

  /** Credits for the diary, keyed by the title the search resolved. */
  function creditsFor(name, id) {
    if (String(name).startsWith('Auteur')) {
      return {
        cast: [],
        crew: [
          { id: 7001, job: 'Director', name: 'The Auteur' },
          { id: 7002, job: 'Director of Photography', name: 'The Eye' },
          { id: 7003, job: 'Original Music Composer', name: 'The Ear' },
        ],
      };
    }
    if (String(name).startsWith('Ensemble')) {
      return {
        cast: [
          { id: 8001, name: 'Face One' }, { id: 8002, name: 'Face Two' },
          { id: 8003, name: 'Face Three' }, { id: 8004, name: 'Face Four' },
        ],
        crew: [{ id: 9999, job: 'Director', name: `Jobbing Director ${id}` }],
      };
    }
    return { cast: [], crew: [{ id: 6000 + id, job: 'Director', name: `Nobody ${id}` }] };
  }

  async function seedDiary() {
    let next = 5000;
    const byId = {};
    const { searchTitleOnTmdb } = require('../../movieService');
    searchTitleOnTmdb.mockImplementation(async (name) => {
      const id = ++next; byId[id] = name;
      return { itemId: `movie-${id}`, mediaType: 'movie', title: name, posterUrl: null };
    });
    fetchTitleWithCredits.mockImplementation(async (_type, id) => ({
      id,
      title: byId[id] || CANDIDATE_CREDITS[id]?.title || `Title ${id}`,
      runtime: 100, vote_average: 7, vote_count: 900, original_language: 'en',
      genres: [{ name: 'Drama' }], external_ids: { imdb_id: `tt${id}` },
      keywords: { keywords: [] }, release_dates: { results: [] },
      production_countries: [], production_companies: [],
      credits: CANDIDATE_CREDITS[id]?.credits || creditsFor(byId[id], id),
    }));
    await auth(request(app).post('/letterboxd/diary')).send({ files: [{ name: 'ratings.csv', text: DIARY }] });
    await auth(request(app).post('/analytics/resolve')).send({ limit: 200 });
  }

  /** Credits the candidates carry, keyed by TMDB id. */
  const CANDIDATE_CREDITS = {};

  test('one shared author outranks four shared faces', async () => {
    await seedDiary();

    // Identical to the catalog: same genre, language, decade and crowd score.
    CANDIDATE_CREDITS[910] = {
      title: 'By The Auteur',
      credits: { cast: [], crew: [{ id: 7001, job: 'Director', name: 'The Auteur' }] },
    };
    CANDIDATE_CREDITS[911] = {
      title: 'Four Familiar Faces',
      credits: {
        cast: [
          { id: 8001, name: 'Face One' }, { id: 8002, name: 'Face Two' },
          { id: 8003, name: 'Face Three' }, { id: 8004, name: 'Face Four' },
        ],
        crew: [{ id: 9998, job: 'Director', name: 'Nobody At All' }],
      },
    };
    await addCandidate({ id: 910, title: 'By The Auteur', genres: ['Drama'], year: 2015, imdb: '7.0' });
    await addCandidate({ id: 911, title: 'Four Familiar Faces', genres: ['Drama'], year: 2015, imdb: '7.0' });

    const res = await auth(request(app).get('/discovery?limit=10'));
    const titles = res.body.cards.map((c) => c.title);

    // A film has one director and a dozen billed actors. Counting them equally
    // is what let breadth of credits stand in for strength of match.
    expect(titles.indexOf('By The Auteur')).toBeLessThan(titles.indexOf('Four Familiar Faces'));
  });

  test('the cinematographer and the composer both lift a film', async () => {
    await seedDiary();

    CANDIDATE_CREDITS[920] = {
      title: 'Shot And Scored',
      credits: {
        cast: [],
        crew: [
          { id: 9997, job: 'Director', name: 'Nobody Here' },
          { id: 7002, job: 'Director of Photography', name: 'The Eye' },
          { id: 7003, job: 'Original Music Composer', name: 'The Ear' },
        ],
      },
    };
    CANDIDATE_CREDITS[921] = {
      title: 'Plain Drama',
      credits: { cast: [], crew: [{ id: 9996, job: 'Director', name: 'Nobody Else' }] },
    };
    await addCandidate({ id: 920, title: 'Shot And Scored', genres: ['Drama'], year: 2015, imdb: '7.0' });
    await addCandidate({ id: 921, title: 'Plain Drama', genres: ['Drama'], year: 2015, imdb: '7.0' });

    const res = await auth(request(app).get('/discovery?limit=10'));
    const titles = res.body.cards.map((c) => c.title);
    expect(titles.indexOf('Shot And Scored')).toBeLessThan(titles.indexOf('Plain Drama'));

    // And it says which, rather than falling back to "Drama".
    const lifted = res.body.cards.find((c) => c.title === 'Shot And Scored');
    const kinds = lifted.because.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(['cinematographer', 'composer']));
  });

  test('a cached film is scored on who made it even from outside the enrich window', async () => {
    await seedDiary();

    // Fifty candidates the catalog cannot tell apart, and one of them — the one
    // by the reader's author — deliberately last on the only signals tier 1 has.
    // The enrich budget is forty, so under the old shape nothing would ever have
    // looked at its credits: it was not in the top forty by genre, and the crew
    // lenses only ever saw the top forty.
    for (let i = 0; i < 50; i++) {
      await addCandidate({ id: 1000 + i, title: `Filler ${i}`, genres: ['Drama'], year: 2015, imdb: '7.9' });
    }
    CANDIDATE_CREDITS[1099] = {
      title: 'Buried Auteur',
      credits: { cast: [], crew: [{ id: 7001, job: 'Director', name: 'The Auteur' }] },
    };
    await addCandidate({ id: 1099, title: 'Buried Auteur', genres: ['Drama'], year: 2015, imdb: '5.5' });

    // Warm the details cache the way the analytics page or a detail sheet would.
    const { ensureAnalyticsDetails } = require('../../titleCache');
    await ensureAnalyticsDetails(db, 1099);
    fetchTitleWithCredits.mockClear();

    const res = await auth(request(app).get('/discovery?limit=10'));
    const card = res.body.cards.find((c) => c.title === 'Buried Auteur');

    // It surfaces at all, and for the right reason.
    expect(card).toBeDefined();
    expect(card.tier).toBe(2);
    expect(card.because.some((r) => r.kind === 'director' && r.value === 'The Auteur')).toBe(true);
    // And the TMDB budget was not spent on a film SQLite already described.
    expect(fetchTitleWithCredits).not.toHaveBeenCalledWith('movie', 1099);
  });

  test('a payload cached before crew was kept is refilled, not read as a blank', async () => {
    await seedDiary();

    CANDIDATE_CREDITS[950] = {
      title: 'Stale Row',
      credits: { cast: [], crew: [{ id: 7001, job: 'Director', name: 'The Auteur' }] },
    };
    await addCandidate({ id: 950, title: 'Stale Row', genres: ['Drama'], year: 2015, imdb: '7.0' });

    // A row from before crew and keywords were kept. It parses, and every lens
    // that matters reads as an empty array — so accepting it would score "never
    // looked this film up" as "shares nothing with you", permanently, because
    // nothing would go back for it.
    await new Promise((resolve, reject) => db.run(
      `INSERT INTO title_details_cache (media_type, tmdb_id, payload_json, fetched_at)
       VALUES ('movie', 950, ?, CURRENT_TIMESTAMP)`,
      [JSON.stringify({ id: 950, title: 'Stale Row', genres: ['Drama'], cast: [], directors: [] })],
      (e) => (e ? reject(e) : resolve())
    ));

    const res = await auth(request(app).get('/discovery?limit=10'));
    const card = res.body.cards.find((c) => c.title === 'Stale Row');

    // Refilled through the enrich path and scored on the director after all.
    expect(card.because.some((r) => r.kind === 'director' && r.value === 'The Auteur')).toBe(true);
  });

  test('the reason a card leads with is its strongest, not its longest', async () => {
    await seedDiary();

    CANDIDATE_CREDITS[940] = {
      title: 'Mixed Signals',
      credits: {
        cast: [{ id: 8001, name: 'Face One With A Very Long Name Indeed' }],
        crew: [{ id: 7001, job: 'Director', name: 'The Auteur' }],
      },
    };
    await addCandidate({ id: 940, title: 'Mixed Signals', genres: ['Drama'], year: 2015, imdb: '7.0' });

    const res = await auth(request(app).get('/discovery?limit=10'));
    const card = res.body.cards.find((c) => c.title === 'Mixed Signals');

    // Reasons used to be sorted by how long the label was, so the actor with
    // the longest name led over the director the reader has built a diary on.
    expect(card.because[0].kind).toBe('director');
  });
});
