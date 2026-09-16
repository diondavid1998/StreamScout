// Entry point — creates the real database, wires up the app, and starts listening.
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { ensureCatalogTables } = require('./catalogCache');
const { ensureListTables, reconcileLists, renamePvodToVod, purgeNegativeLookups } = require('./lists');
const { createApp } = require('./app');

const PORT = process.env.PORT || 4000;

const db = new sqlite3.Database(process.env.DB_PATH || './db.sqlite', (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Bootstrap schema.
//
// All of this runs inside db.serialize(). node-sqlite3 executes queued
// statements in parallel by default, so without it the PRAGMA below could read
// the users table before the CREATE above had finished. It then saw no columns,
// ran every migration, and ALTERing in `languages` — which the CREATE already
// added — threw `duplicate column name`. That surfaces as an unhandled 'error'
// event on the statement, which takes the process down: roughly one in four
// first boots died. The runs that survived sometimes lost the unique-email
// index instead, because it was created before the email column existed.
db.serialize(() => {
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  platforms TEXT DEFAULT '[]',
  languages TEXT DEFAULT '[]'
)`);

db.all('PRAGMA table_info(users)', [], (err, columns) => {
  if (err || !Array.isArray(columns)) return;
  // A second serialize(): this callback fires after the outer one has already
  // returned, so anything queued here is back in parallel mode. Without it the
  // unique-email index was created before ALTER TABLE had added the email
  // column, and 9 of 12 fresh boots lost the index with a logged warning.
  db.serialize(() => {
  // Every ALTER carries a callback. A db.run() with no callback emits an
  // unhandled 'error' event on failure, which is fatal; a bad migration should
  // be a logged warning, not a crash loop.
  const addColumn = (name, ddl) => {
    if (columns.some((col) => col.name === name)) return;
    db.run(`ALTER TABLE users ADD COLUMN ${ddl}`, (alterErr) => {
      if (alterErr) console.warn(`Could not add users.${name}: ${alterErr.message}`);
    });
  };
  addColumn('languages', "languages TEXT DEFAULT '[]'");
  addColumn('email', 'email TEXT');
  addColumn('profile_pic', 'profile_pic TEXT');
  addColumn('token_version', 'token_version INTEGER NOT NULL DEFAULT 0');

  // Password reset resolves an account by email, so two accounts sharing one
  // address makes that flow ambiguous — it would always reset whichever row
  // SQLite reached first. The partial index ignores NULLs, since email is
  // optional. Existing duplicates must be cleared before it can be created;
  // log and carry on rather than refusing to boot.
  db.run(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL',
    (indexErr) => {
      if (!indexErr) return;
      console.warn(
        `Could not enforce unique emails: ${indexErr.message}. ` +
          'Resolve duplicate email addresses in the users table, then restart.'
      );
    }
  );
  });
});

db.run(`CREATE TABLE IF NOT EXISTS watched_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  media_type TEXT,
  title TEXT,
  poster_url TEXT,
  watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS watchlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  media_type TEXT,
  title TEXT,
  poster_url TEXT,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);
});

// Held onto rather than fired and forgotten: the lookup-cache purge below needs
// `title_lookup_cache` to exist, and that table is created here.
const catalogTablesReady = ensureCatalogTables(db).catch((error) => {
  console.error('Failed to initialize catalog cache tables:', error);
  throw error;
});
catalogTablesReady.catch(() => {});

// The three lists are exclusive, and until that rule was centralised it was
// enforced in some write paths and not others — so existing databases hold
// titles sitting in two lists at once. Repaired once, then never again.
ensureListTables(db)
  .then(async () => {
    // Before the overlap repair, because both write to the same ledger and the
    // rename has to land whether or not the repair has already run.
    const renamed = await renamePvodToVod(db);
    if (renamed?.users) {
      console.log(`[lists] moved ${renamed.users} platform selection(s) from pvod to vod`);
    }
  })
  .then(() => reconcileLists(db))
  .then((repaired) => {
    if (repaired) {
      console.log(
        `[lists] repaired overlapping rows: ${repaired.watchlist} from the watchlist, ` +
        `${repaired.watching} from currently watching`
      );
    }
  })
  .catch((error) => {
    console.error('Failed to initialize list tables:', error);
  })
  // Separate chain, and deliberately after both table sets exist: this one
  // reads the repair ledger (list tables) and writes the lookup cache (catalog
  // tables). Its own catch, so a failure here is not reported as the list
  // tables failing to initialise.
  .then(() => catalogTablesReady)
  .then(() => purgeNegativeLookups(db))
  .then((purged) => {
    if (purged?.purged) {
      console.log(
        `[lookup] cleared ${purged.purged} remembered miss(es) so the corrected ` +
        'title matcher can search for them again'
      );
    }
  })
  .catch((error) => {
    console.error('Failed to purge remembered title lookups:', error);
  });

// No scheduled refresh runs here on purpose. TMDB is called when data has never
// been fetched, or when the Refresh Catalog button asks for it — never on a
// timer. See the note above AUTO_SYNC_MS in catalogCache.js.

const app = createApp(db);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
