'use strict';

/**
 * Clearing the misses the old title matcher remembered.
 *
 * A null in `title_lookup_cache` means "TMDB has nothing under this name", and
 * the import trusts it for a fortnight rather than searching again. Every null
 * written before the matcher was fixed may instead be a film TMDB did return
 * and the old normaliser refused — an accent it deleted rather than folded, or
 * a title in a script it reduced to the empty string. Left in place they would
 * make the fix look like it had not worked, because a re-import would replay
 * the stored miss instead of re-running the search.
 */

const { purgeNegativeLookups } = require('../../lists');
const { createTestDb, closeDb } = require('../testHelpers');

describe('purging remembered misses', () => {
  let db;
  const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, (e) => (e ? rej(e) : res())));
  const all = (sql) => new Promise((res, rej) => db.all(sql, [], (e, r) => (e ? rej(e) : res(r || []))));

  const remember = (key, itemId) => run(
    `INSERT INTO title_lookup_cache (lookup_key, item_id, media_type, title, poster_url, resolved_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [key, itemId, itemId ? 'movie' : null, itemId ? 'A Film' : null, new Date().toISOString()]
  );

  beforeEach(async () => { db = await createTestDb(); });
  afterEach(() => closeDb(db));

  test('drops the misses and keeps the answers', async () => {
    await remember('rashomon|1950', null);
    await remember('amelie|2001', null);
    await remember('dune|2021', 'movie-438631');

    expect(await purgeNegativeLookups(db)).toEqual({ purged: 2 });

    const rows = await all('SELECT lookup_key, item_id FROM title_lookup_cache');
    // A row that resolved is an answer, still correct, and worth more than the
    // request it would cost to fetch again.
    expect(rows).toEqual([{ lookup_key: 'dune|2021', item_id: 'movie-438631' }]);
  });

  test('runs once, and reports nothing to do on a clean cache', async () => {
    await remember('ghost|1999', null);

    expect(await purgeNegativeLookups(db)).toEqual({ purged: 1 });
    // One-off: a cache that empties itself on every boot is not a cache. The
    // second call must not even look.
    expect(await purgeNegativeLookups(db)).toBeNull();

    // And a miss cached after the purge stays cached — that one is an answer
    // from the corrected matcher.
    await remember('still absent|2024', null);
    expect(await purgeNegativeLookups(db)).toBeNull();
    expect(await all('SELECT lookup_key FROM title_lookup_cache')).toEqual([
      { lookup_key: 'still absent|2024' },
    ]);
  });

  test('reports zero rather than a stale count when there is nothing to purge', async () => {
    // sqlite3's `this.changes` after a statement that matched nothing reports
    // the *previous* statement's count, which is how an earlier one-off repair
    // came to run twice. Counting before the delete is what avoids it.
    await remember('dune|2021', 'movie-438631');

    expect(await purgeNegativeLookups(db)).toEqual({ purged: 0 });
    expect(await all('SELECT lookup_key FROM title_lookup_cache')).toHaveLength(1);
  });
});
