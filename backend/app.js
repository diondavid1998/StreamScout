'use strict';

/**
 * createApp(db) — returns a configured Express app without starting the server.
 * This allows integration tests to inject an in-memory / temp SQLite instance.
 */

require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const {
  ensureScopeSynced,
  readCachedCatalog,
  getWatchlistItemsWithAvailability,
  hydrateSavedTitleRatings,
  buildScopeKey,
  syncScope,
  withTransaction,
  invalidateWatchlistAvailability,
} = require('./catalogCache');
const { getTitleDetails, ensureAnalyticsDetails } = require('./titleCache');
const {
  listCurrentlyWatching,
  addToCurrentlyWatching,
  removeFromCurrentlyWatching,
  clearCurrentlyWatching,
  markCaughtUp,
  refreshSeriesSchedules,
  ensureSeriesDetails,
  seriesTmdbId,
} = require('./currentlyWatching');
const { readExport, filmKey } = require('./letterboxd');
const { computeAnalytics } = require('./analytics');
const { searchTitleOnTmdb, searchCatalog, fetchTitlesByPerson } = require('./movieService');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable must be set');
}
const DEFAULT_REGION = 'US';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// In-flight TMDB searches during an import. TMDB's published ceiling is well
// above this; the limit is here so a large import cannot starve the catalog
// sync running alongside it.
const IMPORT_LOOKUP_CONCURRENCY = 8;

// Titles accepted per /import/letterboxd call. Raised from 50 now that lookups
// run in parallel: the per-request overhead (auth, round trip) is paid once per
// batch, and halving the number of batches halves it.
const MAX_IMPORT_BATCH = 100;

// How long a failed title lookup stays cached.
//
// A resolved title is correct forever, so hits never expire. A miss is only
// evidence that TMDB had nothing *at the time* — the service may have been
// down, rate-limited, or simply not carrying the title yet. Caching those
// permanently meant a row that failed once could never resolve on any future
// import, however many times the list was re-uploaded. Two weeks is long
// enough that repeat imports stay cheap and short enough that a title added
// to TMDB gets picked up.
const NEGATIVE_LOOKUP_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// ── Small promise wrappers over the sqlite3 callback API ────────────────────

function getRow(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  );
}

function getRows(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  );
}

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); })
  );
}

/**
 * Mint a session token. `tokenVersion` is compared against the stored column on
 * every authenticated request — bumping it in the database invalidates every
 * token issued before, which is how a password change ends other sessions.
 */
function signUserToken({ id, username, tokenVersion = 0 }) {
  return jwt.sign({ id, username, tokenVersion: tokenVersion || 0 }, JWT_SECRET, {
    expiresIn: '30d',
  });
}

/**
 * Kick rating hydration for a user's saved titles without blocking the response.
 * Locked per user and a no-op once cached, so calling it speculatively is cheap.
 */
function warmSavedRatings(db, userId) {
  hydrateSavedTitleRatings(db, userId).catch((e) =>
    console.error(`[ratings] saved-title hydration failed for user ${userId}:`, e.message)
  );
}

/** Run `mapper` over `items`, never more than `concurrency` in flight. */
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await mapper(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

/** Stable cache key for a Letterboxd row. */
function lookupKeyFor(name, year) {
  return `${String(name).toLowerCase().replace(/\s+/g, ' ').trim()}|${year}`;
}

/**
 * Resolve a batch of Letterboxd rows to TMDB items.
 *
 * Reads every already-resolved row out of `title_lookup_cache` in one query,
 * searches TMDB only for what is left — in parallel, since each lookup is an
 * independent network call — then writes the new results back in one
 * transaction. The previous version searched strictly one title at a time and
 * slept 125ms between them, so a 50-title batch could not finish in under six
 * seconds no matter how fast TMDB answered.
 *
 * Resolved titles are cached forever; a definitive "no such film" only for
 * NEGATIVE_LOOKUP_TTL_MS. A title TMDB could not be reached for is cached under
 * neither rule — it comes back as LOOKUP_UNAVAILABLE so callers can leave it
 * outstanding and ask again rather than recording an outage as an answer.
 */
/**
 * Stands in for a match when TMDB could not be reached, so a failed call is
 * never mistaken for the film not existing.
 */
const LOOKUP_UNAVAILABLE = Symbol('lookup-unavailable');

async function resolveImportBatch(db, batch) {
  const keys = batch.map(({ name, year }) => lookupKeyFor(name, year));
  const uniqueKeys = [...new Set(keys)];

  const resolved = new Map();
  if (uniqueKeys.length) {
    const placeholders = uniqueKeys.map(() => '?').join(',');
    const cachedRows = await getRows(
      db,
      `SELECT lookup_key, item_id, media_type, title, poster_url
         FROM title_lookup_cache
        WHERE lookup_key IN (${placeholders})
          AND (item_id IS NOT NULL OR resolved_at > ?)`,
      [...uniqueKeys, new Date(Date.now() - NEGATIVE_LOOKUP_TTL_MS).toISOString()]
    );
    for (const row of cachedRows) {
      resolved.set(
        row.lookup_key,
        row.item_id
          ? { itemId: row.item_id, mediaType: row.media_type, title: row.title, posterUrl: row.poster_url }
          : null
      );
    }
  }

  const misses = batch.filter((item, i) => !resolved.has(keys[i]));
  const seen = new Set();
  const toSearch = misses.filter(({ name, year }) => {
    const key = lookupKeyFor(name, year);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (toSearch.length) {
    const found = await mapWithConcurrency(toSearch, IMPORT_LOOKUP_CONCURRENCY, async ({ name, year }) => {
      try {
        return await searchTitleOnTmdb(name, year);
      } catch {
        // Any throw at all. A search that simply found nothing returns null, so
        // an exception only ever means the answer never arrived.
        return LOOKUP_UNAVAILABLE;
      }
    });

    const now = new Date().toISOString();
    await withTransaction(db, async () => {
      for (let i = 0; i < toSearch.length; i++) {
        const key = lookupKeyFor(toSearch[i].name, toSearch[i].year);
        if (found[i] === LOOKUP_UNAVAILABLE) {
          // Deliberately not written to the cache: there is nothing to record.
          resolved.set(key, LOOKUP_UNAVAILABLE);
          continue;
        }
        const hit = found[i] || null;
        resolved.set(key, hit);
        await runSql(
          db,
          `INSERT OR REPLACE INTO title_lookup_cache
             (lookup_key, item_id, media_type, title, poster_url, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [key, hit?.itemId ?? null, hit?.mediaType ?? null, hit?.title ?? null, hit?.posterUrl ?? null, now]
        );
      }
    });
  }

  return keys.map((key) => resolved.get(key) ?? null);
}

/** Split a comma-separated query parameter into a clean list of values. */
function parseCsvParam(value) {
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Comparator for the in-memory watchlist view. Mirrors buildSortExpression in
 * catalogCache.js so the same sort option means the same thing whether the
 * results come from the cached catalog or from the watchlist path.
 */
function compareWatchlistItems(sortBy) {
  const byPopularity = (a, b) => (b.popularity || 0) - (a.popularity || 0);
  const byRating = (key) => (a, b) => {
    const delta = (b.sortableRatings?.[key] || 0) - (a.sortableRatings?.[key] || 0);
    return delta !== 0 ? delta : byPopularity(a, b);
  };

  switch (sortBy) {
    case 'title':
      return (a, b) => String(a.title || '').localeCompare(String(b.title || ''));
    case 'release_date':
      return (a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || ''));
    case 'release_date_asc':
      return (a, b) => {
        // Undated titles sort last, matching the SQL CASE expression.
        const left = a.releaseDate || '';
        const right = b.releaseDate || '';
        if (!left && !right) return 0;
        if (!left) return 1;
        if (!right) return -1;
        return left.localeCompare(right);
      };
    case 'recently_added':
      return (a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || ''));
    case 'tmdb':
      return byRating('tmdb');
    case 'imdb':
      return byRating('imdb');
    case 'rotten_tomatoes':
      return byRating('rottenTomatoes');
    case 'metacritic':
      return byRating('metacritic');
    case 'popularity':
    default:
      return byPopularity;
  }
}

function createEmailTransporter() {
  if (!process.env.EMAIL_FROM || !process.env.EMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_FROM, pass: process.env.EMAIL_PASS },
  });
}

async function sendResetEmail(toEmail, username, code) {
  const transporter = createEmailTransporter();
  if (!transporter) {
    console.log(`[DEV] Password reset code for ${toEmail}: ${code}`);
    return;
  }
  await transporter.sendMail({
    from: `"WhatsOn" <${process.env.EMAIL_FROM}>`,
    to: toEmail,
    subject: 'WhatsOn — Password Reset Code',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#e50914">WhatsOn</h2>
        <p>Hi ${username},</p>
        <p>Your password reset code is:</p>
        <h1 style="letter-spacing:8px;font-size:40px;color:#e50914;text-align:center">${code}</h1>
        <p>This code expires in <strong>15 minutes</strong>.</p>
        <p style="color:#999;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
      </div>`,
  });
}

function createApp(db, { disableRateLimit = false } = {}) {
  const app = express();

  app.set('trust proxy', 1);

  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        const normalised = (origin || '').replace(/\/+$/, '');
        if (!origin || allowedOrigins.includes(normalised)) {
          callback(null, true);
        } else {
          // Tagged so the error handler can answer 403 rather than 500. A
          // misconfigured FRONTEND_URL is the most common deploy mistake here,
          // and it should read as a rejection, not a server fault.
          const error = new Error(`CORS: origin ${origin} not allowed`);
          error.status = 403;
          callback(error);
        }
      },
      credentials: true,
    })
  );
  // The diary upload carries a whole Letterboxd export as JSON — five CSVs,
  // which for a five-figure watch history runs past 2 MB before escaping. This
  // parser is mounted first and scoped to that one path; express.json marks the
  // request as read, so the global 2 MB parser below skips a body it already
  // consumed and every other route keeps the smaller ceiling.
  app.use('/letterboxd/diary', express.json({ limit: '16mb' }));
  app.use(express.json({ limit: '2mb' }));

  const authLimiter = disableRateLimit
    ? (_req, _res, next) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 20,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many attempts. Please try again later.' },
      });
  const catalogLimiter = disableRateLimit
    ? (_req, _res, next) => next()
    : rateLimit({
        windowMs: 60 * 1000,
        max: 120,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many catalog requests. Please try again later.' },
      });

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/', (_req, res) => res.send('Backend is running'));

  // ── Register ──────────────────────────────────────────────────────────────
  app.post('/register', authLimiter, async (req, res) => {
    const { username, password, email } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 32) {
      return res.status(400).json({ error: 'Username must be 3–32 characters' });
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be 6–128 characters' });
    }
    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email ? email.trim().toLowerCase() : null;
    if (cleanEmail && !EMAIL_PATTERN.test(cleanEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    const hash = await bcrypt.hash(password, 10);
    db.run(
      'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
      [cleanUsername, hash, cleanEmail],
      function (err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE')) {
            // Both username and email are unique; say which one collided so the
            // user can act on it. Password reset resolves an account by email,
            // so a shared address would make that flow ambiguous.
            return res.status(400).json({
              error: /email/i.test(err.message)
                ? 'An account already uses that email address'
                : 'Username already exists',
            });
          }
          return res.status(500).json({ error: 'Registration failed' });
        }
        const token = signUserToken({ id: this.lastID, username: cleanUsername, tokenVersion: 0 });
        res.json({ token });
      }
    );
  });

  // ── Login ─────────────────────────────────────────────────────────────────
  app.post('/login', authLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    db.get('SELECT * FROM users WHERE username = ?', [username.trim().toLowerCase()], async (err, user) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const token = signUserToken({
        id: user.id,
        username: user.username,
        tokenVersion: user.token_version || 0,
      });
      res.json({ token });
    });
  });

  // ── Auth middleware ───────────────────────────────────────────────────────
  async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Missing authentication token' });
    }

    // Verified synchronously: an async callback passed to jwt.verify returns a
    // promise the library ignores, so anything thrown inside it would surface
    // as an unhandled rejection instead of a response.
    let user;
    try {
      user = jwt.verify(token, JWT_SECRET);
    } catch {
      // 401, not 403: this means "authenticate", and it is what both clients
      // key their sign-out-and-retry behaviour off.
      return res.status(401).json({ error: 'Invalid or expired authentication token' });
    }

    // A valid signature alone isn't enough — a token minted before a password
    // change must stop working. Compare the version it carries with the stored
    // one, which also catches tokens for accounts that have since been deleted.
    let row;
    try {
      row = await getRow(db, 'SELECT token_version FROM users WHERE id = ?', [user.id]);
    } catch {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(401).json({ error: 'Account no longer exists. Sign in again.' });
    }
    if ((user.tokenVersion || 0) !== (row.token_version || 0)) {
      return res.status(401).json({ error: 'Session ended. Sign in again.' });
    }

    req.user = user;
    next();
  }

  // ── Account GET ───────────────────────────────────────────────────────────
  app.get('/account', authenticateToken, (req, res) => {
    db.get('SELECT id, username, email, profile_pic FROM users WHERE id = ?', [req.user.id], (err, row) => {
      if (err || !row) return res.status(500).json({ error: 'Database error' });
      res.json({
        id: row.id,
        username: row.username,
        email: row.email || '',
        profilePic: row.profile_pic || null,
      });
    });
  });

  // ── Account PUT ───────────────────────────────────────────────────────────
  app.put('/account', authenticateToken, async (req, res) => {
    const { username, email, password, profilePic } = req.body || {};
    const updates = [];
    const values = [];
    let usernameChangedTo = null;
    // Set when the password changes: every previously issued token carries the
    // old value and stops verifying, so changing a password ends other sessions.
    let nextTokenVersion = null;

    if (username !== undefined) {
      const cleaned = String(username).trim().toLowerCase();
      if (cleaned.length < 3 || cleaned.length > 32) {
        return res.status(400).json({ error: 'Username must be 3–32 characters' });
      }
      updates.push('username = ?');
      values.push(cleaned);
      usernameChangedTo = cleaned;
    }

    if (email !== undefined) {
      if (email && !EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      updates.push('email = ?');
      values.push(email ? email.trim().toLowerCase() : null);
    }

    if (profilePic !== undefined) {
      if (profilePic && !profilePic.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Profile picture must be a valid image data URI' });
      }
      updates.push('profile_pic = ?');
      values.push(profilePic || null);
    }

    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
        return res.status(400).json({ error: 'Password must be 6–128 characters' });
      }
      const hash = await bcrypt.hash(password, 10);
      updates.push('password = ?');
      values.push(hash);

      let current;
      try {
        current = await getRow(db, 'SELECT token_version FROM users WHERE id = ?', [req.user.id]);
      } catch {
        return res.status(500).json({ error: 'Update failed' });
      }
      if (!current) {
        return res.status(401).json({ error: 'Account no longer exists. Sign in again.' });
      }
      nextTokenVersion = (current.token_version || 0) + 1;
      updates.push('token_version = ?');
      values.push(nextTokenVersion);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    values.push(req.user.id);

    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values, function (err) {
      if (err) {
        if (err.message && err.message.includes('UNIQUE')) {
          return res.status(400).json({
            error: /email/i.test(err.message)
              ? 'An account already uses that email address'
              : 'Username already taken',
          });
        }
        return res.status(500).json({ error: 'Update failed' });
      }
      if (this.changes === 0) {
        return res.status(401).json({ error: 'Account no longer exists. Sign in again.' });
      }
      const response = { success: true };
      // Re-issue whenever a claim this token carries has changed, so the caller
      // isn't logged out by the change it just made.
      if (usernameChangedTo || nextTokenVersion !== null) {
        response.token = signUserToken({
          id: req.user.id,
          username: usernameChangedTo || req.user.username,
          tokenVersion: nextTokenVersion !== null ? nextTokenVersion : req.user.tokenVersion,
        });
      }
      res.json(response);
    });
  });

  // ── Platforms GET ─────────────────────────────────────────────────────────
  app.get('/platforms', authenticateToken, (req, res) => {
    db.get('SELECT platforms, languages FROM users WHERE id = ?', [req.user.id], (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!row) {
        return res.status(401).json({ error: 'Account no longer exists. Sign in again.' });
      }
      let platforms = [];
      let languages = [];
      try { platforms = JSON.parse(row.platforms); } catch { platforms = []; }
      try { languages = JSON.parse(row.languages || '[]'); } catch { languages = []; }
      res.json({ platforms, languages });
    });
  });

  // ── Platforms PUT ─────────────────────────────────────────────────────────
  app.put('/platforms', authenticateToken, (req, res) => {
    const { platforms, languages } = req.body || {};
    if (!Array.isArray(platforms)) {
      return res.status(400).json({ error: 'Platforms must be an array' });
    }
    if (languages !== undefined && !Array.isArray(languages)) {
      return res.status(400).json({ error: 'Languages must be an array' });
    }
    // UPDATE, not upsert: a token for a deleted account must not recreate it.
    db.run(
      'UPDATE users SET platforms = ?, languages = ? WHERE id = ?',
      [
        JSON.stringify(platforms),
        JSON.stringify(Array.isArray(languages) ? languages : []),
        req.user.id,
      ],
      function (err) {
        if (err) return res.status(500).json({ error: 'Update failed' });
        if (this.changes === 0) {
          return res.status(401).json({ error: 'Account no longer exists. Sign in again.' });
        }
        res.json({ success: true });
      }
    );
  });

  // ── Title details (cast, crew, etc.) ─────────────────────────────────────
  app.get('/titles/:mediaType/:tmdb_id/details', authenticateToken, async (req, res) => {
    const { mediaType } = req.params;
    if (!['movie', 'tv'].includes(mediaType)) {
      return res.status(400).json({ error: 'mediaType must be movie or tv' });
    }
    // This value becomes a path segment in the outbound TMDB URL. Express
    // decodes %2F in route params and the URL parser then resolves `..`, so an
    // unvalidated id lets a caller steer the request to another TMDB endpoint.
    const tmdb_id = parseInt(req.params.tmdb_id, 10);
    if (!Number.isInteger(tmdb_id) || tmdb_id <= 0 || String(tmdb_id) !== req.params.tmdb_id) {
      return res.status(400).json({ error: 'tmdb_id must be a positive integer' });
    }
    try {
      // Served from title_details_cache whenever it has been fetched before —
      // which, after the first open, is always. TMDB is only asked again when
      // the refresh button explicitly asks it to be.
      res.json(await getTitleDetails(db, mediaType, tmdb_id));
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch title details', details: e.message });
    }
  });

  // ── Person filmography on streaming ──────────────────────────────────────
  app.get('/titles/person/:personId', authenticateToken, (req, res) => {
    const personId = parseInt(req.params.personId, 10);
    if (!personId) return res.status(400).json({ error: 'Invalid personId' });
    db.get('SELECT platforms FROM users WHERE id = ?', [req.user.id], async (err, row) => {
      if (err || !row) return res.status(500).json({ error: 'Database error' });
      let platforms = [];
      try { platforms = JSON.parse(row.platforms || '[]'); } catch { /* ignore */ }
      try {
        const items = await fetchTitlesByPerson(personId, platforms);
        res.json({ items });
      } catch (e) {
        res.status(500).json({ error: 'Failed to fetch person titles', details: e.message });
      }
    });
  });

  // ── Catalog status ────────────────────────────────────────────────────────
  app.get('/catalog-status', catalogLimiter, authenticateToken, (req, res) => {
    db.get('SELECT platforms, languages FROM users WHERE id = ?', [req.user.id], (err, row) => {
      if (err || !row) return res.status(500).json({ error: 'Database error' });
      let platforms = [];
      let languages = [];
      try { platforms = JSON.parse(row.platforms || '[]'); } catch { /* ignore */ }
      try { languages = JSON.parse(row.languages || '[]'); } catch { /* ignore */ }
      const scopeKey = buildScopeKey(platforms, DEFAULT_REGION, languages);
      db.get(
        'SELECT last_synced_at, item_count FROM catalog_cache_state WHERE scope_key = ?',
        [scopeKey],
        (err2, state) => {
          if (err2) return res.status(500).json({ error: 'Database error' });
          res.json({
            lastSyncedAt: state?.last_synced_at || null,
            itemCount: state?.item_count || 0,
          });
        }
      );
    });
  });

  // ── Catalog force-refresh ─────────────────────────────────────────────────
  app.post('/catalog/refresh', catalogLimiter, authenticateToken, (req, res) => {
    db.get('SELECT platforms, languages FROM users WHERE id = ?', [req.user.id], (err, row) => {
      if (err || !row) return res.status(500).json({ error: 'Database error' });
      let platforms = [], languages = [];
      try { platforms = JSON.parse(row.platforms || '[]'); } catch { /* ignore */ }
      try { languages = JSON.parse(row.languages || '[]'); } catch { /* ignore */ }
      if (platforms.length === 0) {
        return res.status(400).json({ error: 'No streaming services configured. Add services first.' });
      }
      const scopeKey = buildScopeKey(platforms, DEFAULT_REGION, languages);
      // Invalidate cache so syncScope treats it as stale, then fire in background
      db.run(
        'UPDATE catalog_cache_state SET last_synced_at = NULL WHERE scope_key = ?',
        [scopeKey],
        (err2) => {
          if (err2) return res.status(500).json({ error: 'Database error' });
          // This button is now the only thing in the app that calls TMDB for
          // data it already has. So it has to refresh everything that can go
          // stale, not just the catalog: the saved-title availability rows and
          // the schedules behind Currently Watching go with it.
          const userId = req.user.id;
          Promise.all([
            syncScope(db, { platforms, languages, region: DEFAULT_REGION, forceRatingsRefresh: true }),
            invalidateWatchlistAvailability(db, userId),
            refreshSeriesSchedules(db, userId),
          ]).catch((e) => console.error('[catalog/refresh] background sync failed:', e));
          res.json({ success: true, message: 'Catalog refresh started' });
        }
      );
    });
  });

  // ── Watched list GET ──────────────────────────────────────────────────────
  app.get('/watched', authenticateToken, (req, res) => {
    db.all(
      'SELECT * FROM watched_items WHERE user_id = ? ORDER BY watched_at DESC',
      [req.user.id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({
          items: (rows || []).map((r) => ({
            itemId: r.item_id,
            mediaType: r.media_type,
            title: r.title,
            posterUrl: r.poster_url,
            watchedAt: r.watched_at,
          })),
        });
      }
    );
  });

  // ── Watched list POST ─────────────────────────────────────────────────────
  app.post('/watched', authenticateToken, (req, res) => {
    const { itemId, mediaType, title, posterUrl } = req.body || {};
    if (!itemId) return res.status(400).json({ error: 'itemId required' });
    db.run(
      'INSERT OR IGNORE INTO watched_items (user_id, item_id, media_type, title, poster_url) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, itemId, mediaType || null, title || null, posterUrl || null],
      function (err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        // Finishing a show is how it leaves Currently Watching. The three lists
        // are exclusive, so marking it watched has to take it out of the one it
        // was in — otherwise it would sit there being told about episodes of a
        // show the user has already finished.
        db.run('DELETE FROM currently_watching WHERE user_id = ? AND item_id = ?', [req.user.id, itemId]);
        res.json({ success: true, added: this.changes > 0 });
      }
    );
  });

  // ── Watched list CLEAR ────────────────────────────────────────────────────
  // Registered before the /:item_id route so "/watched" is not read as an item.
  app.delete('/watched', authenticateToken, (req, res) => {
    db.run('DELETE FROM watched_items WHERE user_id = ?', [req.user.id], function (err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ success: true, removed: this.changes });
    });
  });

  // ── Watched list DELETE ───────────────────────────────────────────────────
  app.delete('/watched/:item_id', authenticateToken, (req, res) => {
    const itemId = decodeURIComponent(req.params.item_id);
    db.run(
      'DELETE FROM watched_items WHERE user_id = ? AND item_id = ?',
      [req.user.id, itemId],
      function (err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true });
      }
    );
  });

  /**
   * Fill in `item_id` for diary rows whose film is already known.
   *
   * `title_lookup_cache` is shared across every user and never expires for a
   * hit, so a film someone has resolved once never needs resolving again — but
   * an import writes fresh rows with a NULL `item_id`, which made every
   * re-upload look like a full backfill. Re-uploading a 1,782-film export
   * reported 1,782 films to look up when only the handful added since the last
   * export were actually unknown.
   *
   * The cost was never TMDB calls — those were already served from cache — it
   * was thirty round trips of pure database work and a progress bar implying
   * the whole history was being fetched again.
   *
   * Pure SQL, no network. Safe to call as often as you like.
   */
  async function adoptCachedResolutions(db, userId) {
    const unresolved = await getRows(
      db,
      `SELECT DISTINCT film_key, name, year FROM letterboxd_entries
        WHERE user_id = ? AND item_id IS NULL`,
      [userId]
    );
    if (!unresolved.length) return 0;

    // film_key and the lookup key are built by different functions, so the two
    // are mapped here rather than joined on in SQL.
    const byLookupKey = new Map();
    for (const row of unresolved) byLookupKey.set(lookupKeyFor(row.name, row.year), row.film_key);

    const keys = [...byLookupKey.keys()];
    const known = [];
    // SQLite's default parameter ceiling is 999; a large history needs chunking.
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500);
      const rows = await getRows(
        db,
        `SELECT lookup_key, item_id FROM title_lookup_cache
          WHERE lookup_key IN (${chunk.map(() => '?').join(',')})
            AND item_id IS NOT NULL`,
        chunk
      );
      known.push(...rows);
    }
    if (!known.length) return 0;

    await withTransaction(db, async () => {
      for (const row of known) {
        await runSql(
          db,
          'UPDATE letterboxd_entries SET item_id = ? WHERE user_id = ? AND film_key = ?',
          [row.item_id, userId, byLookupKey.get(row.lookup_key)]
        );
      }
    });
    return known.length;
  }

  // ── Letterboxd diary ──────────────────────────────────────────────────────
  //
  // The whole export in one upload. The client hands over every CSV it found;
  // this merges them, and the merged result *replaces* the user's diary, because
  // a fresh export is the complete truth about their history and anything left
  // from a previous upload is by definition stale.

  app.post('/letterboxd/diary', authenticateToken, async (req, res) => {
    const { files } = req.body || {};
    if (!Array.isArray(files) || !files.length) {
      return res.status(400).json({ error: 'files array required' });
    }
    if (files.length > 20) {
      return res.status(400).json({ error: 'Too many files — a Letterboxd export has fewer than twenty' });
    }

    let parsed;
    try {
      parsed = readExport(files);
    } catch (e) {
      return res.status(400).json({ error: 'Could not read those CSVs', details: e.message });
    }
    if (!parsed.entries.length && !parsed.watchlist.length) {
      return res.status(400).json({
        error: 'No films found. Upload the folder from your Letterboxd export, not a single file.',
        files: parsed.files,
      });
    }

    try {
      await withTransaction(db, async () => {
        await runSql(db, 'DELETE FROM letterboxd_entries WHERE user_id = ?', [req.user.id]);
        for (const entry of parsed.entries) {
          await runSql(
            db,
            `INSERT INTO letterboxd_entries
               (user_id, name, year, film_key, rating, watched_on, is_rewatch, tags_json, uri, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              req.user.id, entry.name, entry.year, filmKey(entry.name, entry.year),
              entry.rating, entry.watchedOn, entry.isRewatch,
              JSON.stringify(entry.tags), entry.uri, entry.source,
            ]
          );
        }
      });
    } catch (e) {
      console.error('[letterboxd] diary import failed:', e.message);
      return res.status(500).json({ error: 'Could not save your diary' });
    }

    // Before answering, adopt every resolution the shared cache already holds,
    // so `pending` counts films genuinely new to the service rather than films
    // new to this row.
    let adopted = 0;
    try {
      adopted = await adoptCachedResolutions(db, req.user.id);
    } catch (e) {
      // Not fatal: the resolve step would pick these up anyway, just slower.
      console.warn('[letterboxd] could not adopt cached resolutions:', e.message);
    }

    res.json({ success: true, ...parsed.stats, alreadyKnown: adopted, files: parsed.files });
  });

  // No date range. It filtered on watched_on while keeping undated rows, so
  // "2024 in review" would have answered with every undated film in the history
  // alongside the 2024 ones — and on a real export all but a few dozen films are
  // undated. A filter that silently keeps almost everything is worse than none.
  app.get('/analytics', authenticateToken, async (req, res) => {
    try {
      res.json(await computeAnalytics(db, req.user.id));
    } catch (e) {
      console.error('[analytics] failed:', e.message);
      res.status(500).json({ error: 'Could not build your analytics', details: e.message });
    }
  });

  /**
   * A film is outstanding until its *details* are cached, not merely until it
   * has a TMDB id.
   *
   * The distinction is the whole point of the lookup: genres, directors and
   * cast live in `title_details_cache`, and an id on its own contributes
   * nothing to the page. Ids arrive by two routes that skip the details — a
   * watched-list import, which caches ids as a side effect, and adoption of
   * another account's earlier work — so a history can be fully "resolved" by
   * id while every section that needs TMDB is still empty.
   *
   * Excluded are the films the lookup has already answered on for good: the
   * empty-string marker for a name TMDB has nothing under, and a `tv-` id,
   * which the film details cache will never hold. Both would otherwise be
   * retried on every batch forever.
   */
  const PENDING_FILM_FILTER = `
       FROM letterboxd_entries e
       LEFT JOIN title_details_cache d
              ON d.media_type = 'movie'
             AND ('movie-' || d.tmdb_id) = e.item_id
      WHERE e.user_id = ?
        AND d.tmdb_id IS NULL
        AND (e.item_id IS NULL OR e.item_id LIKE 'movie-%')`;

  async function countPendingFilms(userId) {
    const [{ pending = 0 } = {}] = await getRows(
      db,
      `SELECT COUNT(*) AS pending FROM (
         SELECT e.film_key ${PENDING_FILM_FILTER} GROUP BY e.film_key
       )`,
      [userId]
    );
    return pending;
  }

  /**
   * Fill in genre and people data for films the diary has never resolved.
   *
   * Deliberately batched and resumable rather than one long request: a large
   * history is thousands of films, and the client shows progress by calling
   * this until `pending` reaches zero. Nothing here runs on a timer — it only
   * happens because someone pressed the button.
   */
  app.post('/analytics/resolve', catalogLimiter, authenticateToken, async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.body?.limit, 10) || 60, 1), 200);
    try {
      // Another user may have resolved some of these since the import.
      await adoptCachedResolutions(db, req.user.id);

      const pendingRows = await getRows(
        db,
        `SELECT e.film_key, e.name, e.year, MAX(e.item_id) AS item_id
           ${PENDING_FILM_FILTER}
          GROUP BY e.film_key
          LIMIT ?`,
        [req.user.id, limit]
      );
      if (!pendingRows.length) {
        return res.json({ resolved: 0, failed: 0, pending: await countPendingFilms(req.user.id) });
      }

      // Rows that already carry an id skip the search and go straight to the
      // details fetch — that is the half of the work they are missing.
      const needsSearch = pendingRows.filter((row) => !row.item_id);
      const matches = needsSearch.length
        ? await resolveImportBatch(db, needsSearch.map(({ name, year }) => ({ name, year })))
        : [];

      for (let i = 0; i < needsSearch.length; i++) {
        const match = matches[i];
        // An outage is not an answer. Leaving the id NULL keeps the film in the
        // next batch instead of writing it off over a network blip.
        if (match === LOOKUP_UNAVAILABLE) continue;
        // A film TMDB genuinely has nothing for is marked with the empty string
        // so later batches move past it rather than retrying it forever.
        await runSql(
          db,
          'UPDATE letterboxd_entries SET item_id = ? WHERE user_id = ? AND film_key = ?',
          [match?.itemId || '', req.user.id, needsSearch[i].film_key]
        );
      }

      // Now the details behind every id in this batch, freshly searched or
      // adopted. Shared across every user, so a popular film is fetched once
      // for the whole service.
      const tmdbIds = new Set();
      const collectId = (itemId) => {
        const [type, id] = String(itemId || '').split('-');
        if (type === 'movie' && Number.isInteger(parseInt(id, 10))) tmdbIds.add(parseInt(id, 10));
      };
      for (const match of matches) {
        if (match && match !== LOOKUP_UNAVAILABLE && match.mediaType === 'movie') collectId(match.itemId);
      }
      for (const row of pendingRows) collectId(row.item_id);

      await mapWithConcurrency([...tmdbIds], IMPORT_LOOKUP_CONCURRENCY, async (tmdbId) => {
        try { await ensureAnalyticsDetails(db, tmdbId); } catch { /* one miss must not stop the batch */ }
      });

      // Counted from the database rather than from the calls, so `resolved`
      // means what the page will actually be able to show.
      const keys = pendingRows.map((row) => row.film_key);
      const [{ done = 0 } = {}] = await getRows(
        db,
        `SELECT COUNT(DISTINCT e.film_key) AS done
           FROM letterboxd_entries e
           JOIN title_details_cache d
             ON d.media_type = 'movie' AND ('movie-' || d.tmdb_id) = e.item_id
          WHERE e.user_id = ? AND e.film_key IN (${keys.map(() => '?').join(',')})`,
        [req.user.id, ...keys]
      );

      res.json({ resolved: done, failed: keys.length - done, pending: await countPendingFilms(req.user.id) });
    } catch (e) {
      console.error('[analytics/resolve] failed:', e.message);
      res.status(500).json({ error: 'Could not resolve titles', details: e.message });
    }
  });

  // ── Currently Watching ────────────────────────────────────────────────────
  // A third list, series only. Unlike the other two it has an opinion about
  // each row: what day new episodes land, and whether one has landed since the
  // user last said they were caught up.

  app.get('/currently-watching', authenticateToken, async (req, res) => {
    try {
      const onlyNew = req.query.new === '1' || req.query.new === 'true';
      res.json({ items: await listCurrentlyWatching(db, req.user.id, { onlyNew }) });
    } catch (e) {
      res.status(500).json({ error: 'Database error', details: e.message });
    }
  });

  app.post('/currently-watching', authenticateToken, async (req, res) => {
    const { itemId, title, posterUrl } = req.body || {};
    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({ error: 'itemId required' });
    }
    // Series only. A film has no next episode, so every column this list adds
    // would be dead weight on one — and the copy would have nothing to say.
    const tmdbId = seriesTmdbId(itemId);
    if (tmdbId === null) {
      return res.status(400).json({ error: 'Currently Watching is for TV series only' });
    }
    try {
      const added = await addToCurrentlyWatching(db, req.user.id, { itemId, title, posterUrl });
      // First fetch for a show nobody has looked at yet — the "never fetched"
      // case, not a refresh. Deliberately not awaited: the row is already in
      // the list, and the schedule line fills in on the next read.
      if (added) {
        ensureSeriesDetails(db, tmdbId).catch((e) =>
          console.warn(`[currently-watching] could not load tv-${tmdbId}: ${e.message}`)
        );
      }
      res.json({ success: true, added });
    } catch (e) {
      res.status(500).json({ error: 'Database error', details: e.message });
    }
  });

  // Registered before the /:item_id route so "/currently-watching" is not read
  // as an item id.
  app.delete('/currently-watching', authenticateToken, async (req, res) => {
    try {
      res.json({ success: true, removed: await clearCurrentlyWatching(db, req.user.id) });
    } catch (e) {
      res.status(500).json({ error: 'Database error', details: e.message });
    }
  });

  app.delete('/currently-watching/:item_id', authenticateToken, async (req, res) => {
    try {
      await removeFromCurrentlyWatching(db, req.user.id, decodeURIComponent(req.params.item_id));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Database error', details: e.message });
    }
  });

  // "I am caught up." Clears the badge until something airs after today.
  app.post('/currently-watching/:item_id/caught-up', authenticateToken, async (req, res) => {
    try {
      const updated = await markCaughtUp(db, req.user.id, decodeURIComponent(req.params.item_id));
      if (!updated) return res.status(404).json({ error: 'Not in Currently Watching' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Database error', details: e.message });
    }
  });

  // ── Forgot password ───────────────────────────────────────────────────────
  app.post('/auth/forgot-password', authLimiter, async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required' });
    // Respond immediately to prevent email enumeration
    res.json({ success: true, message: 'If an account with that email exists, a reset code has been sent.' });
    try {
      const user = await new Promise((resolve, reject) =>
        db.get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()], (err, row) =>
          err ? reject(err) : resolve(row)
        )
      );
      if (!user) return;
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const hash = await bcrypt.hash(code, 8);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await new Promise((resolve, reject) =>
        db.run('DELETE FROM reset_tokens WHERE user_id = ?', [user.id], (err) =>
          err ? reject(err) : resolve()
        )
      );
      await new Promise((resolve, reject) =>
        db.run(
          'INSERT INTO reset_tokens (user_id, token_hash, email, expires_at) VALUES (?, ?, ?, ?)',
          [user.id, hash, email.trim().toLowerCase(), expiresAt],
          (err) => (err ? reject(err) : resolve())
        )
      );
      await sendResetEmail(email.trim(), user.username, code);
    } catch (e) {
      console.error('Forgot password error:', e.message);
    }
  });

  // ── Reset password ────────────────────────────────────────────────────────
  app.post('/auth/reset-password', authLimiter, async (req, res) => {
    const { email, code, newPassword } = req.body || {};
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code, and new password are required' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 128) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    try {
      const user = await new Promise((resolve, reject) =>
        db.get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()], (err, row) =>
          err ? reject(err) : resolve(row)
        )
      );
      if (!user) return res.status(400).json({ error: 'Invalid or expired reset code' });

      const tokenRow = await new Promise((resolve, reject) =>
        db.get(
          `SELECT * FROM reset_tokens WHERE user_id = ? AND used = 0 AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1`,
          [user.id],
          (err, row) => (err ? reject(err) : resolve(row))
        )
      );
      if (!tokenRow) return res.status(400).json({ error: 'Invalid or expired reset code' });

      const codeMatch = await bcrypt.compare(String(code), tokenRow.token_hash);
      if (!codeMatch) return res.status(400).json({ error: 'Invalid or expired reset code' });

      // Atomically mark token as used BEFORE updating the password to prevent
      // race conditions where two concurrent requests both succeed.
      const claimed = await new Promise((resolve, reject) =>
        db.run(
          `UPDATE reset_tokens SET used = 1 WHERE id = ? AND used = 0`,
          [tokenRow.id],
          function (err) { err ? reject(err) : resolve(this.changes); }
        )
      );
      if (claimed === 0) return res.status(400).json({ error: 'Invalid or expired reset code' });

      const hash = await bcrypt.hash(newPassword, 10);
      // Bump token_version in the same statement: a reset is the one moment we
      // are most sure the user wants every other session terminated.
      await runSql(
        db,
        'UPDATE users SET password = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?',
        [hash, user.id]
      );
      res.json({ success: true, message: 'Password has been reset successfully.' });
    } catch (e) {
      console.error('Reset password error:', e.message);
      res.status(500).json({ error: 'Reset failed. Please try again.' });
    }
  });

  // ── Movies (catalog) ─────────────────────────────────────────────────────
  app.get('/movies', catalogLimiter, authenticateToken, async (req, res) => {
    const serviceFiltersFromQuery = parseCsvParam(req.query.serviceFilters);

    let row;
    try {
      row = await getRow(db, 'SELECT platforms, languages FROM users WHERE id = ?', [req.user.id]);
    } catch {
      return res.status(500).json({ error: 'Database error' });
    }
    // A valid token for an account that no longer exists is not a reason to
    // recreate the account — it is a reason to re-authenticate.
    if (!row) {
      return res.status(401).json({ error: 'Account no longer exists. Sign in again.' });
    }

    let platforms = [];
    let savedLanguages = [];
    try { platforms = JSON.parse(row.platforms || '[]'); } catch { platforms = []; }
    try { savedLanguages = JSON.parse(row.languages || '[]'); } catch { savedLanguages = []; }

    const scopePlatforms = platforms.length > 0 ? platforms : serviceFiltersFromQuery;

    const mediaType = req.query.mediaType || 'all';
    const sortBy = req.query.sortBy || 'popularity';
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 24), 100);
    const region = req.query.region || DEFAULT_REGION;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const explicitLanguageFilters = parseCsvParam(req.query.languageFilters);
    // A language preference saved in Settings is a statement about what the
    // user wants to see, so it filters the catalog on its own. An explicit
    // filter chosen on the catalog page is narrower and wins.
    const languageFilters = explicitLanguageFilters.length ? explicitLanguageFilters : savedLanguages;
    const genreFilters = parseCsvParam(req.query.genreFilters);
    const yearMin = req.query.yearMin ? parseInt(req.query.yearMin, 10) : null;
    const yearMax = req.query.yearMax ? parseInt(req.query.yearMax, 10) : null;
    const hideWatched = req.query.hideWatched === 'true';
    const watchlistOnly = req.query.watchlistOnly === 'true';
    // Narrows the watchlist view to titles currently streaming on the user's
    // platforms. Without it, `watchlistOnly` mirrors the whole watchlist.
    const streamingOnly = req.query.streamingOnly === 'true';

    // watchlistOnly: bypass the shared catalog and query TMDB directly for each
    // watchlist item, with a per-user 24-hour streaming-availability cache. This
    // ensures obscure titles (not in the popular snapshot) are still found.
    if (watchlistOnly) {
      let watchlistDetailRows = [];
      let watchedIds = new Set();
      try {
        watchlistDetailRows = await getRows(
          db,
          'SELECT item_id, title, poster_url, added_at FROM watchlist_items WHERE user_id = ?',
          [req.user.id]
        );
        if (hideWatched) {
          const watchedRows = await getRows(
            db,
            'SELECT item_id FROM watched_items WHERE user_id = ?',
            [req.user.id]
          );
          watchedIds = new Set(watchedRows.map((r) => r.item_id));
        }
      } catch {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!watchlistDetailRows.length) {
        return res.json({
          items: [],
          meta: {
            mediaType, sortBy, region,
            page: 1, pageSize: Number(limit), resultCount: 0, visibleCount: 0,
            totalPages: 1, hasMore: false, cacheMode: 'watchlist', streamingOnly,
          },
        });
      }

      try {
        let items = await getWatchlistItemsWithAvailability(
          db, req.user.id, watchlistDetailRows, scopePlatforms, region, { streamingOnly }
        );

        // In-memory filters
        if (serviceFiltersFromQuery.length) {
          items = items.filter((item) =>
            item.availableOnKeys.some((k) => serviceFiltersFromQuery.includes(k))
          );
        }
        if (genreFilters.length) {
          items = items.filter((item) => genreFilters.some((g) => item.genres.includes(g)));
        }
        if (languageFilters.length) {
          items = items.filter((item) => languageFilters.includes(item.originalLanguage));
        }
        if (yearMin) {
          items = items.filter((item) => item.year && parseInt(item.year, 10) >= yearMin);
        }
        if (yearMax) {
          items = items.filter((item) => item.year && parseInt(item.year, 10) <= yearMax);
        }
        if (hideWatched && watchedIds.size) {
          items = items.filter((item) => !watchedIds.has(item.id));
        }
        if (mediaType === 'movie' || mediaType === 'tv') {
          items = items.filter((item) => item.mediaType === mediaType);
        } else if (mediaType === 'documentary') {
          items = items.filter(
            (item) => Array.isArray(item.genres) && item.genres.includes('Documentary')
          );
        }

        items = [...items].sort(compareWatchlistItems(sortBy));

        const pageSize = Math.min(Math.max(1, Number(limit)), 100);
        const totalCount = items.length;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const currentPage = Math.min(Math.max(1, Number(page)), totalPages);
        const paged = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);

        // Availability resolution above is what fills in imdb_ids, so this is
        // the point at which the hydrator has something new to work with.
        warmSavedRatings(db, req.user.id);

        return res.json({
          items: paged,
          meta: {
            mediaType, sortBy, region,
            page: currentPage, pageSize,
            resultCount: totalCount,
            visibleCount: paged.length,
            totalPages,
            hasMore: currentPage < totalPages,
            cacheMode: 'watchlist',
            streamingOnly,
          },
        });
      } catch (e) {
        return res.status(500).json({ error: 'Failed to load watchlist', details: e.message });
      }
    }

    try {
      const scopeKey = await ensureScopeSynced(db, {
        platforms: scopePlatforms,
        languages: savedLanguages,
        region,
      });
      const catalog = await readCachedCatalog(db, {
        scopeKey,
        mediaType,
        sortBy,
        page: Number(page),
        pageSize: Number(limit),
        serviceFilters: serviceFiltersFromQuery,
        languageFilters,
        genreFilters,
        yearMin,
        yearMax,
        excludeWatchedForUserId: hideWatched ? req.user.id : null,
      });
      warmSavedRatings(db, req.user.id);
      res.json(catalog);
    } catch (e) {
      res.status(500).json({ error: 'Failed to load cached catalog', details: e.message });
    }
  });

  // ── Watchlist GET ─────────────────────────────────────────────────────────
  app.get('/watchlist', authenticateToken, (req, res) => {
    db.all(
      'SELECT * FROM watchlist_items WHERE user_id = ? ORDER BY added_at DESC',
      [req.user.id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({
          items: (rows || []).map((r) => ({
            itemId: r.item_id,
            mediaType: r.media_type,
            title: r.title,
            posterUrl: r.poster_url,
            addedAt: r.added_at,
          })),
        });
      }
    );
  });

  // ── Watchlist POST ────────────────────────────────────────────────────────
  app.post('/watchlist', authenticateToken, (req, res) => {
    const { itemId, mediaType, title, posterUrl } = req.body || {};
    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({ error: 'itemId required' });
    }
    db.run(
      `INSERT OR IGNORE INTO watchlist_items (user_id, item_id, media_type, title, poster_url) VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, itemId, mediaType || null, title || null, posterUrl || null],
      function (err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        // Deliberately moving a show back to "later" takes it out of the run.
        db.run('DELETE FROM currently_watching WHERE user_id = ? AND item_id = ?', [req.user.id, itemId]);
        res.json({ success: true, added: this.changes > 0 });
      }
    );
  });

  // ── Watchlist CLEAR ───────────────────────────────────────────────────────
  app.delete('/watchlist', authenticateToken, (req, res) => {
    db.run('DELETE FROM watchlist_items WHERE user_id = ?', [req.user.id], function (err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      // Drop the availability cache too, or cleared titles resurface in the
      // "From watchlist" view until their 24-hour TTL expires.
      db.run('DELETE FROM watchlist_streaming_cache WHERE user_id = ?', [req.user.id]);
      res.json({ success: true, removed: this.changes });
    });
  });

  // ── Watchlist DELETE ──────────────────────────────────────────────────────
  app.delete('/watchlist/:item_id', authenticateToken, (req, res) => {
    const itemId = decodeURIComponent(req.params.item_id);
    db.run(
      'DELETE FROM watchlist_items WHERE user_id = ? AND item_id = ?',
      [req.user.id, itemId],
      function (err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        // Also remove any stale streaming-cache row so the item cannot resurface
        // in the "From Watchlist" catalog view after deletion.
        db.run(
          'DELETE FROM watchlist_streaming_cache WHERE user_id = ? AND item_id = ?',
          [req.user.id, itemId]
        );
        res.json({ success: true });
      }
    );
  });

  // ── Title search ────────────────────────────────────────────────────────────
  // Live TMDB search: returns up to 20 results for any movie/show, annotated with
  // streaming availability on the user's platforms. Platform-available titles sort
  // first; results not on any service still appear so users can add to watchlist.
  app.get('/search', authenticateToken, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ items: [] });

    db.get('SELECT platforms FROM users WHERE id = ?', [req.user.id], async (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      let platforms = [];
      try { platforms = JSON.parse(row?.platforms || '[]'); } catch {}
      const region = req.query.region || 'US';
      try {
        const items = await searchCatalog(q, { platforms, region });
        return res.json({ items });
      } catch (e) {
        return res.status(500).json({ error: 'Search failed', details: e.message });
      }
    });
  });

  // ── Letterboxd CSV preview ────────────────────────────────────────────────
  // Parses raw CSV text, detects type (watched vs watchlist), returns item list.
  app.post('/import/letterboxd/preview', authenticateToken, (req, res) => {
    const { csvText, fileName } = req.body || {};
    if (!csvText || typeof csvText !== 'string') {
      return res.status(400).json({ error: 'csvText required' });
    }

    function parseCSVRow(line) {
      const fields = [];
      let field = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
          fields.push(field.trim());
          field = '';
        } else {
          field += ch;
        }
      }
      fields.push(field.trim());
      return fields;
    }

    const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
    if (lines.length < 2) return res.status(400).json({ error: 'CSV appears empty' });

    const headers = parseCSVRow(lines[0]).map((h) => h.toLowerCase().replace(/"/g, '').trim());
    const nameIdx = headers.indexOf('name');
    const yearIdx = headers.indexOf('year');
    if (nameIdx === -1 || yearIdx === -1) {
      return res.status(400).json({ error: 'CSV must have Name and Year columns' });
    }

    // Detect type: use filename as primary signal since watched.csv and
    // watchlist.csv share identical column headers. Fall back to rating column.
    const lowerFileName = (fileName || '').toLowerCase();
    let importType;
    if (lowerFileName.includes('watchlist')) {
      importType = 'watchlist';
    } else if (lowerFileName.includes('watched') || lowerFileName.includes('diary')) {
      importType = 'watched';
    } else {
      importType = headers.includes('rating') ? 'watched' : 'watchlist';
    }

    const items = lines
      .slice(1)
      .filter((l) => l.trim())
      .map((line) => {
        const cols = parseCSVRow(line);
        const name = (cols[nameIdx] || '').replace(/^"|"$/g, '').trim();
        const year = parseInt(cols[yearIdx] || '0', 10);
        return name && year ? { name, year } : null;
      })
      .filter(Boolean);

    res.json({ importType, count: items.length, items });
  });

  // ── Letterboxd batch import ───────────────────────────────────────────────
  // Accepts up to MAX_IMPORT_BATCH items per call. Client loops until all items
  // are processed.
  //
  // The two lists import with different semantics, matching what each one means:
  //   watchlist — a snapshot of what you still intend to watch, so an upload
  //               REPLACES it. Titles you removed on Letterboxd should not
  //               linger here. The client sets `replaceExisting` on the first
  //               batch only; later batches append to what it just seeded.
  //   watched   — a history, which only ever grows, so an upload MERGES. Rows
  //               already present are left alone by INSERT OR IGNORE.
  app.post('/import/letterboxd', authenticateToken, async (req, res) => {
    const { items, importType, replaceExisting } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array required' });
    }
    if (!['watched', 'watchlist'].includes(importType)) {
      return res.status(400).json({ error: 'importType must be watched or watchlist' });
    }
    if (replaceExisting === true && importType !== 'watchlist') {
      return res.status(400).json({ error: 'replaceExisting is only valid for a watchlist import' });
    }

    let replaced = 0;
    if (replaceExisting === true) {
      try {
        await withTransaction(db, async () => {
          const result = await runSql(db, 'DELETE FROM watchlist_items WHERE user_id = ?', [req.user.id]);
          replaced = result.changes;
          // The availability cache is keyed per user and item; stale rows would
          // otherwise keep answering for titles no longer on the list.
          await runSql(db, 'DELETE FROM watchlist_streaming_cache WHERE user_id = ?', [req.user.id]);
        });
      } catch {
        return res.status(500).json({ error: 'Could not clear the existing watchlist' });
      }
    }

    const batch = items.slice(0, MAX_IMPORT_BATCH);
    const table = importType === 'watched' ? 'watched_items' : 'watchlist_items';
    const timeCol = importType === 'watched' ? 'watched_at' : 'added_at';

    const usable = batch.filter(({ name, year }) => name && year);
    let notFound = batch.length - usable.length;
    let matched = 0;

    let results;
    try {
      results = await resolveImportBatch(db, usable);
    } catch (err) {
      console.error('[import] batch lookup failed:', err.message);
      return res.status(502).json({ error: 'Could not reach the title database' });
    }

    // One transaction for the whole batch. Standalone INSERTs meant one commit
    // — and one disk sync — per title.
    try {
      await withTransaction(db, async () => {
        const imported = [];
        for (const result of results) {
          if (!result || result === LOOKUP_UNAVAILABLE) { notFound++; continue; }
          const { changes } = await runSql(
            db,
            `INSERT OR IGNORE INTO ${table} (user_id, item_id, media_type, title, poster_url, ${timeCol}) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [req.user.id, result.itemId, result.mediaType, result.title, result.posterUrl]
          );
          if (changes > 0) matched++;
          imported.push(result.itemId);
        }

        // Keep the three lists exclusive across an import too. A watched import
        // ends any run in progress for the shows it names; a watchlist import
        // loses to Currently Watching, because "I am watching this now" is the
        // more specific claim than "I might watch this".
        if (imported.length) {
          const placeholders = imported.map(() => '?').join(',');
          const sql =
            importType === 'watched'
              ? `DELETE FROM currently_watching WHERE user_id = ? AND item_id IN (${placeholders})`
              : `DELETE FROM watchlist_items
                  WHERE user_id = ? AND item_id IN (${placeholders})
                    AND item_id IN (SELECT item_id FROM currently_watching WHERE user_id = ?)`;
          const params =
            importType === 'watched'
              ? [req.user.id, ...imported]
              : [req.user.id, ...imported, req.user.id];
          await runSql(db, sql, params);
        }
      });
    } catch (err) {
      console.error('[import] batch insert failed:', err.message);
      return res.status(500).json({ error: 'Could not save the imported titles' });
    }

    // A finished import is the biggest single injection of saved titles, so
    // start rating them straight away rather than waiting for the next visit.
    warmSavedRatings(db, req.user.id);

    res.json({ matched, notFound, processed: batch.length, replaced });
  });

  // ── Error handler ─────────────────────────────────────────────────────────
  // Must be last, and must take four arguments for Express to treat it as an
  // error handler. Without it, a rejected CORS origin or a malformed JSON body
  // falls through to Express's default handler, which answers with an HTML page
  // (and a stack trace outside production) — every client here calls
  // JSON.parse on the response and would choke on it.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) {
      console.error('Unhandled request error:', err);
    }
    if (res.headersSent) return;
    res.status(status).json({
      error: status >= 500 ? 'Internal server error' : err.message || 'Request failed',
    });
  });

  return app;
}

module.exports = { createApp };
