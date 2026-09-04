'use strict';

/**
 * The TMDB breaker. What matters is not that it opens, but *what* opens it: a
 * 404 is TMDB answering and must never count, or one unfindable film would take
 * the service down for everybody else's.
 */

process.env.TMDB_API_KEY = 'test-key';

const {
  searchTitleOnTmdb,
  isTmdbUnavailable,
  resetTmdbBreaker,
  isTmdbRefusal,
} = require('../../movieService');

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  resetTmdbBreaker();
  global.fetch = jest.fn();
});
afterEach(() => { jest.restoreAllMocks(); resetTmdbBreaker(); });

describe('telling a refusal from an answer', () => {
  test('a refusal is a 429, a 5xx, or a request that never completed', () => {
    expect(isTmdbRefusal({ status: 429 })).toBe(true);
    expect(isTmdbRefusal({ status: 500 })).toBe(true);
    expect(isTmdbRefusal({ status: 503 })).toBe(true);
    expect(isTmdbRefusal(new Error('socket hang up'))).toBe(true);
  });

  test('a 404 is an answer, and a bad key is not something waiting fixes', () => {
    // A missing title must never contribute to an outage, or one unfindable
    // film in a batch would stop the lookup for every film after it.
    expect(isTmdbRefusal({ status: 404 })).toBe(false);
    // 401/403 is a misconfigured key. Muffling it for a minute at a time would
    // hide the one failure an operator actually has to act on.
    expect(isTmdbRefusal({ status: 401 })).toBe(false);
    expect(isTmdbRefusal({ status: 403 })).toBe(false);
  });
});

describe('opening and closing', () => {
  test('one failure does not open it, because the fallback recovers from those', async () => {
    global.fetch
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(jsonResponse({
        results: [{ id: 61, title: 'Recovered', release_date: '2018-03-03' }],
      }));

    const result = await searchTitleOnTmdb('Recovered', 2018);
    expect(result).toMatchObject({ itemId: 'movie-61' });
    expect(isTmdbUnavailable()).toBe(false);
  });

  test('a run of refusals opens it, and then costs nothing to hit', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));

    // One search makes several attempts, so this is comfortably past the
    // threshold and leaves the breaker open.
    await expect(searchTitleOnTmdb('Nothing Answers', 2000)).rejects.toThrow();
    expect(isTmdbUnavailable()).toBe(true);

    const callsWhileDown = global.fetch.mock.calls.length;
    await expect(searchTitleOnTmdb('Another Film', 2001)).rejects.toThrow();
    // The second search reached the network zero times.
    expect(global.fetch).toHaveBeenCalledTimes(callsWhileDown);
  });

  test('a success part-way through a bad run clears the count', async () => {
    // One search makes up to seven requests, so the pattern has to keep an
    // answer inside every window of three: fail, fail, answer, repeating. It
    // never reaches three refusals in a row and so never opens.
    let call = 0;
    global.fetch.mockImplementation(async () => {
      call += 1;
      if (call % 3 === 0) return jsonResponse({ results: [] });
      throw new Error('blip');
    });

    await searchTitleOnTmdb('Patchy Signal', 1999).catch(() => {});
    expect(isTmdbUnavailable()).toBe(false);
  });
});
