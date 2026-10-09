'use strict';

/**
 * What a catalog sweep does when TMDB refuses part of it.
 *
 * Selecting a service rebuilds its catalog from nothing — the scope key carries
 * the platform list, so a new tick is a cold scope and a ~1,000-request sweep.
 * Every one of those requests can be refused, and the sweep used to be
 * all-or-nothing: `Promise.all` over the discover pages and an unguarded mapper
 * over the details, so one 429 out of a thousand threw away the nine hundred and
 * ninety-nine titles that had arrived. Nothing was written, so no state row
 * existed, so the scope stayed cold and the next request restarted the whole
 * sweep — and three refusals in a row opened the breaker, which failed every
 * remaining call and made the next attempt fail before it sent anything.
 *
 * What the user saw was an empty grid with no spinner and no error: a service
 * that looked like it had nothing on it.
 */

process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || 'test-key';

const { fetchCatalogByPlatforms, resetTmdbBreaker, clearApiCaches } = require('../../movieService');

/** A fake TMDB holding `count` films, where `failDetail(id)` decides refusals. */
function installTmdb({ count, failDetail = () => false, failDiscoverPage = () => false }) {
  const ids = Array.from({ length: count }, (_, i) => 100 + i);
  const calls = { discover: 0, detail: 0 };

  global.fetch = jest.fn(async (url) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const page = Number(parsed.searchParams.get('page') || 1);
    const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

    if (path === '/3/discover/movie') {
      calls.discover += 1;
      if (failDiscoverPage(page)) {
        const err = new Error('TMDB request failed: 429 Too Many Requests');
        err.status = 429;
        throw err;
      }
      if (page !== 1) return json({ results: [] });
      return json({
        results: ids.map((id) => ({
          id, title: `Film ${id}`, popularity: 100 - (id - 100),
          vote_average: 7, vote_count: 500, original_language: 'en',
        })),
      });
    }
    if (path === '/3/discover/tv') { calls.discover += 1; return json({ results: [] }); }

    const detail = path.match(/^\/3\/movie\/(\d+)$/);
    if (detail) {
      calls.detail += 1;
      const id = Number(detail[1]);
      if (failDetail(id, calls.detail)) {
        const err = new Error('TMDB request failed: 429 Too Many Requests');
        err.status = 429;
        throw err;
      }
      return json({
        id, title: `Film ${id}`, release_date: '2024-01-01', vote_average: 7,
        vote_count: 500, overview: '', genres: [], external_ids: {},
        'watch/providers': { results: { US: { flatrate: [{ provider_id: 8 }] } } },
      });
    }
    return json({});
  });

  return { ids, calls };
}

const sweep = () => fetchCatalogByPlatforms(['netflix', 'vod'], {
  mediaType: 'movie', limit: 1000, pageCount: 3, snapshotMode: true,
  includeRatings: false, region: 'US',
});

describe('a catalog sweep that TMDB partly refuses', () => {
  // The TMDB response cache is module-level and keyed by URL, and every case
  // here issues the same discover URL — without this the second case is served
  // the first case's fixture and no refusal ever reaches the code under test.
  beforeEach(() => { resetTmdbBreaker(); clearApiCaches(); jest.restoreAllMocks(); });
  afterEach(() => { delete global.fetch; resetTmdbBreaker(); clearApiCaches(); });

  test('keeps the titles that arrived when a few are refused', async () => {
    // Four refusals out of twenty. The old code returned nothing at all.
    installTmdb({ count: 20, failDetail: (id) => [101, 105, 109, 113].includes(id) });

    const { items, meta } = await sweep();

    expect(items).toHaveLength(16);
    expect(meta.enrichFailures).toBe(4);
    // And the ones that came back are whole, not husks standing in for a failure.
    expect(items.every((i) => i.title && i.availableOn.length)).toBe(true);
  });

  test('refuses to persist a sweep that mostly failed', async () => {
    // What the breaker opening mid-sweep looks like: everything after a point
    // fails. Writing this down would freeze a sixth of the catalog in place as
    // though it were the whole of it, because a scope written once is no longer
    // cold and never syncs again.
    installTmdb({ count: 30, failDetail: (id, nth) => nth > 5 });

    await expect(sweep()).rejects.toThrow(/stopped answering/i);
  });

  test('the abandonment threshold is a majority, not any failure at all', async () => {
    // 11 of 20 through: over half, so it is a thin sweep rather than an outage,
    // and a thin sweep is worth keeping.
    installTmdb({ count: 20, failDetail: (id, nth) => nth > 11 });

    const { items } = await sweep();
    expect(items).toHaveLength(11);
  });

  test('a refused discover page costs its own titles, not the sweep', async () => {
    // Page 1 of movies carries every film here; the tv sweep and the empty
    // pages are what page 2 stands for. Losing one must not lose the rest.
    const { calls } = installTmdb({ count: 12, failDiscoverPage: (page) => page === 2 });

    const { items, meta } = await sweep();

    expect(calls.discover).toBeGreaterThan(1);
    expect(items).toHaveLength(12);
    expect(meta.discoverFailures).toBeGreaterThan(0);
  });

  test('every discover page failing is an outage, and says so', async () => {
    // No titles because TMDB would not list any is a different fact from no
    // titles because the service carries none, and the sweep must not flatten
    // the first into the second — an empty catalog would be persisted as truth.
    installTmdb({ count: 12, failDiscoverPage: () => true });

    await expect(sweep()).rejects.toThrow(/429/);
  });
});
