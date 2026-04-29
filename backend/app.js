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
  buildScopeKey,
} = require('./catalogCache');
const { fetchTitleWithCredits, searchTitleOnTmdb, fetchTitlesByPerson } = require('./movieService');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

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
    from: `"StreamScout" <${process.env.EMAIL_FROM}>`,
    to: toEmail,
    subject: 'StreamScout — Password Reset Code',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#e50914">StreamScout</h2>
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
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
      credentials: true,
    })
  );
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
    const hash = await bcrypt.hash(password, 10);
    db.run(
      'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
      [cleanUsername, hash, cleanEmail],
      function (err) {
        if (err) {
          return res.status(400).json({ error: 'Username already exists' });
        }
        const token = jwt.sign(
          { id: this.lastID, username: cleanUsername },
          JWT_SECRET,
          { expiresIn: '30d' }
        );
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
        return res.status(401).json({ error: 'No account found with that username. Please sign up.' });
      }
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(401).json({ error: 'Incorrect password. Please try again.' });
      }
      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
      res.json({ token });
    });
  });

  // ── Auth middleware ───────────────────────────────────────────────────────
  function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Missing authentication token' });
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid or expired authentication token' });
      }
      req.user = user;
      next();
    });
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
    let newToken = null;

    if (username !== undefined) {
      const cleaned = String(username).trim().toLowerCase();
      if (cleaned.length < 3 || cleaned.length > 32) {
        return res.status(400).json({ error: 'Username must be 3–32 characters' });
      }
      updates.push('username = ?');
      values.push(cleaned);
      newToken = jwt.sign({ id: req.user.id, username: cleaned }, JWT_SECRET, { expiresIn: '30d' });
    }

    if (email !== undefined) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    values.push(req.user.id);

    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values, function (err) {
      if (err) {
        if (err.message && err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'Username already taken' });
        }
        return res.status(500).json({ error: 'Update failed' });
      }
      const response = { success: true };
      if (newToken) response.token = newToken;
      res.json(response);
    });
  });

  // ── Platforms GET ─────────────────────────────────────────────────────────
  app.get('/platforms', authenticateToken, (req, res) => {
    db.run(
      'INSERT OR IGNORE INTO users (id, username, password) VALUES (?, ?, ?)',
      [req.user.id, req.user.username, ''],
      () => {
        db.get('SELECT platforms, languages FROM users WHERE id = ?', [req.user.id], (err, row) => {
          if (err || !row) return res.status(500).json({ error: 'Database error' });
          let platforms = [];
          let languages = [];
          try { platforms = JSON.parse(row.platforms); } catch { platforms = []; }
          try { languages = JSON.parse(row.languages || '[]'); } catch { languages = []; }
          res.json({ platforms, languages });
        });
      }
    );
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
    db.run(
      `INSERT INTO users (id, username, password, platforms, languages) VALUES (?, ?, '', ?, ?)
       ON CONFLICT(id) DO UPDATE SET platforms = excluded.platforms, languages = excluded.languages`,
      [
        req.user.id,
        req.user.username,
        JSON.stringify(platforms),
        JSON.stringify(Array.isArray(languages) ? languages : []),
      ],
      function (err) {
        if (err) return res.status(500).json({ error: 'Update failed' });
        res.json({ success: true });
      }
    );
  });

  // ── Title details (cast, crew, etc.) ─────────────────────────────────────
  app.get('/titles/:mediaType/:tmdb_id/details', authenticateToken, async (req, res) => {
    const { mediaType, tmdb_id } = req.params;
    if (!['movie', 'tv'].includes(mediaType)) {
      return res.status(400).json({ error: 'mediaType must be movie or tv' });
    }
    try {
      const data = await fetchTitleWithCredits(mediaType, tmdb_id);
      const cast = (data.credits?.cast || []).slice(0, 8).map((person) => ({
        id: person.id,
        name: person.name,
        character: person.character || person.roles?.[0]?.character || '',
        profileUrl: person.profile_path ? `${TMDB_IMAGE_BASE}/w185${person.profile_path}` : null,
      }));
      let directors = [];
      if (mediaType === 'movie') {
        directors = (data.credits?.crew || []).filter((m) => m.job === 'Director').map((m) => m.name);
      } else {
        directors = (data.created_by || []).map((m) => m.name);
      }
      res.json({
        id: data.id,
        mediaType,
        title: data.title || data.name,
        tagline: data.tagline || null,
        overview: data.overview || '',
        releaseDate: data.release_date || data.first_air_date || null,
        runtime: data.runtime || null,
        status: data.status || null,
        genres: (data.genres || []).map((g) => g.name),
        posterUrl: data.poster_path ? `${TMDB_IMAGE_BASE}/w500${data.poster_path}` : null,
        backdropUrl: data.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${data.backdrop_path}` : null,
        cast,
        directors,
        numberOfSeasons: data.number_of_seasons || null,
        numberOfEpisodes: data.number_of_episodes || null,
      });
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
  app.get('/catalog-status', authenticateToken, (req, res) => {
    db.get('SELECT platforms FROM users WHERE id = ?', [req.user.id], (err, row) => {
      if (err || !row) return res.status(500).json({ error: 'Database error' });
      let platforms = [];
      try { platforms = JSON.parse(row.platforms || '[]'); } catch { /* ignore */ }
      const scopeKey = buildScopeKey(platforms);
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

  // ── Watched list GET ──────────────────────────────────────────────────────
  app.get('/watched', authenticateToken, (req, res) => {
    db.all(
      'SELECT * FROM watched_items WHERE user_id = ? ORDER BY watched_at DESC',
      [req.user.id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ items: rows || [] });
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
        res.json({ success: true, added: this.changes > 0 });
      }
    );
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

      const hash = await bcrypt.hash(newPassword, 10);
      await new Promise((resolve, reject) =>
        db.run('UPDATE users SET password = ? WHERE id = ?', [hash, user.id], (err) =>
          err ? reject(err) : resolve()
        )
      );
      await new Promise((resolve, reject) =>
        db.run('UPDATE reset_tokens SET used = 1 WHERE id = ?', [tokenRow.id], (err) =>
          err ? reject(err) : resolve()
        )
      );
      res.json({ success: true, message: 'Password has been reset successfully.' });
    } catch (e) {
      console.error('Reset password error:', e.message);
      res.status(500).json({ error: 'Reset failed. Please try again.' });
    }
  });

  // ── Movies (catalog) ─────────────────────────────────────────────────────
  app.get('/movies', authenticateToken, async (req, res) => {
    const serviceFiltersFromQuery = String(req.query.serviceFilters || '')
      .split(',').map((v) => v.trim()).filter(Boolean);

    db.run(
      'INSERT OR IGNORE INTO users (id, username, password) VALUES (?, ?, ?)',
      [req.user.id, req.user.username, ''],
      () => {
        db.get(
          'SELECT platforms, languages FROM users WHERE id = ?',
          [req.user.id],
          async (err, row) => {
            if (err || !row) {
              return res.status(500).json({ error: 'Database error' });
            }

            let platforms = [];
            let languages = [];
            try { platforms = JSON.parse(row.platforms || '[]'); } catch { platforms = []; }
            try { languages = JSON.parse(row.languages || '[]'); } catch { languages = []; }

            const scopePlatforms = platforms.length > 0 ? platforms : serviceFiltersFromQuery;

            const mediaType = req.query.mediaType || 'all';
            const sortBy = req.query.sortBy || 'popularity';
            const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 24), 100);
            const region = req.query.region || 'US';
            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const languageFilters = String(req.query.languageFilters || '')
              .split(',').map((v) => v.trim()).filter(Boolean);
            const genreFilters = String(req.query.genreFilters || '')
              .split(',').map((v) => v.trim()).filter(Boolean);
            const yearMin = req.query.yearMin ? parseInt(req.query.yearMin, 10) : null;
            const yearMax = req.query.yearMax ? parseInt(req.query.yearMax, 10) : null;
            const hideWatched = req.query.hideWatched === 'true';
            const watchlistOnly = req.query.watchlistOnly === 'true';

            let excludeItemIds = [];
            if (hideWatched) {
              excludeItemIds = await new Promise((resolve) =>
                db.all('SELECT item_id FROM watched_items WHERE user_id = ?', [req.user.id], (e, rows) =>
                  resolve(rows ? rows.map((r) => r.item_id) : [])
                )
              );
            }

            let watchlistItemIds = [];
            if (watchlistOnly) {
              watchlistItemIds = await new Promise((resolve) =>
                db.all('SELECT item_id FROM watchlist_items WHERE user_id = ?', [req.user.id], (e, rows) =>
                  resolve(rows ? rows.map((r) => r.item_id) : [])
                )
              );
            }

            try {
              const scopeKey = await ensureScopeSynced(db, { platforms: scopePlatforms, languages, region });
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
                excludeItemIds,
                watchlistItemIds,
              });
              res.json(catalog);
            } catch (e) {
              res.status(500).json({ error: 'Failed to load cached catalog', details: e.message });
            }
          }
        );
      }
    );
  });

  // ── Watchlist GET ─────────────────────────────────────────────────────────
  app.get('/watchlist', authenticateToken, (req, res) => {
    db.all(
      'SELECT * FROM watchlist_items WHERE user_id = ? ORDER BY added_at DESC',
      [req.user.id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ items: rows || [] });
      }
    );
  });

  // ── Watchlist DELETE ──────────────────────────────────────────────────────
  app.delete('/watchlist/:item_id', authenticateToken, (req, res) => {
    const itemId = decodeURIComponent(req.params.item_id);
    db.run(
      'DELETE FROM watchlist_items WHERE user_id = ? AND item_id = ?',
      [req.user.id, itemId],
      function (err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true });
      }
    );
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
  // Accepts up to 50 items per call. Client loops until all items are processed.
  app.post('/import/letterboxd', authenticateToken, async (req, res) => {
    const { items, importType } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array required' });
    }
    if (!['watched', 'watchlist'].includes(importType)) {
      return res.status(400).json({ error: 'importType must be watched or watchlist' });
    }
    const batch = items.slice(0, 50);
    const table = importType === 'watched' ? 'watched_items' : 'watchlist_items';
    const timeCol = importType === 'watched' ? 'watched_at' : 'added_at';

    let matched = 0;
    let notFound = 0;

    for (const { name, year } of batch) {
      if (!name || !year) { notFound++; continue; }
      const result = await searchTitleOnTmdb(name, year);
      if (!result) { notFound++; continue; }

      await new Promise((resolve) =>
        db.run(
          `INSERT OR IGNORE INTO ${table} (user_id, item_id, media_type, title, poster_url, ${timeCol}) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [req.user.id, result.itemId, result.mediaType, result.title, result.posterUrl],
          () => resolve()
        )
      );
      matched++;

      // Throttle to respect TMDB rate limits (~8 req/sec)
      await new Promise((r) => setTimeout(r, 125));
    }

    res.json({ matched, notFound, processed: batch.length });
  });

  return app;
}

module.exports = { createApp };
