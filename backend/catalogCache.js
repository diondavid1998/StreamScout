const {
  fetchCatalogByPlatforms,
  fetchOmdbRatings,
  fetchTitleDetails,
  includedProviders,
  isOmdbRateLimited,
  PLATFORM_CONFIG,
} = require('./movieService');
const { ensureTitleCacheTables } = require('./titleCache');
const { ensureCurrentlyWatchingTables } = require('./currentlyWatching');
const { ensureAnalyticsTables } = require('./analytics');
const { ensureWatchmodeTables } = require('./watchmode');

// Nothing in this app refreshes on a clock.
//
// It used to: a nightly job walked every cached scope, the catalog went stale
// after 24 hours and re-synced on the next page load, and watchlist
// availability re-fetched itself a day after it was written. All three meant
// TMDB was being called on days nobody asked for anything new, and a title's
// data could churn under a user who had not touched the app.
//
// Now a fetch happens for exactly two reasons: the data has never been fetched,
// or the Refresh Catalog button was pressed. Everything already fetched is
// served from SQLite, indefinitely, until one of those two things happens.
//
// CATALOG_SYNC_HOURS remains as a deliberate opt-in — set it and the old
// time-based staleness comes back, for anyone who wants a server that keeps
// itself current. Unset (the default) it is 0, meaning never.
const CATALOG_SYNC_HOURS = Math.max(Number(process.env.CATALOG_SYNC_HOURS) || 0, 0);
const AUTO_SYNC_MS = CATALOG_SYNC_HOURS * 60 * 60 * 1000;

// Written to watchlist_streaming_cache.checked_at by a manual refresh to mark a
// row for re-fetch on next read. A sentinel rather than a DELETE because a
// failed re-fetch must still have something to fall back on — dropping the row
// would make the title disappear from the streaming view until TMDB recovered.
const REVALIDATE_MARKER = '1970-01-01T00:00:00.000Z';
const DEFAULT_REGION = 'US';
// Ratings rarely change — keep them indefinitely once fetched.
// They are only re-fetched when a manual full refresh explicitly requests it.
// Increment this whenever PLATFORM_CONFIG provider IDs change so stale caches are invalidated
// Bumped when availability semantics change so stale snapshots are dropped:
// v3 added free and ad-supported tiers alongside flatrate.
const PROVIDER_CONFIG_VERSION = 4;
const syncLocks = new Map();
const ratingHydrationLocks = new Map();
const identifierBackfillLocks = new Map();
const savedRatingLocks = new Map();
// Per-run ceiling on OMDB calls for a user's saved titles. A Letterboxd import
// can be five figures; this drains across visits instead of in one burst.
const SAVED_HYDRATION_BATCH = 60;
let writeQueue = Promise.resolve();
const HYDRATION_BATCH_SIZE = 40;
const HYDRATION_CONCURRENCY = 8;
// Written to catalog_cache_entries.imdb_id when TMDB has been asked and has no
// IMDb ID to give. Distinguishes "resolved, nothing found" from "not yet asked"
// (NULL), so the backfill can never re-select the same unresolvable row forever.
const NO_IMDB_ID = '';
// Upper bound on backfill batches per scope — a healthy drain of a full
// MAX_SNAPSHOT_ITEMS scope takes ~25.
const MAX_BACKFILL_ITERATIONS = 200;

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

/**
 * Serialise a write against the single shared sqlite connection.
 *
 * Every explicit transaction in this process has to go through here. sqlite3
 * multiplexes one connection, so a second `BEGIN` issued while another
 * transaction is open fails with "cannot start a transaction within a
 * transaction" — and statements from an unrelated task would otherwise land
 * inside someone else's transaction and be rolled back with it.
 */
function enqueueWrite(operation) {
  const next = writeQueue.then(operation);
  writeQueue = next.catch(() => {});
  return next;
}

/**
 * Run `body` inside a transaction, serialised behind every other writer.
 * Commits on success, rolls back and rethrows on failure.
 */
function withTransaction(db, body) {
  return enqueueWrite(async () => {
    await run(db, 'BEGIN IMMEDIATE TRANSACTION');
    try {
      const result = await body();
      await run(db, 'COMMIT');
      return result;
    } catch (error) {
      await run(db, 'ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function isRateLimitError(error) {
  return /too many requests|rate limit|request limit/i.test(String(error?.message || error));
}

function buildScopeKey(platforms, region = DEFAULT_REGION, languages = []) {
  const normalizedPlatforms = [...new Set(platforms)].sort();
  const normalizedLanguages = [...new Set((Array.isArray(languages) ? languages : []).filter(Boolean))].sort();
  return `region:${region}|platforms:${normalizedPlatforms.join(',')}|languages:${normalizedLanguages.join(',')}`;
}

async function ensureCatalogTables(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS catalog_cache_entries (
      scope_key TEXT NOT NULL,
      media_type TEXT NOT NULL,
      tmdb_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      overview TEXT,
      release_date TEXT,
      year TEXT,
      poster_url TEXT,
      backdrop_path TEXT,
      tmdb_rating REAL,
      tmdb_vote_count INTEGER,
      popularity REAL,
      original_language TEXT,
      genres_json TEXT DEFAULT '[]',
      imdb_id TEXT,
      rating_imdb TEXT,
      rating_imdb_num REAL,
      rating_rt TEXT,
      rating_rt_num REAL,
      rating_meta TEXT,
      rating_meta_num REAL,
      available_on_json TEXT DEFAULT '[]',
      available_on_keys_json TEXT DEFAULT '[]',
      updated_at TEXT NOT NULL,
      first_seen_at TEXT,
      PRIMARY KEY (scope_key, media_type, tmdb_id)
    )`
  );

  // Migrate: add first_seen_at to existing tables that predate this column
  try {
    await run(db, `ALTER TABLE catalog_cache_entries ADD COLUMN first_seen_at TEXT`);
  } catch { /* column already exists */ }

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS catalog_cache_state (
      scope_key TEXT PRIMARY KEY,
      platforms_json TEXT NOT NULL,
      languages_json TEXT NOT NULL,
      region TEXT NOT NULL,
      last_synced_at TEXT,
      item_count INTEGER DEFAULT 0
    )`
  );

  // Shared cross-scope ratings cache keyed by imdb_id.
  // Populated after every OMDB fetch so that any title rated once is reused
  // across all scopes without additional OMDB calls.
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS title_ratings (
      imdb_id         TEXT PRIMARY KEY,
      rating_imdb     TEXT,
      rating_imdb_num REAL,
      rating_rt       TEXT,
      rating_rt_num   REAL,
      rating_meta     TEXT,
      rating_meta_num REAL,
      fetched_at      TEXT NOT NULL
    )`
  );

  // Resolved Letterboxd rows, keyed by the normalised "name (year)" from the CSV.
  //
  // A watchlist upload replaces the saved list, so people re-upload the same few
  // hundred titles every time their Letterboxd list changes. Without this, each
  // upload paid the full TMDB search cost again for titles that had already been
  // resolved. Misses are cached too (item_id NULL) - an unresolvable row is the
  // most expensive kind, since it exhausts every fallback search before failing.
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS title_lookup_cache (
      lookup_key  TEXT PRIMARY KEY,
      item_id     TEXT,
      media_type  TEXT,
      title       TEXT,
      poster_url  TEXT,
      resolved_at TEXT NOT NULL
    )`
  );

  // Key-value store for app-level settings (e.g. provider config version)
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
  );

  // User watchlist — created here so hydration queries can always reference it.
  // Also created in index.js and testHelpers.js; those are harmlessly idempotent.
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS watchlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      media_type TEXT,
      title TEXT,
      poster_url TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, item_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  );

  // User watched list — created here too so readCachedCatalog's "hide watched"
  // subquery can always reference it. Also created in index.js and
  // testHelpers.js; those are harmlessly idempotent.
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS watched_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      media_type TEXT,
      title TEXT,
      poster_url TEXT,
      watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, item_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  );

  // Index to speed up the EXISTS subquery in hydrateScopeRatings.
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_watchlist_items_item_id ON watchlist_items(item_id)`
  );

  // Sort indexes must match buildSortExpression COLUMN FOR COLUMN, including the
  // tiebreaker. The original set indexed only the leading column, so every sort
  // that carries a tiebreaker — which is all but one of them — fell back to a
  // full scan plus a temp B-tree, the default popularity sort included.
  //
  // Names and column expressions here are compile-time constants, never derived
  // from user input, so templating them is safe.
  const sortIndexes = [
    ['idx_cce_popularity_v2',      'popularity DESC, tmdb_rating DESC'],
    ['idx_cce_tmdb_rating_v2',     'tmdb_rating DESC, popularity DESC'],
    ['idx_cce_rating_imdb_v2',     'rating_imdb_num DESC, popularity DESC'],
    ['idx_cce_rating_rt_v2',       'rating_rt_num DESC, popularity DESC'],
    ['idx_cce_rating_meta_v2',     'rating_meta_num DESC, popularity DESC'],
    ['idx_cce_release_date',       'release_date DESC'],
    ['idx_cce_release_date_asc',   "(CASE WHEN release_date IS NULL OR release_date = '' THEN 1 ELSE 0 END) ASC, release_date ASC"],
    ['idx_cce_recently_added_v2',  'first_seen_at DESC, updated_at DESC'],
    ['idx_cce_title',              'title COLLATE NOCASE ASC'],
  ];
  for (const [name, col] of sortIndexes) {
    await run(
      db,
      `CREATE INDEX IF NOT EXISTS ${name}
       ON catalog_cache_entries(scope_key, ${col})`
    );
  }

  // Retire the single-column versions the ones above replace. Leaving them
  // costs write time on every sync and gives the planner nothing.
  for (const stale of [
    'idx_cce_popularity',
    'idx_cce_tmdb_rating',
    'idx_cce_rating_imdb_num',
    'idx_cce_rating_rt_num',
    'idx_cce_rating_meta_num',
    'idx_cce_first_seen_at',
  ]) {
    await run(db, `DROP INDEX IF EXISTS ${stale}`);
  }

  // Per-user streaming availability cache for watchlist items.
  // Keyed by (user_id, item_id) so it never pollutes the shared scope catalog.
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS watchlist_streaming_cache (
      user_id              TEXT NOT NULL,
      item_id              TEXT NOT NULL,
      title                TEXT,
      poster_url           TEXT,
      overview             TEXT,
      release_date         TEXT,
      year                 TEXT,
      tmdb_rating          REAL,
      tmdb_vote_count      INTEGER,
      popularity           REAL,
      original_language    TEXT,
      genres_json          TEXT DEFAULT '[]',
      imdb_id              TEXT,
      available_on_json    TEXT DEFAULT '[]',
      available_on_keys_json TEXT DEFAULT '[]',
      checked_at           TEXT NOT NULL,
      PRIMARY KEY (user_id, item_id)
    )`
  );

  // The durable per-title cache and the Currently Watching list. Created here
  // so every bootstrap path — production, tests — gets them from one place.
  await ensureTitleCacheTables(db);
  await ensureCurrentlyWatchingTables(db);
  await ensureAnalyticsTables(db);
  await ensureWatchmodeTables(db);

  // Invalidate catalog cache if provider IDs have changed since last deploy
  const versionRow = await get(db, `SELECT value FROM app_settings WHERE key = 'provider_config_version'`);
  const storedVersion = versionRow ? Number(versionRow.value) : 0;
  if (storedVersion !== PROVIDER_CONFIG_VERSION) {
    await run(db, `DELETE FROM catalog_cache_state`);
    await run(
      db,
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('provider_config_version', ?)`,
      [String(PROVIDER_CONFIG_VERSION)]
    );
    console.log(`[cache] Provider config updated to v${PROVIDER_CONFIG_VERSION} — catalog cache cleared`);
  }
}

function isScopeStale(stateRow) {
  // Never synced, or explicitly invalidated by the refresh button, which nulls
  // this column before kicking off the sync.
  if (!stateRow?.last_synced_at) {
    return true;
  }

  if (AUTO_SYNC_MS <= 0) {
    return false;
  }

  return Date.now() - new Date(stateRow.last_synced_at).getTime() >= AUTO_SYNC_MS;
}

/** Whether a cached availability row can be served as-is. See AUTO_SYNC_MS. */
function isAvailabilityFresh(cached) {
  if (!cached?.checked_at) return false;
  if (cached.checked_at === REVALIDATE_MARKER) return false;
  if (AUTO_SYNC_MS <= 0) return true;
  return Date.now() - new Date(cached.checked_at).getTime() < AUTO_SYNC_MS;
}

/**
 * Mark a user's cached availability rows for re-fetch. Called by the refresh
 * button; the re-fetch itself is lazy, on the next read of the watchlist view,
 * so pressing refresh never blocks on a walk of the whole saved list.
 */
async function invalidateWatchlistAvailability(db, userId) {
  await run(
    db,
    'UPDATE watchlist_streaming_cache SET checked_at = ? WHERE user_id = ?',
    [REVALIDATE_MARKER, String(userId)]
  );
}

// Bulk-copy ratings from title_ratings → catalog_cache_entries for a scope.
// Called after each sync so any title we've already rated (from another scope or
// a previous session) is immediately populated without OMDB calls.
async function populateRatingsFromCache(db, scopeKey) {
  const result = await run(
    db,
    `UPDATE catalog_cache_entries AS e
     SET rating_imdb     = tr.rating_imdb,
         rating_imdb_num = tr.rating_imdb_num,
         rating_rt       = tr.rating_rt,
         rating_rt_num   = tr.rating_rt_num,
         rating_meta     = tr.rating_meta,
         rating_meta_num = tr.rating_meta_num
     FROM title_ratings AS tr
     WHERE e.scope_key = ?
       AND e.imdb_id = tr.imdb_id
       AND (e.rating_imdb IS NULL OR e.rating_rt IS NULL OR e.rating_meta IS NULL)`,
    [scopeKey]
  );
  const count = result?.changes ?? 0;
  if (count > 0) {
    console.info(`Populated ${count} ratings from shared cache for ${scopeKey}`);
  }
}

async function syncScope(
  db,
  { platforms, languages, region = DEFAULT_REGION, forceRatingsRefresh = false }
) {
  const scopeKey = buildScopeKey(platforms, region, languages);
  if (syncLocks.has(scopeKey)) {
    return syncLocks.get(scopeKey);
  }

  const syncPromise = (async () => {
    const catalog = await fetchCatalogByPlatforms(platforms, {
      mediaType: 'all',
      sortBy: 'popularity',
      limit: 1000,
      page: 1,
      pageCount: 25,
      languagePageCount: 3,
      languages,
      restrictLanguages: Array.isArray(languages) && languages.length > 0,
      region,
      includeRatings: false,   // always skip inline OMDB — background hydration handles ratings
      includeExternalIds: true,
      snapshotMode: true,
    });

    const syncStartTime = new Date().toISOString();

    await enqueueWrite(async () => {
      await run(db, 'BEGIN IMMEDIATE TRANSACTION');
      try {
        for (const item of catalog.items) {
          await run(
            db,
            // On cold start, excluded.rating_* are real OMDB values → COALESCE takes them.
            // On re-sync (includeRatings: false), excluded.rating_* are null → COALESCE
            // keeps the existing hydrated values, so ratings never regress to null.
            `INSERT INTO catalog_cache_entries (
              scope_key, media_type, tmdb_id, title, overview, release_date, year, poster_url, backdrop_path,
              tmdb_rating, tmdb_vote_count, popularity, original_language, genres_json, imdb_id, rating_imdb,
              rating_imdb_num, rating_rt, rating_rt_num, rating_meta, rating_meta_num, available_on_json,
              available_on_keys_json, updated_at, first_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope_key, media_type, tmdb_id) DO UPDATE SET
              title                = excluded.title,
              overview             = excluded.overview,
              release_date         = excluded.release_date,
              year                 = excluded.year,
              poster_url           = excluded.poster_url,
              backdrop_path        = excluded.backdrop_path,
              tmdb_rating          = excluded.tmdb_rating,
              tmdb_vote_count      = excluded.tmdb_vote_count,
              popularity           = excluded.popularity,
              original_language    = excluded.original_language,
              genres_json          = excluded.genres_json,
              imdb_id              = COALESCE(excluded.imdb_id, imdb_id),
              rating_imdb          = COALESCE(excluded.rating_imdb, rating_imdb),
              rating_imdb_num      = COALESCE(excluded.rating_imdb_num, rating_imdb_num),
              rating_rt            = COALESCE(excluded.rating_rt, rating_rt),
              rating_rt_num        = COALESCE(excluded.rating_rt_num, rating_rt_num),
              rating_meta          = COALESCE(excluded.rating_meta, rating_meta),
              rating_meta_num      = COALESCE(excluded.rating_meta_num, rating_meta_num),
              available_on_json    = excluded.available_on_json,
              available_on_keys_json = excluded.available_on_keys_json,
              updated_at           = excluded.updated_at,
              first_seen_at        = COALESCE(first_seen_at, excluded.first_seen_at)`,
            [
              scopeKey,
              item.mediaType,
              item.tmdbId,
              item.title,
              item.overview || '',
              item.releaseDate || null,
              item.year || null,
              item.posterUrl || null,
              item.backdropPath || null,
              item.ratings?.tmdb || null,
              item.tmdbVoteCount || null,
              item.popularity || null,
              item.originalLanguage || null,
              JSON.stringify(item.genres || []),
              item.imdbId || null,
              item.ratings?.imdb || null,
              item.sortableRatings?.imdb || null,
              item.ratings?.rottenTomatoes || null,
              item.sortableRatings?.rottenTomatoes || null,
              item.ratings?.metacritic || null,
              item.sortableRatings?.metacritic || null,
              JSON.stringify(item.availableOn || []),
              JSON.stringify(item.availableOnKeys || []),
              syncStartTime,
              syncStartTime, // first_seen_at — COALESCE keeps original on re-sync
            ]
          );
        }

        // Remove titles that are no longer in the catalog (updated_at not touched by this sync)
        await run(
          db,
          `DELETE FROM catalog_cache_entries WHERE scope_key = ? AND updated_at < ?`,
          [scopeKey, syncStartTime]
        );

        await run(
          db,
          `INSERT INTO catalog_cache_state (scope_key, platforms_json, languages_json, region, last_synced_at, item_count)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(scope_key) DO UPDATE SET
             platforms_json = excluded.platforms_json,
             languages_json = excluded.languages_json,
             region = excluded.region,
             last_synced_at = excluded.last_synced_at,
             item_count = excluded.item_count`,
          [
            scopeKey,
            JSON.stringify(platforms),
            JSON.stringify(languages),
            region,
            new Date().toISOString(),
            catalog.items.length,
          ]
        );

        await run(db, 'COMMIT');
      } catch (error) {
        await run(db, 'ROLLBACK');
        throw error;
      }
    });

    if (forceRatingsRefresh) {
      // Manual full refresh: clear current scope ratings and shared cached ratings
      // for this scope's titles so OMDB is re-fetched once for fresh values.
      await enqueueWrite(async () => {
        await run(db, 'BEGIN IMMEDIATE TRANSACTION');
        try {
          await run(
            db,
            `DELETE FROM title_ratings
             WHERE imdb_id IN (
               SELECT DISTINCT imdb_id
               FROM catalog_cache_entries
               WHERE scope_key = ?
                 AND imdb_id IS NOT NULL
                 AND imdb_id != ''
             )`,
            [scopeKey]
          );
          await run(
            db,
            `UPDATE catalog_cache_entries
             SET rating_imdb = NULL,
                 rating_imdb_num = NULL,
                 rating_rt = NULL,
                 rating_rt_num = NULL,
                 rating_meta = NULL,
                 rating_meta_num = NULL
             WHERE scope_key = ?`,
            [scopeKey]
          );
          await run(db, 'COMMIT');
        } catch (error) {
          await run(db, 'ROLLBACK');
          throw error;
        }
      });
    } else {
      // Normal sync: reuse shared ratings cache and avoid unnecessary OMDB calls.
      await populateRatingsFromCache(db, scopeKey).catch((err) => {
        console.warn(`populateRatingsFromCache failed for ${scopeKey}: ${err.message}`);
      });
    }

    hydrateScopeRatings(db, scopeKey).catch((error) => {
      console.error(`Background rating hydration failed for ${scopeKey}:`, error);
    });

    return { scopeKey, itemCount: catalog.items.length, meta: catalog.meta };
  })().finally(() => {
    syncLocks.delete(scopeKey);
  });

  syncLocks.set(scopeKey, syncPromise);
  return syncPromise;
}

async function ensureScopeSynced(db, { platforms, languages, region = DEFAULT_REGION }) {
  const scopeKey = buildScopeKey(platforms, region, languages);
  const stateRow = await get(db, 'SELECT * FROM catalog_cache_state WHERE scope_key = ?', [scopeKey]);

  if (!stateRow) {
    if (!syncLocks.has(scopeKey)) {
      syncScope(db, { platforms, languages, region }).catch((error) => {
        console.error(`Initial catalog sync failed for ${scopeKey}:`, error);
      });
    }
  } else if (isScopeStale(stateRow) && !syncLocks.has(scopeKey)) {
    syncScope(db, { platforms, languages, region }).catch((error) => {
      console.error(`Background catalog refresh failed for ${scopeKey}:`, error);
    });
  }

  return scopeKey;
}

async function hydrateScopeRatings(db, scopeKey) {
  if (ratingHydrationLocks.has(scopeKey)) {
    return ratingHydrationLocks.get(scopeKey);
  }

  const hydrationPromise = (async () => {
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    while (true) {
      // Exit early if OMDB circuit breaker is tripped — hydration resumes after midnight reset
      if (isOmdbRateLimited()) {
        console.warn(`Rating hydration paused for ${scopeKey}: OMDB daily limit reached.`);
        return;
      }

      // Saved titles are rated before merely popular ones. The subqueries are
      // deliberately not filtered by user: this scope's cache is shared by every
      // user on the same platform set, so "someone saved this" is the right
      // global signal for what to spend an OMDB call on first.
      const rows = await all(
        db,
        `SELECT e.scope_key, e.media_type, e.tmdb_id, e.imdb_id,
                CASE
                  WHEN EXISTS (
                    SELECT 1 FROM watchlist_items w
                    WHERE w.item_id = e.media_type || '-' || CAST(e.tmdb_id AS TEXT)
                  ) THEN 0
                  WHEN EXISTS (
                    SELECT 1 FROM watched_items d
                    WHERE d.item_id = e.media_type || '-' || CAST(e.tmdb_id AS TEXT)
                  ) THEN 1
                  ELSE 2
                END AS saved_rank
         FROM catalog_cache_entries e
         WHERE e.scope_key = ?
           AND e.imdb_id IS NOT NULL
           AND e.imdb_id != ''
           AND (
             e.rating_imdb IS NULL OR
             e.rating_rt   IS NULL OR
             e.rating_meta IS NULL
           )
         ORDER BY saved_rank ASC, e.popularity DESC
         LIMIT ?`,
        [scopeKey, HYDRATION_BATCH_SIZE]
      );

      if (!rows.length) {
        return;
      }

      let updates;
      try {
        updates = (await mapWithConcurrency(
          rows,
          HYDRATION_CONCURRENCY,
          async (row) => {
            const ratings = await fetchOmdbRatings(row.imdb_id);
            // null means network/rate-limit error — skip so item stays in hydration queue
            if (ratings === null) return null;
            return { ...row, ratings };
          }
        )).filter(Boolean);
        consecutiveErrors = 0;
      } catch (error) {
        consecutiveErrors += 1;
        if (isRateLimitError(error) || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.warn(`Rating hydration paused for ${scopeKey}: ${error.message}`);
          return;
        }
        continue;
      }

      if (!updates.length) {
        return;
      }

      await enqueueWrite(async () => {
        await run(db, 'BEGIN IMMEDIATE TRANSACTION');
        try {
          const now = new Date().toISOString();
          for (const update of updates) {
            const imdb     = update.ratings.imdb ?? '';
            const imdbNum  = toSortableRating(update.ratings.imdb);
            const rt       = update.ratings.rottenTomatoes ?? '';
            const rtNum    = toSortableRating(update.ratings.rottenTomatoes);
            const meta     = update.ratings.metacritic ?? '';
            const metaNum  = toSortableRating(update.ratings.metacritic);

            // Update this scope's entry
            // Use '' (not null) for missing ratings so the entry won't re-enter the hydration queue
            await run(
              db,
              `UPDATE catalog_cache_entries
               SET rating_imdb = ?, rating_imdb_num = ?,
                   rating_rt = ?, rating_rt_num = ?,
                   rating_meta = ?, rating_meta_num = ?,
                   updated_at = ?
               WHERE scope_key = ? AND media_type = ? AND tmdb_id = ?`,
              [imdb, imdbNum, rt, rtNum, meta, metaNum, now,
               update.scope_key, update.media_type, update.tmdb_id]
            );

            // Write to shared cross-scope ratings cache so other scopes get this for free
            if (update.imdb_id) {
              await run(
                db,
                `INSERT INTO title_ratings
                   (imdb_id, rating_imdb, rating_imdb_num, rating_rt, rating_rt_num, rating_meta, rating_meta_num, fetched_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(imdb_id) DO UPDATE SET
                   rating_imdb     = excluded.rating_imdb,
                   rating_imdb_num = excluded.rating_imdb_num,
                   rating_rt       = excluded.rating_rt,
                   rating_rt_num   = excluded.rating_rt_num,
                   rating_meta     = excluded.rating_meta,
                   rating_meta_num = excluded.rating_meta_num,
                   fetched_at      = excluded.fetched_at`,
                [update.imdb_id, imdb, imdbNum, rt, rtNum, meta, metaNum, now]
              );
            }
          }
          await run(db, 'COMMIT');
        } catch (error) {
          await run(db, 'ROLLBACK');
          throw error;
        }
      });

    }
  })().finally(() => {
    ratingHydrationLocks.delete(scopeKey);
  });

  ratingHydrationLocks.set(scopeKey, hydrationPromise);
  return hydrationPromise;
}

/**
 * Fetch and cache third-party ratings for the titles a user has actually saved.
 *
 * hydrateScopeRatings only ever walks `catalog_cache_entries`, so it can only
 * rate titles that made the popular discover snapshot. A watchlist or watched
 * entry outside that snapshot — the obscure film that is exactly why someone
 * keeps a watchlist — was never sent to OMDB at all, and rendered with empty
 * IMDb/RT/Metacritic forever.
 *
 * This closes that gap. Results land in `title_ratings`, the shared cache keyed
 * by imdb_id, so they are reused by every scope and by the watchlist views that
 * already read from it. Watchlist entries are rated before watched ones: the
 * watchlist views display scores, while the watched tab does not yet — rating
 * those is cache-warming for when they resurface in the catalog.
 *
 * Safe to call speculatively. It is a no-op once everything is cached, is
 * locked per user, and respects the OMDB circuit breaker.
 */
async function hydrateSavedTitleRatings(db, userId) {
  const lockKey = String(userId);
  if (savedRatingLocks.has(lockKey)) {
    return savedRatingLocks.get(lockKey);
  }

  const hydrationPromise = (async () => {
    if (isOmdbRateLimited()) return { fetched: 0, skipped: 'omdb_rate_limited' };

    // An imdb_id can come from the per-user watchlist availability cache (which
    // resolves it from TMDB) or from any scope's catalog entry for the same
    // title. Rows already in title_ratings are skipped entirely.
    const rows = await all(
      db,
      `SELECT imdb_id, MIN(saved_rank) AS saved_rank
       FROM (
         SELECT COALESCE(
                  (SELECT c.imdb_id FROM watchlist_streaming_cache c
                    WHERE c.user_id = ? AND c.item_id = w.item_id),
                  (SELECT e.imdb_id FROM catalog_cache_entries e
                    WHERE e.media_type || '-' || CAST(e.tmdb_id AS TEXT) = w.item_id
                    LIMIT 1)
                ) AS imdb_id,
                0 AS saved_rank
         FROM watchlist_items w
         WHERE w.user_id = ?

         UNION ALL

         SELECT (SELECT e.imdb_id FROM catalog_cache_entries e
                  WHERE e.media_type || '-' || CAST(e.tmdb_id AS TEXT) = d.item_id
                  LIMIT 1) AS imdb_id,
                1 AS saved_rank
         FROM watched_items d
         WHERE d.user_id = ?
       )
       WHERE imdb_id IS NOT NULL
         AND imdb_id != ''
         AND imdb_id NOT IN (SELECT imdb_id FROM title_ratings)
       GROUP BY imdb_id
       ORDER BY saved_rank ASC
       LIMIT ?`,
      [userId, userId, userId, SAVED_HYDRATION_BATCH]
    );

    if (!rows.length) return { fetched: 0 };

    const updates = (await mapWithConcurrency(rows, HYDRATION_CONCURRENCY, async (row) => {
      const ratings = await fetchOmdbRatings(row.imdb_id);
      // null means rate-limited or a network error — leave it uncached so the
      // next run retries it.
      if (ratings === null) return null;
      return { imdbId: row.imdb_id, ratings };
    })).filter(Boolean);

    if (!updates.length) return { fetched: 0 };

    await enqueueWrite(async () => {
      await run(db, 'BEGIN IMMEDIATE TRANSACTION');
      try {
        const now = new Date().toISOString();
        for (const update of updates) {
          const imdb    = update.ratings.imdb ?? '';
          const imdbNum = toSortableRating(update.ratings.imdb);
          const rt      = update.ratings.rottenTomatoes ?? '';
          const rtNum   = toSortableRating(update.ratings.rottenTomatoes);
          const meta    = update.ratings.metacritic ?? '';
          const metaNum = toSortableRating(update.ratings.metacritic);

          await run(
            db,
            `INSERT INTO title_ratings
               (imdb_id, rating_imdb, rating_imdb_num, rating_rt, rating_rt_num, rating_meta, rating_meta_num, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(imdb_id) DO UPDATE SET
               rating_imdb     = excluded.rating_imdb,
               rating_imdb_num = excluded.rating_imdb_num,
               rating_rt       = excluded.rating_rt,
               rating_rt_num   = excluded.rating_rt_num,
               rating_meta     = excluded.rating_meta,
               rating_meta_num = excluded.rating_meta_num,
               fetched_at      = excluded.fetched_at`,
            [update.imdbId, imdb, imdbNum, rt, rtNum, meta, metaNum, now]
          );

          // Mirror into any scope that already holds this title, so the catalog
          // shows the score without waiting for its own hydration pass.
          await run(
            db,
            `UPDATE catalog_cache_entries
             SET rating_imdb = ?, rating_imdb_num = ?,
                 rating_rt = ?, rating_rt_num = ?,
                 rating_meta = ?, rating_meta_num = ?
             WHERE imdb_id = ?
               AND (rating_imdb IS NULL OR rating_rt IS NULL OR rating_meta IS NULL)`,
            [imdb, imdbNum, rt, rtNum, meta, metaNum, update.imdbId]
          );
        }
        await run(db, 'COMMIT');
      } catch (error) {
        await run(db, 'ROLLBACK');
        throw error;
      }
    });

    return { fetched: updates.length };
  })().finally(() => {
    savedRatingLocks.delete(lockKey);
  });

  savedRatingLocks.set(lockKey, hydrationPromise);
  return hydrationPromise;
}

async function backfillScopeIdentifiers(db, scopeKey) {
  if (identifierBackfillLocks.has(scopeKey)) {
    return identifierBackfillLocks.get(scopeKey);
  }

  const backfillPromise = (async () => {
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;
    let iterations = 0;

    while (true) {
      // Safety net: a scope holds at most MAX_SNAPSHOT_ITEMS rows, so a healthy
      // backfill drains in ~25 batches. Anything beyond MAX_BACKFILL_ITERATIONS
      // means rows are being re-selected without making progress — bail rather
      // than spin against TMDB.
      iterations += 1;
      if (iterations > MAX_BACKFILL_ITERATIONS) {
        console.warn(
          `Identifier backfill for ${scopeKey} stopped after ${MAX_BACKFILL_ITERATIONS} batches without draining the queue.`
        );
        return;
      }

      const rows = await all(
        db,
        `SELECT scope_key, media_type, tmdb_id
         FROM catalog_cache_entries
         WHERE scope_key = ?
           AND imdb_id IS NULL
         LIMIT ?`,
        [scopeKey, HYDRATION_BATCH_SIZE]
      );

      if (!rows.length) {
        return;
      }

      let updates;
      try {
        updates = (await mapWithConcurrency(rows, HYDRATION_CONCURRENCY, async (row) => {
          const details = await fetchTitleDetails(row.media_type, row.tmdb_id, {
            includeExternalIds: true,
          });

          // NO_IMDB_ID (not null) when TMDB has no IMDb ID for this title —
          // plenty of smaller TV series and regional films have none. Writing
          // null back would leave the row matching `imdb_id IS NULL`, so the
          // next SELECT would return it again and the loop would never end.
          return {
            ...row,
            imdbId: details.external_ids?.imdb_id || NO_IMDB_ID,
          };
        })).filter(Boolean);
        consecutiveErrors = 0;
      } catch (error) {
        consecutiveErrors += 1;
        if (isRateLimitError(error) || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.warn(`Identifier backfill paused for ${scopeKey}: ${error.message}`);
          return;
        }
        continue;
      }

      if (!updates.length) {
        return;
      }

      await enqueueWrite(async () => {
        await run(db, 'BEGIN IMMEDIATE TRANSACTION');
        try {
          for (const update of updates) {
            await run(
              db,
              `UPDATE catalog_cache_entries
               SET imdb_id = ?, updated_at = ?
               WHERE scope_key = ? AND media_type = ? AND tmdb_id = ?`,
              [
                update.imdbId,
                new Date().toISOString(),
                update.scope_key,
                update.media_type,
                update.tmdb_id,
              ]
            );
          }
          await run(db, 'COMMIT');
        } catch (error) {
          await run(db, 'ROLLBACK');
          throw error;
        }
      });

      hydrateScopeRatings(db, scopeKey).catch((error) => {
        console.error('Deferred rating hydration failed after identifier backfill', scopeKey, error);
      });
    }
  })().finally(() => {
    identifierBackfillLocks.delete(scopeKey);
  });

  identifierBackfillLocks.set(scopeKey, backfillPromise);
  return backfillPromise;
}

function toSortableRating(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  if (value.endsWith('%')) {
    return Number(value.replace('%', ''));
  }

  if (value.includes('/10')) {
    return Number(value.split('/')[0]);
  }

  if (value.includes('/100')) {
    return Number(value.split('/')[0]);
  }

  return null;
}

function buildSortExpression(sortBy) {
  switch (sortBy) {
    case 'title':
      return 'title COLLATE NOCASE ASC';
    case 'release_date':
      return 'release_date DESC';
    case 'release_date_asc':
      return "CASE WHEN release_date IS NULL OR release_date = '' THEN 1 ELSE 0 END ASC, release_date ASC";
    case 'recently_added':
      return 'first_seen_at DESC, updated_at DESC';
    case 'tmdb':
      return 'tmdb_rating DESC, popularity DESC';
    case 'imdb':
      return 'rating_imdb_num DESC, popularity DESC';
    case 'rotten_tomatoes':
      return 'rating_rt_num DESC, popularity DESC';
    case 'metacritic':
      return 'rating_meta_num DESC, popularity DESC';
    case 'popularity':
    default:
      return 'popularity DESC, tmdb_rating DESC';
  }
}

async function readCachedCatalog(
  db,
  {
    scopeKey,
    mediaType = 'all',
    sortBy = 'popularity',
    page = 1,
    pageSize = 24,
    serviceFilters = [],
    languageFilters = [],
    genreFilters = [],
    yearMin = null,
    yearMax = null,
    excludeWatchedForUserId = null,
  }
) {
  const filters = ['scope_key = ?'];
  const params = [scopeKey];
  const normalizedServiceFilters = [...new Set(serviceFilters.filter(Boolean))];
  const normalizedLanguageFilters = [...new Set(languageFilters.filter(Boolean))];
  const normalizedGenreFilters = [...new Set(genreFilters.filter(Boolean))];

  if (mediaType === 'movie' || mediaType === 'tv') {
    filters.push('media_type = ?');
    params.push(mediaType);
  } else if (mediaType === 'documentary') {
    filters.push("genres_json LIKE '%Documentary%'");
  }

  if (normalizedLanguageFilters.length) {
    filters.push(`original_language IN (${normalizedLanguageFilters.map(() => '?').join(', ')})`);
    params.push(...normalizedLanguageFilters);
  }

  if (normalizedServiceFilters.length) {
    filters.push(
      `(${normalizedServiceFilters
        .map(() => 'available_on_keys_json LIKE ?')
        .join(' OR ')})`
    );
    params.push(...normalizedServiceFilters.map((providerKey) => `%\"${providerKey}\"%`));
  }

  if (normalizedGenreFilters.length) {
    // Anime is a special case: Animation + Japanese language
    const genreClauses = normalizedGenreFilters.map((g) => {
      if (g === 'anime') return `(genres_json LIKE '%Animation%' AND original_language = 'ja')`;
      return `genres_json LIKE ?`;
    });
    filters.push(`(${genreClauses.join(' OR ')})`);
    normalizedGenreFilters
      .filter((g) => g !== 'anime')
      .forEach((g) => params.push(`%${g}%`));
  }

  if (yearMin) {
    filters.push('CAST(year AS INTEGER) >= ?');
    params.push(Number(yearMin));
  }

  if (yearMax) {
    filters.push('CAST(year AS INTEGER) <= ?');
    params.push(Number(yearMax));
  }

  // "Hide watched" as a correlated subquery rather than a NOT IN list of every
  // watched item_id. A Letterboxd import can run to five figures, and SQLite
  // caps a statement at 32,766 bound variables — and this WHERE clause is bound
  // three times per request. One parameter holds regardless of list size, and
  // watched_items' UNIQUE(user_id, item_id) index serves the lookup.
  if (excludeWatchedForUserId !== null && excludeWatchedForUserId !== undefined) {
    filters.push(
      `NOT EXISTS (
         SELECT 1 FROM watched_items w
         WHERE w.user_id = ?
           AND w.item_id = catalog_cache_entries.media_type || '-' || CAST(catalog_cache_entries.tmdb_id AS TEXT)
       )`
    );
    params.push(excludeWatchedForUserId);
  }

  const whereClause = filters.join(' AND ');

  // Must use the same predicate as backfillScopeIdentifiers. An entry already
  // resolved to NO_IMDB_ID is not "missing" — counting it here would re-fire the
  // backfill on every page load for a title TMDB will never have an ID for.
  //
  // EXISTS, not COUNT: the answer is only ever used as a boolean, so stopping at
  // the first match beats counting the whole filtered set on every request.
  const missingImdbIdsRow = await get(
    db,
    `SELECT 1 AS present
     FROM catalog_cache_entries
     WHERE ${whereClause}
       AND imdb_id IS NULL
     LIMIT 1`,
    params
  );

  if (missingImdbIdsRow) {
    backfillScopeIdentifiers(db, scopeKey).catch((error) => {
      console.error(`Identifier backfill skipped for ${scopeKey}:`, error.message);
    });
  }

  const sortExpression = buildSortExpression(sortBy);
  const countRow = await get(
    db,
    `SELECT COUNT(*) AS count FROM catalog_cache_entries WHERE ${whereClause}`,
    params
  );
  const totalCount = countRow?.count || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const offset = (currentPage - 1) * pageSize;
  const readPageRows = () =>
    all(
      db,
      `SELECT * FROM catalog_cache_entries
       WHERE ${whereClause}
       ORDER BY ${sortExpression}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

  let rows = await readPageRows();

  const items = rows.map((row) => ({
    id: `${row.media_type}-${row.tmdb_id}`,
    tmdbId: row.tmdb_id,
    mediaType: row.media_type,
    title: row.title,
    overview: row.overview,
    releaseDate: row.release_date,
    year: row.year ? parseInt(row.year, 10) : null,
    posterUrl: row.poster_url,
    backdropPath: row.backdrop_path,
    tmdbVoteCount: row.tmdb_vote_count,
    popularity: row.popularity,
    originalLanguage: row.original_language,
    genres: JSON.parse(row.genres_json || '[]'),
    imdbId: row.imdb_id,
    ratings: {
      tmdb: row.tmdb_rating,
      imdb: row.rating_imdb,
      rottenTomatoes: row.rating_rt,
      metacritic: row.rating_meta,
    },
    sortableRatings: {
      tmdb: row.tmdb_rating,
      imdb: row.rating_imdb_num,
      rottenTomatoes: row.rating_rt_num,
      metacritic: row.rating_meta_num,
    },
    availableOn: JSON.parse(row.available_on_json || '[]'),
    availableOnKeys: JSON.parse(row.available_on_keys_json || '[]'),
  }));

  const stateRow = await get(db, 'SELECT * FROM catalog_cache_state WHERE scope_key = ?', [scopeKey]);

  return {
    items,
    meta: {
      mediaType,
      sortBy,
      region: stateRow?.region || DEFAULT_REGION,
      languages: JSON.parse(stateRow?.languages_json || '[]'),
      activeServiceFilters: normalizedServiceFilters,
      activeLanguageFilters: normalizedLanguageFilters,
      page: currentPage,
      pageSize,
      platformCount: JSON.parse(stateRow?.platforms_json || '[]').length,
      resultCount: totalCount,
      visibleCount: items.length,
      totalPages,
      hasMore: currentPage < totalPages,
      lastUpdatedAt: stateRow?.last_synced_at || null,
      refreshing:
        syncLocks.has(scopeKey) ||
        identifierBackfillLocks.has(scopeKey) ||
        ratingHydrationLocks.has(scopeKey),
      cacheMode: 'manual_refresh',
    },
  };
}

// ── Watchlist streaming availability ─────────────────────────────────────────
// Build a provider ID → { key, name } map from PLATFORM_CONFIG for the given
// set of platform keys. Supports both single `id` and multi-`ids` entries.
function buildProviderLookupMap(platforms) {
  const map = new Map();
  for (const key of platforms) {
    const config = PLATFORM_CONFIG[key];
    if (!config) continue;
    const ids = config.ids || (config.id ? [config.id] : []);
    for (const id of ids) {
      map.set(id, { key, name: config.name });
    }
  }
  return map;
}

// Extract provider names+keys from a TMDB watch/providers response.
function extractAvailability(watchProviders, providerMap, region) {
  // Subscription, free and ad-supported alike — see INCLUDED_MONETIZATION in
  // movieService. Reading only `flatrate` here is why a watchlist title on Tubi
  // or Pluto came back with an empty availableOn even after the discover query
  // had found it.
  const offers = includedProviders(watchProviders, region);
  const seen = new Set();
  const names = [];
  const keys = [];
  for (const p of offers) {
    const entry = providerMap.get(p.provider_id);
    if (entry && !seen.has(entry.key)) {
      seen.add(entry.key);
      names.push(entry.name);
      keys.push(entry.key);
    }
  }
  return { names, keys };
}

/**
 * For each item in `watchlistRows`, fetch current streaming availability from
 * TMDB (with 24-hour per-user cache in `watchlist_streaming_cache`) and return
 * the items with `availableOn` / `availableOnKeys` annotated.
 *
 * `streamingOnly` selects between the two watchlist views the clients offer:
 *   false — every watchlist item, whether or not it is streaming anywhere.
 *           This is a 1:1 mirror of the user's watchlist ("From watchlist").
 *   true  — only items available on at least one of the user's platforms
 *           ("Streaming watchlist"). A filtered subset, by design.
 *
 * With `streamingOnly: false` and no platforms selected, items still come back;
 * they simply carry empty availability.
 *
 * Scoping guarantees:
 *  - `watchlistRows` is pre-filtered to `user_id` by the caller.
 *  - Cache lookups use both `user_id` AND `item_id`, so rows from other users
 *    cannot leak in.
 *  - `item_id` must match `/^(movie|tv)-(\d+)$/`; malformed ids are skipped.
 *  - When an item is removed from the watchlist, its cache row is also deleted
 *    by the `DELETE /watchlist/:item_id` handler, preventing stale results.
 *
 * This intentionally bypasses `catalog_cache_entries` so obscure / non-popular
 * titles that never appear in the top-300 discover snapshot are still found.
 */
async function getWatchlistItemsWithAvailability(
  db,
  userId,
  watchlistRows,
  platforms,
  region,
  { streamingOnly = true } = {}
) {
  if (!watchlistRows.length) return [];
  // Availability can only be judged against a set of platforms; with none
  // selected there is nothing to filter by, so the streaming view is empty.
  if (streamingOnly && !platforms.length) return [];

  const providerMap = buildProviderLookupMap(platforms);
  const platformSet = new Set(platforms);
  const nowIso = new Date().toISOString();
  const result = [];

  for (const row of watchlistRows) {
    const m = row.item_id.match(/^(movie|tv)-(\d+)$/);
    if (!m) continue;
    const [, mediaType, tmdbIdStr] = m;
    const tmdbId = parseInt(tmdbIdStr, 10);

    let cached = await get(db,
      'SELECT * FROM watchlist_streaming_cache WHERE user_id = ? AND item_id = ?',
      [userId, row.item_id]
    );

    if (!isAvailabilityFresh(cached)) {
      try {
        const details = await fetchTitleDetails(mediaType, tmdbId, { includeExternalIds: true });
        if (!details) {
          if (!cached) continue;
        } else {
          const available = extractAvailability(details['watch/providers'], providerMap, region);
          const vals = [
            userId,
            row.item_id,
            details.title || details.name || row.title || 'Unknown',
            details.poster_path
              ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
              : (row.poster_url || null),
            details.overview || null,
            details.release_date || details.first_air_date || null,
            (details.release_date || details.first_air_date || '').slice(0, 4) || null,
            details.vote_average || null,
            details.vote_count || null,
            details.popularity || null,
            details.original_language || null,
            JSON.stringify((details.genres || []).map((g) => g.name)),
            details.external_ids?.imdb_id || null,
            JSON.stringify(available.names),
            JSON.stringify(available.keys),
            nowIso,
          ];
          await run(db,
            `INSERT OR REPLACE INTO watchlist_streaming_cache
               (user_id, item_id, title, poster_url, overview, release_date, year,
                tmdb_rating, tmdb_vote_count, popularity, original_language, genres_json, imdb_id,
                available_on_json, available_on_keys_json, checked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            vals
          );
          cached = {
            title: vals[2], poster_url: vals[3], overview: vals[4],
            release_date: vals[5], year: vals[6], tmdb_rating: vals[7],
            tmdb_vote_count: vals[8], popularity: vals[9], original_language: vals[10],
            genres_json: vals[11], imdb_id: vals[12],
            available_on_json: vals[13], available_on_keys_json: vals[14],
          };
        }
      } catch (e) {
        console.error(`[watchlist-streaming] Failed to fetch ${row.item_id}:`, e.message);
        if (!cached) continue;
        // fall through and use stale cached data
      }
    }

    if (!cached) continue;

    const availableKeys = JSON.parse(cached.available_on_keys_json || '[]');
    if (streamingOnly && !availableKeys.some((k) => platformSet.has(k))) continue;

    result.push({
      id: row.item_id,
      tmdbId,
      mediaType,
      // Surfaced so the "recently added" sort means something in this view.
      addedAt: row.added_at || null,
      title: cached.title || row.title || 'Unknown',
      overview: cached.overview || null,
      releaseDate: cached.release_date || null,
      year: cached.year ? parseInt(cached.year, 10) : null,
      posterUrl: cached.poster_url || row.poster_url || null,
      backdropPath: null,
      tmdbRating: cached.tmdb_rating || null,
      tmdbVoteCount: cached.tmdb_vote_count || null,
      popularity: cached.popularity || null,
      originalLanguage: cached.original_language || null,
      genres: JSON.parse(cached.genres_json || '[]'),
      imdbId: cached.imdb_id || null,
      _imdbIdForRatings: cached.imdb_id || null,
      availableOn: JSON.parse(cached.available_on_json || '[]'),
      availableOnKeys: JSON.parse(cached.available_on_keys_json || '[]'),
    });
  }

  // Batch-resolve third-party ratings from the shared title_ratings cache.
  const imdbIds = [...new Set(result.map((r) => r._imdbIdForRatings).filter(Boolean))];
  const ratingsMap = new Map();
  if (imdbIds.length > 0) {
    const placeholders = imdbIds.map(() => '?').join(', ');
    const ratingRows = await all(
      db,
      `SELECT imdb_id, rating_imdb, rating_imdb_num, rating_rt, rating_rt_num, rating_meta, rating_meta_num
       FROM title_ratings
       WHERE imdb_id IN (${placeholders})`,
      imdbIds
    );
    for (const rr of ratingRows) {
      ratingsMap.set(rr.imdb_id, rr);
    }
  }

  return result.map(({ _imdbIdForRatings, ...item }) => {
    const tr = _imdbIdForRatings ? ratingsMap.get(_imdbIdForRatings) : null;
    const imdbVal = (tr?.rating_imdb   && tr.rating_imdb   !== '') ? tr.rating_imdb   : null;
    const rtVal   = (tr?.rating_rt     && tr.rating_rt     !== '') ? tr.rating_rt     : null;
    const metaVal = (tr?.rating_meta   && tr.rating_meta   !== '') ? tr.rating_meta   : null;
    return {
      ...item,
      ratings: {
        tmdb: item.tmdbRating || null,
        imdb: imdbVal,
        rottenTomatoes: rtVal,
        metacritic: metaVal,
      },
      sortableRatings: {
        tmdb: item.tmdbRating || 0,
        imdb: tr?.rating_imdb_num ?? 0,
        rottenTomatoes: tr?.rating_rt_num ?? 0,
        metacritic: tr?.rating_meta_num ?? 0,
      },
    };
  });
}

/** "Streaming watchlist" view — watchlist items available on the user's platforms. */
function getStreamableWatchlistItems(db, userId, watchlistRows, platforms, region) {
  return getWatchlistItemsWithAvailability(db, userId, watchlistRows, platforms, region, {
    streamingOnly: true,
  });
}

module.exports = {
  AUTO_SYNC_MS,
  ensureCatalogTables,
  ensureScopeSynced,
  readCachedCatalog,
  getWatchlistItemsWithAvailability,
  getStreamableWatchlistItems,
  invalidateWatchlistAvailability,
  syncScope,
  withTransaction,
  // Exported for unit testing
  buildScopeKey,
  mapWithConcurrency,
  isRateLimitError,
  isAvailabilityFresh,
  hydrateScopeRatings,
  hydrateSavedTitleRatings,
  backfillScopeIdentifiers,
  NO_IMDB_ID,
};
