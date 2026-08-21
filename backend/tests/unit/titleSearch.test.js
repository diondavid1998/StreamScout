'use strict';

/**
 * How many TMDB requests it takes to resolve one Letterboxd row.
 *
 * The old implementation issued a year-scoped search per media type per
 * candidate year: one request in the luckiest case, six for anything it went on
 * to report as not found. On a large import the misses dominate. These pin the
 * request count for each outcome.
 */

process.env.TMDB_API_KEY = 'test-key';

const { searchTitleOnTmdb } = require('../../movieService');

function jsonResponse(body) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}

function requestedPaths() {
  return global.fetch.mock.calls.map(([url]) => new URL(url).pathname.replace(/^\/3/, ''));
}

describe('searchTitleOnTmdb', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    // fetchTmdb memoises by full URL, so every test needs its own title.
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('resolves a film in a single request', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          { media_type: 'movie', id: 949, title: 'Heat Signature One', release_date: '1995-12-15', poster_path: '/p.jpg' },
        ],
      })
    );

    const result = await searchTitleOnTmdb('Heat Signature One', 1995);

    expect(result).toEqual({
      itemId: 'movie-949',
      title: 'Heat Signature One',
      posterUrl: 'https://image.tmdb.org/t/p/w500/p.jpg',
      mediaType: 'movie',
    });
    expect(requestedPaths()).toEqual(['/search/multi']);
  });

  it('accepts a release year one off from the CSV, still in one request', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [{ media_type: 'movie', id: 12, title: 'Offset By One', release_date: '1994-01-01' }],
      })
    );

    const result = await searchTitleOnTmdb('Offset By One', 1995);

    expect(result.itemId).toBe('movie-12');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('prefers a film over a series when both match', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          { media_type: 'tv', id: 7, name: 'Both Forms Exist', first_air_date: '2015-04-02' },
          { media_type: 'movie', id: 8, title: 'Both Forms Exist', release_date: '2015-09-01' },
        ],
      })
    );

    const result = await searchTitleOnTmdb('Both Forms Exist', 2015);

    expect(result).toMatchObject({ itemId: 'movie-8', mediaType: 'movie' });
  });

  it('finds a series that the multi search returns', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [{ media_type: 'tv', id: 33, name: 'Series Only Title', first_air_date: '2019-06-01' }],
      })
    );

    const result = await searchTitleOnTmdb('Series Only Title', 2019);

    expect(result).toMatchObject({ itemId: 'tv-33', mediaType: 'tv' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores a person result carrying the same name', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          { media_type: 'person', id: 500, name: 'Ambiguous Person Name' },
          { media_type: 'movie', id: 501, title: 'Ambiguous Person Name', release_date: '2001-01-01' },
        ],
      })
    );

    const result = await searchTitleOnTmdb('Ambiguous Person Name', 2001);

    expect(result.itemId).toBe('movie-501');
  });

  it('falls back to a year-scoped search when the name matched but the year did not', async () => {
    // Re-releases and restorations: TMDB's primary release year disagrees with
    // the one Letterboxd recorded, by more than the ±1 window allows.
    global.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          total_results: 1,
          results: [{ media_type: 'movie', id: 5, title: 'Year Disagreement', release_date: '1954-01-01' }],
        })
      )
      .mockResolvedValue(
        jsonResponse({ results: [{ id: 77, title: 'Year Disagreement', release_date: '2011-01-01' }] })
      );

    const result = await searchTitleOnTmdb('Year Disagreement', 2011);

    expect(result).toMatchObject({ itemId: 'movie-77', mediaType: 'movie' });
    expect(requestedPaths()).toEqual(['/search/multi', '/search/movie']);
  });

  it('falls back when the first page of results was full, in case the match was cut off', async () => {
    global.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          total_results: 240,
          results: [{ media_type: 'movie', id: 1, title: 'Unrelated Top Hit', release_date: '2010-01-01' }],
        })
      )
      .mockResolvedValue(
        jsonResponse({ results: [{ id: 90, title: 'Buried Common Word', release_date: '2010-05-05' }] })
      );

    const result = await searchTitleOnTmdb('Buried Common Word', 2010);

    expect(result).toMatchObject({ itemId: 'movie-90' });
    expect(requestedPaths()).toEqual(['/search/multi', '/search/movie']);
  });

  it('gives up after one request when a complete page holds nothing by that name', async () => {
    // The most common expensive case in a large import. It used to cost six
    // requests to establish, one year-scoped search at a time.
    global.fetch.mockResolvedValue(
      jsonResponse({
        total_results: 1,
        results: [{ media_type: 'movie', id: 1, title: 'Something Else Entirely', release_date: '2010-01-01' }],
      })
    );

    const result = await searchTitleOnTmdb('Distinct Unfindable Name', 2010);

    expect(result).toBeNull();
    expect(requestedPaths()).toEqual(['/search/multi']);
  });

  it('still tries the year-scoped searches when the multi request itself fails', async () => {
    global.fetch
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(
        jsonResponse({ results: [{ id: 61, title: 'Recovered After Error', release_date: '2018-03-03' }] })
      );

    const result = await searchTitleOnTmdb('Recovered After Error', 2018);

    expect(result).toMatchObject({ itemId: 'movie-61' });
    expect(requestedPaths()).toEqual(['/search/multi', '/search/movie']);
  });
});
