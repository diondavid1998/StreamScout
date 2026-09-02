'use strict';

/**
 * Currently Watching — a third list, series only.
 *
 * It differs from Watched and Watchlist in one way: a row carries a line of
 * copy about the show's schedule, and a flag for whether the show has aired
 * something since you last said you were caught up. Both are derived on read
 * from `title_details_cache`, which is shared by every user — a thousand people
 * following the same show is one cached row, not a thousand.
 *
 * Nothing here is stored per user except membership and `caught_up_on`. There
 * is no per-episode progress, which is what keeps the original promise of the
 * feature: you add a show with one tap and never enter anything.
 */

const { describeSeries, todayInAppZone } = require('./seriesSchedule');
const { readSeriesStatuses, storeDetails, readCachedDetails } = require('./titleCache');
const { fetchTitleWithCredits } = require('./movieService');

// Local rather than imported from catalogCache: that module would then have to
// import this one back to create its tables, and a require cycle for eight
// lines of plumbing is a bad trade.
const REFRESH_CONCURRENCY = 8;

function run(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); })
  );
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  );
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function ensureCurrentlyWatchingTables(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS currently_watching (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      item_id      TEXT    NOT NULL,
      title        TEXT,
      poster_url   TEXT,
      added_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- A bare YYYY-MM-DD in US Central, not a timestamp. Air dates have no
      -- time either, so comparing dates to dates is the only comparison that
      -- cannot be off by one at the wrong hour.
      caught_up_on TEXT NOT NULL,
      UNIQUE(user_id, item_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_currently_watching_user ON currently_watching(user_id)'
  );
}

/** `tv-1399` → 1399. Anything else, including a movie id, returns null. */
function seriesTmdbId(itemId) {
  const match = /^tv-(\d+)$/.exec(String(itemId || ''));
  return match ? parseInt(match[1], 10) : null;
}

/**
 * The user's list, each row carrying its schedule line and new-episode flag.
 *
 * `onlyNew` is the filter the feature exists for. It reads the badge, which is
 * per user, not the schedule line, which is per show.
 */
async function listCurrentlyWatching(db, userId, { onlyNew = false } = {}) {
  const rows = await all(
    db,
    'SELECT * FROM currently_watching WHERE user_id = ? ORDER BY added_at DESC',
    [userId]
  );
  if (!rows.length) return [];

  const tmdbIds = rows.map((row) => seriesTmdbId(row.item_id)).filter((id) => id !== null);
  const statuses = await readSeriesStatuses(db, tmdbIds);
  const today = todayInAppZone();

  const items = rows.map((row) => {
    const tmdbId = seriesTmdbId(row.item_id);
    const status = statuses.get(tmdbId) || null;
    // A show whose details have never been fetched says so rather than
    // guessing. It resolves itself on the next refresh.
    const schedule = status
      ? describeSeries(status, today)
      : { state: 'unknown', message: 'Schedule not loaded yet', weekday: null, nextAirDate: null, lastAirDate: null };
    const hasNewEpisode = Boolean(
      status?.lastAirDate && status.lastAirDate > row.caught_up_on
    );

    return {
      itemId: row.item_id,
      tmdbId,
      mediaType: 'tv',
      title: row.title,
      posterUrl: row.poster_url,
      addedAt: row.added_at,
      caughtUpOn: row.caught_up_on,
      state: schedule.state,
      scheduleMessage: schedule.message,
      weekday: schedule.weekday,
      lastAirDate: schedule.lastAirDate,
      hasNewEpisode,
      checkedAt: status?.fetchedAt || null,
    };
  });

  // Sorted so anything with something new is at the top, whether or not the
  // filter is on — the same expression the filter uses.
  items.sort((a, b) => Number(b.hasNewEpisode) - Number(a.hasNewEpisode));

  return onlyNew ? items.filter((item) => item.hasNewEpisode) : items;
}

/**
 * Add a show, and take it out of the watchlist.
 *
 * The three lists are exclusive: a show you are watching is not a show you are
 * planning to watch. Watched is left alone here — you leave for Watched by
 * finishing, which the client does by marking watched, and that removes the row
 * through `removeFromCurrentlyWatching`.
 */
async function addToCurrentlyWatching(db, userId, { itemId, title, posterUrl }) {
  const result = await run(
    db,
    `INSERT OR IGNORE INTO currently_watching (user_id, item_id, title, poster_url, caught_up_on)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, itemId, title || null, posterUrl || null, todayInAppZone()]
  );
  const added = result.changes > 0;
  if (added) {
    await run(db, 'DELETE FROM watchlist_items WHERE user_id = ? AND item_id = ?', [userId, itemId]);
    await run(
      db,
      'DELETE FROM watchlist_streaming_cache WHERE user_id = ? AND item_id = ?',
      [String(userId), itemId]
    );
  }
  return added;
}

async function removeFromCurrentlyWatching(db, userId, itemId) {
  const result = await run(
    db,
    'DELETE FROM currently_watching WHERE user_id = ? AND item_id = ?',
    [userId, itemId]
  );
  return result.changes;
}

async function clearCurrentlyWatching(db, userId) {
  const result = await run(db, 'DELETE FROM currently_watching WHERE user_id = ?', [userId]);
  return result.changes;
}

/** "I have seen everything out so far." Clears the badge until the next drop. */
async function markCaughtUp(db, userId, itemId) {
  const result = await run(
    db,
    'UPDATE currently_watching SET caught_up_on = ? WHERE user_id = ? AND item_id = ?',
    [todayInAppZone(), userId, itemId]
  );
  return result.changes > 0;
}

/**
 * Re-ask TMDB about every show in the user's list.
 *
 * Called only by the Refresh Catalog button. A show that has ended is skipped:
 * a finished series has no next episode to learn about, so re-fetching it is
 * spending a request to be told the same thing. That single check is what keeps
 * a long list cheap to refresh — a Currently Watching list accumulates finished
 * shows faster than airing ones.
 */
async function refreshSeriesSchedules(db, userId, { includeEnded = false } = {}) {
  const rows = await all(db, 'SELECT item_id FROM currently_watching WHERE user_id = ?', [userId]);
  const tmdbIds = rows.map((row) => seriesTmdbId(row.item_id)).filter((id) => id !== null);
  if (!tmdbIds.length) return { checked: 0, skipped: 0, failed: 0 };

  const known = await readSeriesStatuses(db, tmdbIds);
  const toCheck = includeEnded
    ? tmdbIds
    : tmdbIds.filter((id) => {
        const status = known.get(id);
        if (!status) return true;
        return !/^(ended|cancell?ed)$/i.test(String(status.status || '').trim());
      });

  let failed = 0;
  await mapWithConcurrency(toCheck, REFRESH_CONCURRENCY, async (tmdbId) => {
    try {
      const data = await fetchTitleWithCredits('tv', tmdbId);
      if (data?.id) await storeDetails(db, 'tv', tmdbId, data);
    } catch (error) {
      // One unreachable title must not abandon the rest of the refresh; the
      // stored row simply stays as it was.
      failed += 1;
      console.warn(`[currently-watching] refresh failed for tv-${tmdbId}: ${error.message}`);
    }
  });

  return { checked: toCheck.length, skipped: tmdbIds.length - toCheck.length, failed };
}

/**
 * Make sure a newly added show has schedule data, without making the caller
 * wait for TMDB. A miss here is the "never fetched" case, which is one of the
 * two reasons the app is allowed to call out at all.
 */
async function ensureSeriesDetails(db, tmdbId) {
  const cached = await readCachedDetails(db, 'tv', tmdbId);
  if (cached) return false;
  const data = await fetchTitleWithCredits('tv', tmdbId);
  if (!data?.id) return false;
  await storeDetails(db, 'tv', tmdbId, data);
  return true;
}

module.exports = {
  ensureCurrentlyWatchingTables,
  seriesTmdbId,
  listCurrentlyWatching,
  addToCurrentlyWatching,
  removeFromCurrentlyWatching,
  clearCurrentlyWatching,
  markCaughtUp,
  refreshSeriesSchedules,
  ensureSeriesDetails,
};
