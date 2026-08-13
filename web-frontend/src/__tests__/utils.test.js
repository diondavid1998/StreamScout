/**
 * Unit tests for pure utility functions in utils.js
 * No React, no DOM rendering.
 */

import {
  parsePercent,
  ratingEntriesForItem,
  buildApiErrorMessage,
  getRottenTomatoesType,
} from '../utils';

// ── parsePercent ──────────────────────────────────────────────────────────────

describe('parsePercent', () => {
  it('extracts integer from percentage string', () => {
    expect(parsePercent('94%')).toBe(94);
    expect(parsePercent('0%')).toBe(0);
  });

  it('extracts the number from an x/10 rating', () => {
    expect(parsePercent('8.2/10')).toBe(8.2);
  });

  it('extracts the number from an x/100 rating', () => {
    expect(parsePercent('88/100')).toBe(88);
  });

  it('returns null for null / undefined / empty', () => {
    expect(parsePercent(null)).toBeNull();
    expect(parsePercent(undefined)).toBeNull();
    expect(parsePercent('')).toBeNull();
  });

  it('returns null for N/A', () => {
    expect(parsePercent('N/A')).toBeNull();
  });
});

// ── ratingEntriesForItem ──────────────────────────────────────────────────────

describe('ratingEntriesForItem', () => {
  it('returns all four ratings when all are present', () => {
    const item = {
      ratings: {
        tmdb: 7.8,
        imdb: '8.2/10',
        rottenTomatoes: '94%',
        metacritic: '88/100',
      },
    };
    const entries = ratingEntriesForItem(item);
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.key)).toEqual(['tmdb', 'imdb', 'rottenTomatoes', 'metacritic']);
  });

  it('formats TMDb rating to 1 decimal place', () => {
    const item = { ratings: { tmdb: 7.8234 } };
    const entry = ratingEntriesForItem(item).find((e) => e.key === 'tmdb');
    expect(entry.value).toBe('7.8');
  });

  it('filters out null ratings', () => {
    const item = { ratings: { tmdb: null, imdb: '8.0/10', rottenTomatoes: null, metacritic: null } };
    const entries = ratingEntriesForItem(item);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('imdb');
  });

  it('filters out empty string ratings', () => {
    const item = { ratings: { imdb: '', rottenTomatoes: '', metacritic: '' } };
    expect(ratingEntriesForItem(item)).toHaveLength(0);
  });

  it('filters out "N/A" strings', () => {
    const item = { ratings: { imdb: 'N/A', rottenTomatoes: 'N/A' } };
    expect(ratingEntriesForItem(item)).toHaveLength(0);
  });

  it('returns empty array when ratings object is absent', () => {
    expect(ratingEntriesForItem({})).toHaveLength(0);
    expect(ratingEntriesForItem(null)).toHaveLength(0);
  });
});

// ── buildApiErrorMessage ──────────────────────────────────────────────────────

describe('buildApiErrorMessage', () => {
  it('combines error and details when both are present', () => {
    const result = buildApiErrorMessage(
      { error: 'Not found', details: 'User id 42 does not exist' },
      'Unknown error'
    );
    expect(result).toBe('Not found: User id 42 does not exist');
  });

  it('returns error alone when details is absent', () => {
    const result = buildApiErrorMessage({ error: 'Unauthorized' }, 'Fallback');
    expect(result).toBe('Unauthorized');
  });

  it('returns fallback when data has no error field', () => {
    const result = buildApiErrorMessage({}, 'Something went wrong');
    expect(result).toBe('Something went wrong');
  });

  it('returns fallback for null data', () => {
    expect(buildApiErrorMessage(null, 'Fallback')).toBe('Fallback');
    expect(buildApiErrorMessage(undefined, 'Fallback')).toBe('Fallback');
  });
});

// ── getRottenTomatoesType ─────────────────────────────────────────────────────

describe('getRottenTomatoesType', () => {
  it('returns rotten for scores below 60', () => {
    expect(getRottenTomatoesType(59, 'movie')).toBe('rotten');
    expect(getRottenTomatoesType(0, 'movie')).toBe('rotten');
  });

  it('returns certified for movie scores >= 90', () => {
    expect(getRottenTomatoesType(90, 'movie')).toBe('certified');
    expect(getRottenTomatoesType(100, 'movie')).toBe('certified');
  });

  it('returns fresh-movie for movie scores 60–89', () => {
    expect(getRottenTomatoesType(60, 'movie')).toBe('fresh-movie');
    expect(getRottenTomatoesType(89, 'movie')).toBe('fresh-movie');
  });

  it('returns fresh-tv for TV shows regardless of score >= 60', () => {
    expect(getRottenTomatoesType(95, 'tv')).toBe('fresh-tv');
    expect(getRottenTomatoesType(60, 'tv')).toBe('fresh-tv');
  });

  it('returns null for null score', () => {
    expect(getRottenTomatoesType(null, 'movie')).toBeNull();
    expect(getRottenTomatoesType(undefined, 'movie')).toBeNull();
  });
});

// ── hide-watched client-side filter helper ────────────────────────────────────

/**
 * Simulates the filter applied in toggleWatched when hideWatched is true:
 * movies.filter(m => m.id !== itemId)
 */
function filterOutWatched(movies, watchedItemId) {
  return movies.filter((m) => m.id !== watchedItemId);
}

describe('filterOutWatched (hide-watched correctness)', () => {
  const catalog = [
    { id: 'movie-1', title: 'Alpha' },
    { id: 'movie-2', title: 'Beta' },
    { id: 'tv-3',    title: 'Gamma' },
  ];

  it('removes the newly-watched item from the catalog list', () => {
    const result = filterOutWatched(catalog, 'movie-1');
    expect(result).toHaveLength(2);
    expect(result.find((m) => m.id === 'movie-1')).toBeUndefined();
  });

  it('leaves other items untouched', () => {
    const result = filterOutWatched(catalog, 'movie-2');
    expect(result.map((m) => m.id)).toEqual(['movie-1', 'tv-3']);
  });

  it('returns the original array unchanged when itemId is not present', () => {
    const result = filterOutWatched(catalog, 'movie-999');
    expect(result).toHaveLength(3);
    expect(result).toEqual(catalog);
  });

  it('handles an empty catalog gracefully', () => {
    expect(filterOutWatched([], 'movie-1')).toEqual([]);
  });
});
