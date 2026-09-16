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

  it('throws rather than returning null when TMDB never answers', async () => {
    // Null is what callers cache as "no such film". An outage must not be
    // recorded as one, so a search that reached nothing has to say so.
    global.fetch.mockRejectedValue(new Error('network down'));

    await expect(searchTitleOnTmdb('Nobody Answered', 2012)).rejects.toThrow(/could not reach tmdb/i);
  });
});

describe('choosing between films that share a title', () => {
  const { resetTmdbBreaker } = require('../../movieService');

  beforeEach(() => {
    global.fetch = jest.fn();
    // The tests above deliberately make TMDB fail, which trips the breaker for
    // the module. Without this, every request here is refused before it is sent.
    resetTmdbBreaker();
  });
  afterEach(() => { delete global.fetch; });

  it('prefers the exact year over a more popular neighbour', async () => {
    // TMDB returns results by popularity, and the old rule took the first one
    // inside a ±1-year window. A one-word title that is also an ordinary word
    // is exactly where that goes wrong: the reader's 2023 film loses to a
    // better-known 2022 film of the same name, and every genre, director and
    // actor then counted from that row belongs to somebody else.
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          { media_type: 'movie', id: 111, title: 'Leo Alpha', release_date: '2022-08-01', poster_path: '/a.jpg' },
          { media_type: 'movie', id: 222, title: 'Leo Alpha', release_date: '2023-10-19', poster_path: '/b.jpg' },
        ],
      })
    );
    const result = await searchTitleOnTmdb('Leo Alpha', 2023);
    expect(result.itemId).toBe('movie-222');
  });

  it('prefers an exact title over a longer one that merely contains it', async () => {
    // titleMatches accepts whole-word substrings on purpose, so a short title
    // matches a longer one. Between the two, the exact title is the answer.
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          { media_type: 'movie', id: 333, title: 'Good Luck To You Leo Beta', release_date: '2023-01-01', poster_path: '/c.jpg' },
          { media_type: 'movie', id: 444, title: 'Leo Beta', release_date: '2023-06-01', poster_path: '/d.jpg' },
        ],
      })
    );
    const result = await searchTitleOnTmdb('Leo Beta', 2023);
    expect(result.itemId).toBe('movie-444');
  });

  it('still takes the most popular when nothing else separates them', async () => {
    // The ranking only reorders candidates the old code already accepted; where
    // title and year cannot decide, TMDB's own order stands.
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          { media_type: 'movie', id: 555, title: 'Leo Gamma', release_date: '2023-03-01', poster_path: '/e.jpg' },
          { media_type: 'movie', id: 666, title: 'Leo Gamma', release_date: '2023-09-01', poster_path: '/f.jpg' },
        ],
      })
    );
    const result = await searchTitleOnTmdb('Leo Gamma', 2023);
    expect(result.itemId).toBe('movie-555');
  });

  it('still accepts a neighbouring year when nothing lands on the exact one', async () => {
    // The window exists to absorb a year's disagreement between Letterboxd and
    // TMDB, and preferring the exact year must not close it.
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          { media_type: 'movie', id: 777, title: 'Leo Delta', release_date: '2024-02-01', poster_path: '/g.jpg' },
        ],
      })
    );
    const result = await searchTitleOnTmdb('Leo Delta', 2023);
    expect(result.itemId).toBe('movie-777');
  });

  // ── Rows with no year ───────────────────────────────────────────────────
  //
  // Letterboxd leaves Year blank for a film with no release date yet. Those
  // rows used to be dropped before the search ever ran, and the count the user
  // was shown had already been reduced — so a watchlist could lose a title with
  // nothing anywhere saying so.

  it('resolves a title that has no year, in a single request', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          { media_type: 'movie', id: 888, title: 'Leo Epsilon', release_date: '', poster_path: '/h.jpg' },
        ],
      })
    );
    const result = await searchTitleOnTmdb('Leo Epsilon', null);
    expect(result.itemId).toBe('movie-888');
    // One request, not four. With no year to check against every candidate is
    // in the window, so the multi search settles it and the year-scoped
    // fallbacks never run. Asserting the count is what pins that: the fallback
    // finds this film too, and would hide a broken window behind three extra
    // requests per row on an import of thousands.
    expect(requestedPaths()).toEqual(['/search/multi']);
  });

  it('never asks TMDB for a null release year', async () => {
    // The fallback is year-scoped. Without a year there is nothing to scope to,
    // and primary_release_year=null is a request that can only come back wrong.
    //
    // total_results above the page size is what forces the fallback to run at
    // all — an empty, complete page makes the search give up first, and this
    // test would then pass without a single year-scoped request being possible.
    global.fetch.mockResolvedValue(jsonResponse({ results: [], total_results: 40 }));
    await searchTitleOnTmdb('Leo Zeta', null);

    const paths = requestedPaths();
    expect(paths).toContain('/search/movie');
    expect(paths).toContain('/search/tv');
    const queries = global.fetch.mock.calls.map(([url]) => new URL(url).search);
    expect(queries.some((q) => /(primary_release_year|first_air_date_year)/.test(q))).toBe(false);
    // One unscoped search per media type, not three of each.
    expect(paths.filter((p) => p === '/search/movie')).toHaveLength(1);
  });

  it('still prefers an exact title when it has no year to rank on', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ results: [], total_results: 5 }));
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          { media_type: 'movie', id: 991, title: 'The Leo Eta Story', release_date: '2027-01-01', poster_path: '/i.jpg' },
          { media_type: 'movie', id: 992, title: 'Leo Eta', release_date: '2027-01-01', poster_path: '/j.jpg' },
        ],
      })
    );
    const result = await searchTitleOnTmdb('Leo Eta', null);
    expect(result.itemId).toBe('movie-992');
  });
});
/**
 * When the two sources spell the same film differently.
 *
 * TMDB is asked with the raw name, so it finds these on its own — its search
 * index folds accents and punctuation. What decided the outcome was our own
 * acceptance filter, and it used to normalise by keeping `[a-z0-9 ]` and
 * deleting everything else. Every case below is a film TMDB returned and the
 * import then reported as "not found".
 */
describe('titles the two sources spell differently', () => {
  const { resetTmdbBreaker } = require('../../movieService');

  beforeEach(() => {
    global.fetch = jest.fn();
    resetTmdbBreaker();
  });
  afterEach(() => { delete global.fetch; });

  it('matches an accented TMDB title to the plain spelling in an export', async () => {
    // The accent used to be deleted rather than folded, so TMDB's title
    // normalised to `rashmon delta` — which the export's spelling can never
    // equal, however it is written.
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          { media_type: 'movie', id: 771, title: 'Rashōmon Delta', release_date: '1950-08-25', poster_path: '/r.jpg' },
        ],
      })
    );

    const result = await searchTitleOnTmdb('Rashomon Delta', 1950);

    expect(result).toMatchObject({ itemId: 'movie-771', title: 'Rashōmon Delta' });
  });

  it('asks TMDB about a title written in a non-Latin script', async () => {
    // This is the sharpest case: the name normalised to the empty string, and
    // the search gives up on an empty name — so the row came back "not found"
    // without a single request being sent. The request count is the assertion.
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          { media_type: 'movie', id: 882, title: '千と千尋の神隠し', release_date: '2001-07-20', poster_path: '/s.jpg' },
        ],
      })
    );

    const result = await searchTitleOnTmdb('千と千尋の神隠し', 2001);

    expect(requestedPaths().length).toBeGreaterThan(0);
    expect(result).toMatchObject({ itemId: 'movie-882' });
  });

  it('matches across a hyphen the export wrote as a space', async () => {
    // Punctuation was deleted rather than separating the words around it, so
    // "Spider-Man" collapsed to one word and stopped matching two.
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          { media_type: 'movie', id: 993, title: 'Spider-Man Epsilon', release_date: '2021-12-15', poster_path: '/t.jpg' },
        ],
      })
    );

    const result = await searchTitleOnTmdb('Spider Man Epsilon', 2021);

    expect(result).toMatchObject({ itemId: 'movie-993' });
  });

  it('still refuses an unrelated title that merely shares a short word', async () => {
    // The looser normalisation must not loosen what counts as a match: a
    // one-word name that is also an ordinary word still has to be rejected,
    // or a row resolves to somebody else's film and every lens counts it.
    global.fetch.mockResolvedValueOnce(jsonResponse({ results: [], total_results: 0 }));
    global.fetch.mockResolvedValue(
      jsonResponse({
        results: [
          { media_type: 'movie', id: 404, title: 'Interstellar Zeta', release_date: '2014-11-05', poster_path: '/u.jpg' },
        ],
      })
    );

    const result = await searchTitleOnTmdb('Ité', 2014);

    expect(result).toBeNull();
  });
});
