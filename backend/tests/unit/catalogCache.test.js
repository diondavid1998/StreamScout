'use strict';

/**
 * Unit tests for pure utility functions in catalogCache.js
 */

const { createTestDb, closeDb } = require('../testHelpers');
const { buildScopeKey, mapWithConcurrency, isRateLimitError, readCachedCatalog } = require('../../catalogCache');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

describe('buildScopeKey', () => {
  it('builds a deterministic key from platforms and region', () => {
    const key = buildScopeKey(['netflix', 'hulu'], 'US');
    expect(key).toBe('region:US|platforms:hulu,netflix|languages:');
  });

  it('sorts platforms so order does not matter', () => {
    const a = buildScopeKey(['hulu', 'netflix'], 'US');
    const b = buildScopeKey(['netflix', 'hulu'], 'US');
    expect(a).toBe(b);
  });

  it('deduplicates platforms', () => {
    const key = buildScopeKey(['netflix', 'netflix', 'hulu'], 'US');
    expect(key).toBe('region:US|platforms:hulu,netflix|languages:');
  });

  it('includes region in the key', () => {
    const us = buildScopeKey(['netflix'], 'US');
    const gb = buildScopeKey(['netflix'], 'GB');
    expect(us).not.toBe(gb);
    expect(us).toContain('region:US');
    expect(gb).toContain('region:GB');
  });

  it('defaults region to US when not supplied', () => {
    const key = buildScopeKey(['netflix']);
    expect(key).toContain('region:US');
  });

  it('includes languages in the key', () => {
    const key = buildScopeKey(['netflix'], 'US', ['ta', 'hi']);
    expect(key).toBe('region:US|platforms:netflix|languages:hi,ta');
  });

  it('sorts languages so order does not matter', () => {
    const a = buildScopeKey(['netflix'], 'US', ['ta', 'hi']);
    const b = buildScopeKey(['netflix'], 'US', ['hi', 'ta']);
    expect(a).toBe(b);
  });

  it('deduplicates languages', () => {
    const key = buildScopeKey(['netflix'], 'US', ['ta', 'hi', 'ta']);
    expect(key).toBe('region:US|platforms:netflix|languages:hi,ta');
  });
});

describe('mapWithConcurrency', () => {
  it('maps all items and returns results in order', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (x) => x * 2);
    expect(results).toEqual([2, 4, 6]);
  });

  it('runs with concurrency 1 (serial)', async () => {
    const order = [];
    await mapWithConcurrency([1, 2, 3], 1, async (x) => {
      order.push(x);
      return x;
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it('handles empty array', async () => {
    const results = await mapWithConcurrency([], 4, async (x) => x);
    expect(results).toEqual([]);
  });

  it('respects concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (x) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return x;
    });
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});

describe('isRateLimitError', () => {
  it('returns true for "too many requests" message', () => {
    expect(isRateLimitError(new Error('Too many requests'))).toBe(true);
  });

  it('returns true for "rate limit" message (case-insensitive)', () => {
    expect(isRateLimitError(new Error('Rate Limit exceeded'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isRateLimitError(new Error('Network timeout'))).toBe(false);
    expect(isRateLimitError(new Error('Not found'))).toBe(false);
  });

  it('handles non-Error objects gracefully', () => {
    expect(isRateLimitError('rate limit')).toBe(true);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});

describe('readCachedCatalog language filters', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await closeDb(db);
  });

  it('returns Tamil/Hindi rows when those language filters are applied', async () => {
    const scopeKey = buildScopeKey(['netflix'], 'US', ['ta', 'hi']);
    const now = new Date().toISOString();

    await run(
      db,
      `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, original_language, popularity, imdb_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [scopeKey, 'movie', 101, 'Tamil Title', 'ta', 10, 'tt0000101', now]
    );
    await run(
      db,
      `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, original_language, popularity, imdb_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [scopeKey, 'movie', 102, 'Hindi Title', 'hi', 9, 'tt0000102', now]
    );
    await run(
      db,
      `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, original_language, popularity, imdb_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [scopeKey, 'movie', 103, 'English Title', 'en', 11, 'tt0000103', now]
    );

    const result = await readCachedCatalog(db, {
      scopeKey,
      languageFilters: ['ta', 'hi'],
      page: 1,
      pageSize: 24,
    });

    expect(result.items.map((item) => item.title).sort()).toEqual(['Hindi Title', 'Tamil Title']);
  });
});
