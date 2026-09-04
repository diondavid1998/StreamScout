'use strict';

/**
 * Watchmode's quota is a lifetime figure, so the two behaviours worth pinning
 * are the ones that spend it: that a title is never asked about twice, and that
 * a refusal stops the asking rather than being retried per title.
 */

const { createTestDb, closeDb } = require('../testHelpers');
const {
  ensureWatchmodeTables,
  getWatchmodeDetails,
  normalizeWatchmode,
  resetBreaker,
  isRationed,
} = require('../../watchmode');

const DETAILS = {
  title: 'Heat',
  review_summary: 'Pros: outstanding performances; gripping action | Cons: lengthy runtime',
  will_you_like_this: "You'll like this if you enjoy intense crime dramas.",
};
const SOURCES = [
  { region: 'US', name: 'AppleTV',  type: 'rent', price: 4.99 },
  { region: 'US', name: 'Amazon',   type: 'rent', price: 3.99 },
  { region: 'US', name: 'AppleTV',  type: 'buy',  price: 4.99 },
  { region: 'US', name: 'YouTube TV', type: 'sub' },
  // Another region's rows must not leak into a US price.
  { region: 'GB', name: 'Sky',      type: 'rent', price: 0.99 },
];

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

let db;
beforeEach(async () => {
  db = await createTestDb();
  await ensureWatchmodeTables(db);
  resetBreaker();
  global.fetch = jest.fn();
});
afterEach(async () => { await closeDb(db); jest.restoreAllMocks(); });

describe('reading the response', () => {
  test('the summary is split into pros and cons rather than printed raw', () => {
    const out = normalizeWatchmode(DETAILS, SOURCES);
    expect(out.pros).toBe('outstanding performances; gripping action');
    expect(out.cons).toBe('lengthy runtime');
    expect(out.verdict).toMatch(/intense crime dramas/);
  });

  test('the price shown is the cheapest in the region, not the first row', () => {
    const out = normalizeWatchmode(DETAILS, SOURCES);
    // Amazon at 3.99 undercuts AppleTV at 4.99, and Sky's 0.99 is another country.
    expect(out.rent).toEqual({ price: 3.99, service: 'Amazon' });
    expect(out.buy).toEqual({ price: 4.99, service: 'AppleTV' });
    expect(out.streamingOn).toEqual(['YouTube TV']);
  });

  test('a title with nothing to say produces nulls, not empty strings', () => {
    const out = normalizeWatchmode({}, []);
    expect(out).toEqual({
      certificate: null, pros: null, cons: null, verdict: null,
      rent: null, buy: null, streamingOn: [],
    });
  });

  test('the US certificate is kept, and other countries are not', () => {
    const out = normalizeWatchmode(
      { ...DETAILS, us_rating: 'R', content_ratings: { US: 'R', GB: '15', DE: '16' } },
      SOURCES
    );
    expect(out.certificate).toBe('R');
    // This app is US-only; carrying thirty-seven countries would be bloat.
    expect(out.certificates).toBeUndefined();
  });

  test('the certificate map fills in when us_rating is missing', () => {
    // The gap this is here to close: TMDB has no US certificate for the film,
    // Watchmode does.
    const out = normalizeWatchmode({ ...DETAILS, content_ratings: { US: 'PG-13' } }, []);
    expect(out.certificate).toBe('PG-13');
  });
});

describe('spending the quota', () => {
  test('a title is fetched once and served from the database forever after', async () => {
    global.fetch.mockImplementation(async (url) =>
      ok(String(url).includes('/details/') ? DETAILS : SOURCES));

    const first = await getWatchmodeDetails(db, 'movie', 949, { apiKey: 'k' });
    expect(first.pros).toMatch(/outstanding performances/);
    // details + sources
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const second = await getWatchmodeDetails(db, 'movie', 949, { apiKey: 'k' });
    expect(second).toEqual(first);
    // Still two: the second open cost nothing.
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('a spent quota stops the asking instead of being retried per title', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 402, json: async () => ({}) });

    expect(await getWatchmodeDetails(db, 'movie', 1, { apiKey: 'k' })).toBeNull();
    expect(isRationed()).toBe(true);

    const callsAfterFirst = global.fetch.mock.calls.length;
    // Three more titles, none of which may reach the network.
    for (const id of [2, 3, 4]) {
      expect(await getWatchmodeDetails(db, 'movie', id, { apiKey: 'k' })).toBeNull();
    }
    expect(global.fetch).toHaveBeenCalledTimes(callsAfterFirst);
  });

  test('a refusal is never cached as an answer about the title', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    expect(await getWatchmodeDetails(db, 'movie', 550, { apiKey: 'k' })).toBeNull();

    // The breaker lifts, the service answers, and the title resolves properly —
    // it was not written off by the earlier refusal.
    resetBreaker();
    global.fetch.mockImplementation(async (url) =>
      ok(String(url).includes('/details/') ? DETAILS : SOURCES));
    const after = await getWatchmodeDetails(db, 'movie', 550, { apiKey: 'k' });
    expect(after.pros).toMatch(/outstanding performances/);
  });

  test('a title Watchmode has never heard of is remembered, not re-asked', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    const first = await getWatchmodeDetails(db, 'movie', 777, { apiKey: 'k' });
    expect(first).toEqual({
      certificate: null,
      pros: null, cons: null, verdict: null, rent: null, buy: null, streamingOn: [],
    });

    const callsAfterFirst = global.fetch.mock.calls.length;
    await getWatchmodeDetails(db, 'movie', 777, { apiKey: 'k' });
    expect(global.fetch).toHaveBeenCalledTimes(callsAfterFirst);
  });

  test('no key means no calls at all', async () => {
    expect(await getWatchmodeDetails(db, 'movie', 949, { apiKey: undefined })).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
