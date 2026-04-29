const { fetchCatalogByPlatforms, fetchOmdbRatings, fetchTitleDetails, isOmdbRateLimited } = require('./movieService');

const CATALOG_SYNC_HOURS = Math.max(Number(process.env.CATALOG_SYNC_HOURS) || 24, 1);
const DAILY_SYNC_MS = CATALOG_SYNC_HOURS * 60 * 60 * 1000;
const DEFAULT_REGION = 'US';
// Ratings rarely change — cache them for 30 days before re-fetching from OMDB
const RATINGS_CACHE_TTL_DAYS = Number(process.env.RATINGS_CACHE_TTL_DAYS) || 30;
// Increment this whenever PLATFORM_CONFIG provider IDs change so stale caches are invalidated
const PROVIDER_CONFIG_VERSION = 2;
const syncLocks = new Map();
const ratingHydrationLocks = new Map();
const identifierBackfillLocks = new Map();
let writeQueue = Promise.resolve();
const HYDRATION_BATCH_SIZE = 40;
const HYDRATION_CONCURRENCY = 4;

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

function enqueueWrite(operation) {
  const next = writeQueue.then(operation);
  writeQueue = next.catch(() => {});
  return next;
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

function buildScopeKey(platforms, region = DEFAULT_REGION) {
  const normalizedPlatforms = [...new Set(platforms)].sort();
  return `region:${region}|platforms:${normalizedPlatforms.join(',')}`;
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

  // Key-value store for app-level settings (e.g. provider config version)
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
  );

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
  if (!stateRow?.last_synced_at) {
    return true;
  }

  return Date.now() - new Date(stateRow.last_synced_at).getTime() >= DAILY_SYNC_MS;
}

// Bulk-copy ratings from title_ratings → catalog_cache_entries for a scope.
// Called after each sync so any title we've already rated (from another scope or
// a previous session) is immediately populated without OMDB calls.
async function populateRatingsFromCache(db, scopeKey) {
  const cutoff = new Date(Date.now() - RATINGS_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
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
       AND tr.fetched_at >= ?
       AND (e.rating_imdb IS NULL OR e.rating_rt IS NULL OR e.rating_meta IS NULL)`,
    [scopeKey, cutoff]
  );
  const count = result?.changes ?? 0;
  if (count > 0) {
    console.info(`Populated ${count} ratings from shared cache for ${scopeKey}`);
  }
}

async function syncScope(db, { platforms, languages, region = DEFAULT_REGION }) {
  const scopeKey = buildScopeKey(platforms, region);
  if (syncLocks.has(scopeKey)) {
    return syncLocks.get(scopeKey);
  }

  const syncPromise = (async () => {
    const catalog = await fetchCatalogByPlatforms(platforms, {
      mediaType: 'all',
      sortBy: 'popularity',
      limit: 300,
      page: 1,
      pageCount: 6,
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

    // Populate ratings from shared cache first (free, no OMDB calls).
    // Any remaining NULLs will be filled by background hydration.
    await populateRatingsFromCache(db, scopeKey).catch((err) => {
      console.warn(`populateRatingsFromCache failed for ${scopeKey}: ${err.message}`);
    });

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
  const scopeKey = buildScopeKey(platforms, region);
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

      const rows = await all(
        db,
        `SELECT scope_key, media_type, tmdb_id, imdb_id
         FROM catalog_cache_entries
         WHERE scope_key = ?
           AND imdb_id IS NOT NULL
           AND imdb_id != ''
           AND (
             rating_imdb IS NULL OR
             rating_rt   IS NULL OR
             rating_meta IS NULL
           )
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

async function backfillScopeIdentifiers(db, scopeKey) {
  if (identifierBackfillLocks.has(scopeKey)) {
    return identifierBackfillLocks.get(scopeKey);
  }

  const backfillPromise = (async () => {
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    while (true) {
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

          return {
            ...row,
            imdbId: details.external_ids?.imdb_id || null,
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

function isRatingsSort(sortBy) {
  return sortBy === 'imdb' || sortBy === 'rotten_tomatoes' || sortBy === 'metacritic';
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
    excludeItemIds = [],
    watchlistItemIds = [],
  }
) {
  const filters = ['scope_key = ?'];
  const params = [scopeKey];
  const normalizedServiceFilters = [...new Set(serviceFilters.filter(Boolean))];
  const normalizedLanguageFilters = [...new Set(languageFilters.filter(Boolean))];
  const normalizedGenreFilters = [...new Set(genreFilters.filter(Boolean))];
  const normalizedExcludeIds = [...new Set(excludeItemIds.filter(Boolean))];
  const normalizedWatchlistIds = [...new Set(watchlistItemIds.filter(Boolean))];

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

  if (normalizedExcludeIds.length) {
    filters.push(
      `(media_type || '-' || CAST(tmdb_id AS TEXT)) NOT IN (${normalizedExcludeIds.map(() => '?').join(', ')})`
    );
    params.push(...normalizedExcludeIds);
  }

  if (normalizedWatchlistIds.length) {
    filters.push(
      `(media_type || '-' || CAST(tmdb_id AS TEXT)) IN (${normalizedWatchlistIds.map(() => '?').join(', ')})`
    );
    params.push(...normalizedWatchlistIds);
  }

  const whereClause = filters.join(' AND ');

  const missingImdbIdsRow = await get(
    db,
    `SELECT COUNT(*) AS count
     FROM catalog_cache_entries
     WHERE ${whereClause}
       AND COALESCE(imdb_id, '') = ''`,
    params
  );

  if ((missingImdbIdsRow?.count || 0) > 0) {
    backfillScopeIdentifiers(db, scopeKey).catch((error) => {
      console.error(`Identifier backfill skipped for ${scopeKey}:`, error.message);
    });
  }

  if (isRatingsSort(sortBy)) {
    const missingRatingsRow = await get(
      db,
      `SELECT COUNT(*) AS count
       FROM catalog_cache_entries
       WHERE ${whereClause}
         AND imdb_id IS NOT NULL
         AND (
           ${sortBy === 'imdb' ? 'rating_imdb_num' : sortBy === 'rotten_tomatoes' ? 'rating_rt_num' : 'rating_meta_num'}
         ) IS NULL`,
      params
    );

    if ((missingRatingsRow?.count || 0) > 0) {
      hydrateScopeRatings(db, scopeKey).catch((error) => {
        console.error(`Ratings hydration skipped for ${scopeKey}:`, error.message);
      });
    }
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
    year: row.year,
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

  if (rows.some((row) => row.imdb_id && (
    row.rating_imdb == null ||
    row.rating_rt   == null ||
    row.rating_meta == null
  ))) {
    hydrateScopeRatings(db, scopeKey).catch((error) => {
      console.error(`Deferred rating hydration failed for ${scopeKey}:`, error);
    });
  }

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
      cacheMode: 'daily_snapshot',
    },
  };
}

function nextMidnightDelayMs() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

async function refreshAllCachedScopes(db) {
  const rows = await all(db, 'SELECT * FROM catalog_cache_state');
  for (const row of rows) {
    const platforms = JSON.parse(row.platforms_json || '[]');
    const languages = JSON.parse(row.languages_json || '[]');
    if (!platforms.length) {
      continue;
    }

    try {
      await syncScope(db, {
        platforms,
        languages,
        region: row.region || DEFAULT_REGION,
      });
    } catch (error) {
      console.error(`Daily catalog sync failed for ${row.scope_key}:`, error);
    }
  }
}

function startDailyCatalogRefresh(db) {
  const scheduleNext = () => {
    setTimeout(async () => {
      await refreshAllCachedScopes(db).catch((error) => {
        console.error('Scheduled catalog refresh failed:', error);
      });
      scheduleNext();
    }, nextMidnightDelayMs());
  };

  scheduleNext();
}

module.exports = {
  DAILY_SYNC_MS,
  ensureCatalogTables,
  ensureScopeSynced,
  readCachedCatalog,
  refreshAllCachedScopes,
  startDailyCatalogRefresh,
  syncScope,
  // Exported for unit testing
  buildScopeKey,
  mapWithConcurrency,
  isRateLimitError,
};
