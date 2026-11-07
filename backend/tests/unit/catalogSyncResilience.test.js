'use strict';

/**
 * The catalog sweep: how deep it goes, what it says about each title, and what
 * it does when TMDB refuses part of it.
 *
 * It used to be one popularity-ranked sweep across the union of every service,
 * 25 pages per media type — at most 500 films and 500 shows, shared between all
 * of them — plus a details request per title to find out where each one was
 * streaming. Adding a service split the same slots further; picking VOD, whose
 * rental stores carry nearly every film, turned them into the most popular
 * films anywhere, which a regular watcher has mostly seen. With Hide Watched on,
 * a dozen services came down to a few dozen titles.
 *
 * Each service is now swept on its own, and a title one service's sweep
 * returns is known to be on that service without asking TMDB again.
 */

process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || 'test-key';

const { fetchCatalogByPlatforms, resetTmdbBreaker, clearApiCaches } = require('../../movieService');

/**
 * A fake TMDB. `library[providerId]` is that provider's titles, most popular
 * first; `refuse(call)` decides which discover requests fail.
 */
function installTmdb({ library, refuse = () => false }) {
  const calls = [];
  global.fetch = jest.fn(async (url) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/3/, '');
    const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    if (path === '/discover/movie' || path === '/discover/tv') {
      const call = {
        type: path.endsWith('movie') ? 'movie' : 'tv',
        providers: parsed.searchParams.get('with_watch_providers').split('|').map(Number),
        monetization: parsed.searchParams.get('with_watch_monetization_types'),
        page: Number(parsed.searchParams.get('page')),
      };
      calls.push(call);
      if (refuse(call)) {
        const err = new Error('TMDB request failed: 429 Too Many Requests');
        err.status = 429;
        throw err;
      }
      const pool = call.type === 'tv' ? [] : call.providers.flatMap((id) => library[id] || []);
      return json({
        page: call.page,
        total_pages: Math.max(1, Math.ceil(pool.length / 20)),
        results: pool.slice((call.page - 1) * 20, call.page * 20).map((n) => ({
          id: n, title: `Film ${n}`, release_date: '2020-01-01', popularity: 100000 - n,
          vote_average: 7, vote_count: 500, original_language: 'en', genre_ids: [18, 99999],
        })),
      });
    }
    calls.push({ detail: path });
    return json({});
  });
  return calls;
}

const range = (from, n) => Array.from({ length: n }, (_, i) => from + i);
const NETFLIX = 8, HULU = 15, APPLE_TV = 2, AMAZON = 10;

const sweep = (platforms, extra = {}) => fetchCatalogByPlatforms(platforms, {
  mediaType: 'movie', region: 'US', ...extra,
});

describe('how deep the catalog goes', () => {
  beforeEach(() => { resetTmdbBreaker(); clearApiCaches(); });
  afterEach(() => { delete global.fetch; resetTmdbBreaker(); clearApiCaches(); });

  test('goes past the old 500-title ceiling', async () => {
    installTmdb({ library: { [NETFLIX]: range(1, 2000) } });
    const { items } = await sweep(['netflix']);
    // Thirty pages of twenty.
    expect(items).toHaveLength(600);
  });

  test('each service adds its own depth rather than splitting a shared one', async () => {
    // The union sweep ranked both libraries together and kept the top slice,
    // so the second service cost the first one half its titles.
    installTmdb({ library: { [NETFLIX]: range(1, 2000), [HULU]: range(5001, 2000) } });
    const { items } = await sweep(['netflix', 'hulu']);
    expect(items).toHaveLength(1200);
    expect(items.filter((i) => i.availableOnKeys.includes('hulu'))).toHaveLength(600);
  });

  test('stops at the end of a small service instead of asking for empty pages', async () => {
    const calls = installTmdb({ library: { [NETFLIX]: range(1, 45) } });
    const { items } = await sweep(['netflix']);
    expect(items).toHaveLength(45);
    expect(calls.filter((c) => c.type === 'movie')).toHaveLength(3);
  });

  test('asks TMDB nothing per title', async () => {
    // The details request per title was the whole cost of the old sweep, and
    // the reason it stopped at a thousand.
    const calls = installTmdb({ library: { [NETFLIX]: range(1, 200) } });
    await sweep(['netflix']);
    expect(calls.filter((c) => c.detail)).toEqual([]);
  });
});

describe('what the sweep says about each title', () => {
  beforeEach(() => { resetTmdbBreaker(); clearApiCaches(); });
  afterEach(() => { delete global.fetch; resetTmdbBreaker(); clearApiCaches(); });

  test('a title found by two services lists both, and no others', async () => {
    installTmdb({ library: { [NETFLIX]: [1, 2], [HULU]: [2, 3] } });
    const { items } = await sweep(['netflix', 'hulu']);
    const on = Object.fromEntries(items.map((i) => [i.title, i.availableOn]));
    expect(on).toEqual({ 'Film 1': ['Netflix'], 'Film 2': ['Netflix', 'Hulu'], 'Film 3': ['Hulu'] });
  });

  test('a rental names the store, rent only, under the VOD key', async () => {
    const calls = installTmdb({ library: { [APPLE_TV]: [7], [AMAZON]: [7, 8] } });
    const { items } = await sweep(['vod']);
    const seven = items.find((i) => i.title === 'Film 7');
    expect(seven.availableOn).toEqual([]);
    expect(seven.availableOnKeys).toEqual(['vod']);
    expect(seven.purchaseOn).toEqual([
      { name: 'Apple TV', tiers: ['rent'] }, { name: 'Amazon Video', tiers: ['rent'] },
    ]);
    // Swept for rentals and nothing else, one store at a time.
    expect(new Set(calls.map((c) => c.monetization))).toEqual(new Set(['rent']));
    expect(calls.every((c) => c.providers.length === 1)).toBe(true);
  });

  test('never sweeps Fandango', async () => {
    const calls = installTmdb({ library: {} });
    await sweep(['vod']);
    expect(calls.some((c) => c.providers.includes(7))).toBe(false);
  });

  test('subscriptions are swept on subscription tiers, not rentals', async () => {
    const calls = installTmdb({ library: { [NETFLIX]: [1] } });
    await sweep(['netflix']);
    expect(calls.map((c) => c.monetization)).toEqual(['flatrate|free|ads']);
  });

  test('genres are named from their ids, and an unknown id is dropped', async () => {
    installTmdb({ library: { [NETFLIX]: [1] } });
    const { items: [film] } = await sweep(['netflix']);
    expect(film.genres).toEqual(['Drama']);
  });
});

describe('a sweep that TMDB partly refuses', () => {
  beforeEach(() => { resetTmdbBreaker(); clearApiCaches(); });
  afterEach(() => { delete global.fetch; resetTmdbBreaker(); clearApiCaches(); });

  test('a refused later page costs its own titles, not the sweep', async () => {
    installTmdb({
      library: { [NETFLIX]: range(1, 200) },
      refuse: (c) => c.page === 4,
    });
    const { items, meta } = await sweep(['netflix']);
    expect(items).toHaveLength(180);
    expect(meta.discoverFailures).toBe(1);
  });

  test('a service whose first page is refused abandons the sweep', async () => {
    // Persisting without it would not just miss Netflix this time: a sync
    // removes every row it did not see, so the catalog would lose every Netflix
    // title the last sweep found.
    installTmdb({
      library: { [NETFLIX]: range(1, 200), [HULU]: range(5001, 200) },
      refuse: (c) => c.providers.includes(NETFLIX) && c.page === 1,
    });
    await expect(sweep(['netflix', 'hulu'])).rejects.toThrow(/stopped answering/i);
  });

  test('most pages refused is an outage, and is not persisted', async () => {
    installTmdb({
      library: { [NETFLIX]: range(1, 600) },
      refuse: (c) => c.page > 4,
    });
    await expect(sweep(['netflix'])).rejects.toThrow(/stopped answering/i);
  });

  test('a refused language pass costs that language, not the sweep', async () => {
    // The general pass is what keeps a service in the catalog; a language pass
    // only adds the films too obscure for the general ranking.
    installTmdb({ library: { [NETFLIX]: range(1, 40) }, refuse: () => false });
    const original = global.fetch;
    global.fetch = jest.fn(async (url) => {
      if (new URL(url).searchParams.get('with_original_language')) {
        const err = new Error('TMDB request failed: 429'); err.status = 429; throw err;
      }
      return original(url);
    });
    const { items } = await sweep(['netflix'], { languages: ['ta'], restrictLanguages: true });
    expect(items).toHaveLength(40);
  });
});
