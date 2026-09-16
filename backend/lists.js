'use strict';

/**
 * The three lists, and the one rule that binds them.
 *
 *   watched_items       what you have seen
 *   watchlist_items     what you mean to see
 *   currently_watching  what you are part-way through
 *
 * A title belongs to at most one of them. The three make a claim about the same
 * thing — where a title sits in your relationship with it — and a title cannot
 * be in two places at once. "Watched and also planning to watch" is not a state
 * a person is ever in; it is a bug, and it was reachable from five different
 * write paths because each one enforced whichever part of the rule its author
 * had in mind.
 *
 * So the rule lives here instead. Every path that puts a title into a list goes
 * through `claimForList`, and the invariant holds by construction rather than by
 * everyone remembering.
 *
 * ── The two ways a title can move ──
 *
 * `claimForList` is for a deliberate, single-title action: a tap on Mark
 * Watched, on Add to Watchlist, on Start Watching. The list the user just chose
 * wins, and the title leaves the others. This is the only behaviour that is not
 * a silent no-op — refusing the tap, or accepting it and quietly leaving the old
 * row in place, both give the user a button that appears to do nothing.
 *
 * `claimForImport` is for a bulk restatement, where nobody pressed anything per
 * title. There, watched history wins: a stale watchlist.csv mentioning a
 * thousand films you have since seen must not delete a thousand rows of history.
 * Those titles are skipped and counted, which is recoverable — the user can add
 * any of them back with one tap. Deleting the history is not.
 */

const LIST_TABLES = {
  watched: 'watched_items',
  watchlist: 'watchlist_items',
  watching: 'currently_watching',
};

const LIST_NAMES = Object.keys(LIST_TABLES);

function run(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); })
  );
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  );
}

/**
 * Schema this module owns.
 *
 * `import_token` stages a replacing watchlist import. See the note on
 * `finaliseWatchlistImport`.
 */
async function ensureListTables(db) {
  const columns = await all(db, 'PRAGMA table_info(watchlist_items)');
  if (!columns.some((c) => c.name === 'import_token')) {
    await run(db, 'ALTER TABLE watchlist_items ADD COLUMN import_token TEXT');
  }

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS list_repairs (
      name       TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
}

/**
 * Remove a title from every list except the one claiming it.
 *
 * Returns the lists it was actually taken out of, so a caller can tell the user
 * their title moved rather than leaving them to notice it vanished from a tab.
 */
async function claimForList(db, userId, itemId, list) {
  if (!LIST_NAMES.includes(list)) throw new Error(`unknown list: ${list}`);

  const movedFrom = [];
  for (const other of LIST_NAMES) {
    if (other === list) continue;
    const { changes } = await run(
      db,
      `DELETE FROM ${LIST_TABLES[other]} WHERE user_id = ? AND item_id = ?`,
      [userId, itemId]
    );
    if (changes > 0) movedFrom.push(other);
  }

  // The availability cache is keyed per user and item and answers for the
  // watchlist view. A row left behind for a title no longer on the list keeps
  // answering after the title has gone.
  if (movedFrom.includes('watchlist')) {
    await run(
      db,
      'DELETE FROM watchlist_streaming_cache WHERE user_id = ? AND item_id = ?',
      [String(userId), itemId]
    );
  }
  return movedFrom;
}

/**
 * Which of these titles are already in the watched history.
 *
 * A bulk watchlist import asks this instead of evicting, so history survives a
 * stale export. Chunked because SQLite's default parameter ceiling is 999 and an
 * import batch is allowed to be larger than that.
 */
async function alreadyWatched(db, userId, itemIds) {
  const unique = [...new Set(itemIds.filter(Boolean))];
  const found = new Set();
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const rows = await all(
      db,
      `SELECT item_id FROM watched_items
        WHERE user_id = ? AND item_id IN (${chunk.map(() => '?').join(',')})`,
      [userId, ...chunk]
    );
    for (const row of rows) found.add(row.item_id);
  }
  return found;
}

/**
 * Bulk claim, for an import.
 *
 * Sparing the watched history is not done here. A watchlist import filters its
 * batch through `alreadyWatched` first, so a title it has seen never reaches
 * this function — which leaves nothing for a `protect` argument to do, and an
 * argument that can never change the outcome is a branch no test can reach.
 */
async function claimForImport(db, userId, itemIds, list) {
  if (!LIST_NAMES.includes(list)) throw new Error(`unknown list: ${list}`);
  const unique = [...new Set(itemIds.filter(Boolean))];
  if (!unique.length) return;

  for (const other of LIST_NAMES) {
    if (other === list) continue;
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500);
      const placeholders = chunk.map(() => '?').join(',');
      await run(
        db,
        `DELETE FROM ${LIST_TABLES[other]}
          WHERE user_id = ? AND item_id IN (${placeholders})`,
        [userId, ...chunk]
      );
      if (other === 'watchlist') {
        await run(
          db,
          `DELETE FROM watchlist_streaming_cache
            WHERE user_id = ? AND item_id IN (${placeholders})`,
          [String(userId), ...chunk]
        );
      }
    }
  }
}

/**
 * Finish a replacing watchlist import.
 *
 * A replacing import used to DELETE the whole watchlist on the first batch and
 * then refill it over the batches that followed. Those are separate requests
 * with no transaction across them, so a network blip at batch three of twenty
 * left the user with a sixth of their watchlist and a client that had already
 * stopped. The list was gone and nothing said so.
 *
 * Now nothing is deleted up front. Every batch stamps its rows with the import's
 * token, and only once the client says the whole export is in do the rows
 * carrying a different token — the previous watchlist — go. An import that dies
 * half way leaves a superset: the old list plus whatever arrived. Untidy, and
 * recoverable by importing again, which is the right way round.
 */
async function finaliseWatchlistImport(db, userId, token) {
  if (!token) throw new Error('an import token is required to finalise');
  const stale = await all(
    db,
    `SELECT item_id FROM watchlist_items
      WHERE user_id = ? AND (import_token IS NULL OR import_token <> ?)`,
    [userId, token]
  );
  const { changes } = await run(
    db,
    `DELETE FROM watchlist_items
      WHERE user_id = ? AND (import_token IS NULL OR import_token <> ?)`,
    [userId, token]
  );
  for (let i = 0; i < stale.length; i += 500) {
    const chunk = stale.slice(i, i + 500).map((r) => r.item_id);
    await run(
      db,
      `DELETE FROM watchlist_streaming_cache
        WHERE user_id = ? AND item_id IN (${chunk.map(() => '?').join(',')})`,
      [String(userId), ...chunk]
    );
  }
  // The token has done its job; clearing it keeps the next import's comparison
  // against a clean slate rather than against an ever-growing set of old tokens.
  await run(db, 'UPDATE watchlist_items SET import_token = NULL WHERE user_id = ?', [userId]);
  return changes;
}

/**
 * Carry a stored platform selection across the PVOD → VOD rename.
 *
 * The key is not just a label: it is persisted in `users.platforms`, and
 * `buildProviderSelection` drops anything it does not recognise. Renaming
 * without this would silently un-pick the tile for everyone who had chosen it —
 * no error, no empty state, just a setting that quietly reverted.
 *
 * Lives here rather than in a SQL migration because the column holds a JSON
 * array and SQLite's json1 extension is not guaranteed to be compiled in.
 *
 * One-off, guarded on the same ledger as the list repair, and for the same
 * reason: it rewrites user data, and a rewrite that runs unattended forever is
 * one refactor away from rewriting the wrong thing.
 */
async function renamePvodToVod(db) {
  const done = await all(db, "SELECT 1 FROM list_repairs WHERE name = 'pvod-renamed-to-vod'");
  if (done.length) return null;
  await run(db, "INSERT OR IGNORE INTO list_repairs (name) VALUES ('pvod-renamed-to-vod')");

  const users = await all(db, 'SELECT id, platforms FROM users WHERE platforms LIKE ?', ['%pvod%']);
  let changed = 0;
  for (const user of users) {
    let platforms;
    try { platforms = JSON.parse(user.platforms || '[]'); } catch { continue; }
    if (!Array.isArray(platforms) || !platforms.includes('pvod')) continue;
    // Mapped, not appended: someone who had both would otherwise end up with a
    // duplicate, and the selection is a set.
    const renamed = [...new Set(platforms.map((key) => (key === 'pvod' ? 'vod' : key)))];
    await run(db, 'UPDATE users SET platforms = ? WHERE id = ?', [JSON.stringify(renamed), user.id]);
    changed += 1;
  }
  return { users: changed };
}

/**
 * Drop the remembered misses left by the old title matcher.
 *
 * `title_lookup_cache` stores a null for a title TMDB had nothing under, and
 * `resolveImportBatch` serves that null for `NEGATIVE_LOOKUP_TTL_MS` — fourteen
 * days — without asking again. That is the right behaviour for a film that
 * genuinely does not exist, and the wrong one for these: every null written
 * before the matcher was fixed may be a film TMDB *did* return and the old
 * normaliser refused. Left alone, the fix would appear not to work, because
 * re-importing would replay the stored miss rather than re-run the search.
 *
 * Only the nulls go. A row that resolved is an answer, still correct, and worth
 * far more than the request it would cost to fetch again.
 *
 * One-off and ledger-guarded like the repairs above, for a different reason:
 * it is not destructive of anything a user can see, but a cache that empties
 * itself on every boot is not a cache.
 */
async function purgeNegativeLookups(db) {
  const done = await all(db, "SELECT 1 FROM list_repairs WHERE name = 'negative-lookups-purged-v1'");
  if (done.length) return null;
  await run(db, "INSERT OR IGNORE INTO list_repairs (name) VALUES ('negative-lookups-purged-v1')");

  // Counted before the delete: sqlite3's `this.changes` after a statement that
  // matched nothing reports the previous statement's count, which is how the
  // list repair came to run twice.
  const [{ n = 0 } = {}] = await all(
    db,
    'SELECT COUNT(*) AS n FROM title_lookup_cache WHERE item_id IS NULL'
  );
  if (n > 0) await run(db, 'DELETE FROM title_lookup_cache WHERE item_id IS NULL');
  return { purged: n };
}

/**
 * One-off repair for the overlaps that already exist.
 *
 * Precedence is watched > currently watching > watchlist, which is what every
 * interactive path in this codebase already did before the rule was centralised:
 * marking watched removed a title from Currently Watching, and starting to watch
 * removed it from the watchlist. Nothing here can invent the missing half of
 * that ordering, so it applies the half that was always intended.
 *
 * Deliberately one-off. Running it on every boot would be harmless today, but it
 * is a destructive query, and a destructive query that runs unattended forever
 * is one refactor away from deleting the wrong side.
 */
async function reconcileLists(db) {
  // Asked of the table rather than inferred from `changes`. sqlite3 surfaces
  // sqlite3_changes(), which reports the last statement that modified anything
  // — so an INSERT OR IGNORE that ignored returns whatever the statement before
  // it changed. The guard on a destructive one-off repair cannot rest on that.
  const done = await all(
    db,
    "SELECT 1 FROM list_repairs WHERE name = 'three-list-exclusivity'"
  );
  if (done.length) return null;
  await run(db, "INSERT OR IGNORE INTO list_repairs (name) VALUES ('three-list-exclusivity')");

  const removedFromWatchlist = await run(
    db,
    `DELETE FROM watchlist_items
      WHERE EXISTS (
        SELECT 1 FROM watched_items w
         WHERE w.user_id = watchlist_items.user_id AND w.item_id = watchlist_items.item_id
      )
      OR EXISTS (
        SELECT 1 FROM currently_watching c
         WHERE c.user_id = watchlist_items.user_id AND c.item_id = watchlist_items.item_id
      )`
  );
  const removedFromWatching = await run(
    db,
    `DELETE FROM currently_watching
      WHERE EXISTS (
        SELECT 1 FROM watched_items w
         WHERE w.user_id = currently_watching.user_id AND w.item_id = currently_watching.item_id
      )`
  );
  return {
    watchlist: removedFromWatchlist.changes,
    watching: removedFromWatching.changes,
  };
}

/**
 * Every title sitting in more than one list. Empty is the invariant holding.
 *
 * Exists for the tests, and for anyone who wants to check a live database
 * without reconstructing the join by hand.
 */
async function findListOverlaps(db) {
  return all(
    db,
    `SELECT user_id, item_id, 'watched+watchlist' AS lists FROM watched_items
      WHERE EXISTS (SELECT 1 FROM watchlist_items l
                     WHERE l.user_id = watched_items.user_id AND l.item_id = watched_items.item_id)
     UNION ALL
     SELECT user_id, item_id, 'watched+watching' FROM watched_items
      WHERE EXISTS (SELECT 1 FROM currently_watching c
                     WHERE c.user_id = watched_items.user_id AND c.item_id = watched_items.item_id)
     UNION ALL
     SELECT user_id, item_id, 'watchlist+watching' FROM watchlist_items
      WHERE EXISTS (SELECT 1 FROM currently_watching c
                     WHERE c.user_id = watchlist_items.user_id AND c.item_id = watchlist_items.item_id)`
  );
}

module.exports = {
  LIST_TABLES,
  LIST_NAMES,
  ensureListTables,
  claimForList,
  claimForImport,
  alreadyWatched,
  finaliseWatchlistImport,
  reconcileLists,
  renamePvodToVod,
  purgeNegativeLookups,
  findListOverlaps,
};
