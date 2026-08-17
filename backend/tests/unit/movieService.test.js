'use strict';

/**
 * Unit tests for pure functions in movieService.js
 * No network calls, no database — all deterministic.
 */

process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || 'test-key';

const {
  buildRatingsPayload,
  toSortableRating,
  sortCatalog,
  fetchCatalogByPlatforms,
} = require('../../movieService');

describe('buildRatingsPayload', () => {
  it('returns null fields when OMDB data has no Ratings array', () => {
    const result = buildRatingsPayload({});
    expect(result.imdb).toBeNull();
    expect(result.rottenTomatoes).toBeNull();
    expect(result.metacritic).toBeNull();
    expect(result.letterboxd).toBeNull();
  });

  it('extracts IMDb rating from Ratings array', () => {
    const result = buildRatingsPayload({
      Ratings: [{ Source: 'Internet Movie Database', Value: '8.2/10' }],
    });
    expect(result.imdb).toBe('8.2/10');
    expect(result.rottenTomatoes).toBeNull();
    expect(result.metacritic).toBeNull();
  });

  it('extracts Rotten Tomatoes rating', () => {
    const result = buildRatingsPayload({
      Ratings: [{ Source: 'Rotten Tomatoes', Value: '94%' }],
    });
    expect(result.rottenTomatoes).toBe('94%');
  });

  it('extracts Metacritic rating', () => {
    const result = buildRatingsPayload({
      Ratings: [{ Source: 'Metacritic', Value: '88/100' }],
    });
    expect(result.metacritic).toBe('88/100');
  });

  it('extracts all three ratings together', () => {
    const result = buildRatingsPayload({
      Ratings: [
        { Source: 'Internet Movie Database', Value: '7.6/10' },
        { Source: 'Rotten Tomatoes', Value: '82%' },
        { Source: 'Metacritic', Value: '71/100' },
      ],
      imdbVotes: '1,234,567',
      imdbID: 'tt1234567',
    });
    expect(result.imdb).toBe('7.6/10');
    expect(result.rottenTomatoes).toBe('82%');
    expect(result.metacritic).toBe('71/100');
    expect(result.omdbVotes).toBe('1,234,567');
    expect(result.imdbId).toBe('tt1234567');
  });

  it('handles non-array Ratings gracefully', () => {
    const result = buildRatingsPayload({ Ratings: null });
    expect(result.imdb).toBeNull();
  });

  it('letterboxd is always null (not yet implemented)', () => {
    const result = buildRatingsPayload({ Ratings: [] });
    expect(result.letterboxd).toBeNull();
  });
});

describe('toSortableRating', () => {
  it('converts percentage string to number', () => {
    expect(toSortableRating('94%')).toBe(94);
    expect(toSortableRating('0%')).toBe(0);
    expect(toSortableRating('100%')).toBe(100);
  });

  it('converts x/10 string to number', () => {
    expect(toSortableRating('8.2/10')).toBe(8.2);
    expect(toSortableRating('10/10')).toBe(10);
  });

  it('converts x/100 string to number', () => {
    expect(toSortableRating('88/100')).toBe(88);
    expect(toSortableRating('71/100')).toBe(71);
  });

  it('returns null for null/undefined', () => {
    expect(toSortableRating(null)).toBeNull();
    expect(toSortableRating(undefined)).toBeNull();
  });

  it('returns null for non-string values', () => {
    expect(toSortableRating(42)).toBeNull();
  });

  it('returns null for unrecognized format', () => {
    expect(toSortableRating('N/A')).toBeNull();
    expect(toSortableRating('')).toBeNull();
  });
});

// ── sortCatalog ───────────────────────────────────────────────────────────────

function makeItem(overrides) {
  return {
    title: 'Test',
    releaseDate: null,
    popularity: 0,
    sortableRatings: { tmdb: null, imdb: null, rottenTomatoes: null, metacritic: null },
    ...overrides,
  };
}

describe('sortCatalog', () => {
  describe('release_date', () => {
    it('sorts newest first', () => {
      const items = [
        makeItem({ title: 'A', releaseDate: '2020-01-01' }),
        makeItem({ title: 'B', releaseDate: '2023-06-15' }),
        makeItem({ title: 'C', releaseDate: '2018-12-31' }),
      ];
      const sorted = sortCatalog(items, 'release_date');
      expect(sorted.map((i) => i.title)).toEqual(['B', 'A', 'C']);
    });

    it('places items with no date last', () => {
      const items = [
        makeItem({ title: 'No Date', releaseDate: null }),
        makeItem({ title: 'Has Date', releaseDate: '2021-05-01' }),
      ];
      const sorted = sortCatalog(items, 'release_date');
      expect(sorted[0].title).toBe('Has Date');
      expect(sorted[1].title).toBe('No Date');
    });
  });

  describe('fetchCatalogByPlatforms language discover union', () => {
    beforeEach(() => {
      global.fetch = jest.fn(async (url) => {
        const parsed = new URL(url);
        const path = parsed.pathname;
        const page = Number(parsed.searchParams.get('page') || 1);
        const language = parsed.searchParams.get('with_original_language');

        if (path === '/3/discover/movie') {
          let results = [];
          if (!language && page === 1) {
            results = [{ id: 1, title: 'English Hit', popularity: 100, vote_average: 8.0, vote_count: 1000, original_language: 'en' }];
          } else if (!language && page === 2) {
            results = [{ id: 2, title: 'Global Title', popularity: 95, vote_average: 7.5, vote_count: 900, original_language: 'ta' }];
          } else if (language === 'ta' && page === 1) {
            results = [
              { id: 3, title: 'Tamil Gem', popularity: 90, vote_average: 8.4, vote_count: 800, original_language: 'ta' },
              { id: 2, title: 'Global Title', popularity: 95, vote_average: 7.5, vote_count: 900, original_language: 'ta' },
            ];
          } else if (language === 'hi' && page === 1) {
            results = [{ id: 4, title: 'Hindi Gem', popularity: 85, vote_average: 8.1, vote_count: 700, original_language: 'hi' }];
          }

          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ results }),
          };
        }

        const detailsMatch = path.match(/^\/3\/movie\/(\d+)$/);
        if (detailsMatch) {
          const id = Number(detailsMatch[1]);
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                id,
                title: `Title ${id}`,
                release_date: '2024-01-01',
                vote_average: 7.0,
                vote_count: 500,
                overview: `Overview ${id}`,
                genres: [],
                external_ids: {},
                'watch/providers': {
                  results: {
                    US: {
                      flatrate: [{ provider_id: 8 }],
                    },
                  },
                },
              }),
          };
        }

        throw new Error(`Unhandled URL in test: ${url}`);
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
      delete global.fetch;
    });

    it('sends with_original_language for configured languages while keeping default discover pass', async () => {
      const result = await fetchCatalogByPlatforms(['netflix'], {
        mediaType: 'movie',
        sortBy: 'popularity',
        region: 'US',
        includeRatings: false,
        includeExternalIds: true,
        snapshotMode: true,
        pageCount: 2,
        languages: ['ta', 'hi'],
        restrictLanguages: true,
        languagePageCount: 1,
      });

      const discoverCalls = global.fetch.mock.calls
        .map(([url]) => new URL(url))
        .filter((url) => url.pathname === '/3/discover/movie');
      const languageValues = discoverCalls
        .map((url) => url.searchParams.get('with_original_language'))
        .filter(Boolean)
        .sort();
      const defaultPassCount = discoverCalls.filter((url) => !url.searchParams.get('with_original_language')).length;

      expect(defaultPassCount).toBe(2);
      expect(languageValues).toEqual(['hi', 'ta']);
      expect(result.items.map((item) => item.originalLanguage)).toEqual(
        expect.arrayContaining(['en', 'ta', 'hi'])
      );
    });
  });

  describe('tmdb', () => {
    it('sorts by tmdb rating descending', () => {
      const items = [
        makeItem({ title: 'Low', sortableRatings: { tmdb: 5.0 } }),
        makeItem({ title: 'High', sortableRatings: { tmdb: 9.2 } }),
        makeItem({ title: 'Mid', sortableRatings: { tmdb: 7.1 } }),
      ];
      const sorted = sortCatalog(items, 'tmdb');
      expect(sorted.map((i) => i.title)).toEqual(['High', 'Mid', 'Low']);
    });

    it('places null ratings last', () => {
      const items = [
        makeItem({ title: 'Null', sortableRatings: { tmdb: null } }),
        makeItem({ title: 'Rated', sortableRatings: { tmdb: 7.5 } }),
      ];
      const sorted = sortCatalog(items, 'tmdb');
      expect(sorted[0].title).toBe('Rated');
      expect(sorted[1].title).toBe('Null');
    });
  });

  describe('imdb', () => {
    it('sorts by imdb rating descending with null last', () => {
      const items = [
        makeItem({ title: 'B', sortableRatings: { imdb: 6.4 } }),
        makeItem({ title: 'A', sortableRatings: { imdb: 8.7 } }),
        makeItem({ title: 'C', sortableRatings: { imdb: null } }),
      ];
      const sorted = sortCatalog(items, 'imdb');
      expect(sorted.map((i) => i.title)).toEqual(['A', 'B', 'C']);
    });
  });

  describe('popularity (default)', () => {
    it('sorts by popularity descending', () => {
      const items = [
        makeItem({ title: 'A', popularity: 10 }),
        makeItem({ title: 'B', popularity: 50 }),
        makeItem({ title: 'C', popularity: 30 }),
      ];
      const sorted = sortCatalog(items, 'popularity');
      expect(sorted.map((i) => i.title)).toEqual(['B', 'C', 'A']);
    });

    it('defaults to popularity when sortBy is unrecognised', () => {
      const items = [
        makeItem({ title: 'A', popularity: 1 }),
        makeItem({ title: 'B', popularity: 99 }),
      ];
      const sorted = sortCatalog(items, 'unknown_key');
      expect(sorted[0].title).toBe('B');
    });
  });

  describe('title', () => {
    it('sorts alphabetically ascending', () => {
      const items = [
        makeItem({ title: 'Zorro' }),
        makeItem({ title: 'Ant-Man' }),
        makeItem({ title: 'Barbie' }),
      ];
      const sorted = sortCatalog(items, 'title');
      expect(sorted.map((i) => i.title)).toEqual(['Ant-Man', 'Barbie', 'Zorro']);
    });
  });

  it('returns a new array and does not mutate the input', () => {
    const items = [
      makeItem({ title: 'B', popularity: 1 }),
      makeItem({ title: 'A', popularity: 2 }),
    ];
    const original = [...items];
    sortCatalog(items, 'popularity');
    expect(items[0].title).toBe(original[0].title);
  });
});
