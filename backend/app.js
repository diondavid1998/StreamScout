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
const {
  ensureScopeSynced,
  readCachedCatalog,
} = require('./catalogCache');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

function createApp(db, { disableRateLimit = false } = {}) {
  const app = express();

  // Railway (and most PaaS) sit behind a reverse proxy that sets X-Forwarded-For.
  // Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
  app.set('trust proxy', 1);

  // Support comma-separated list so both Netlify and localhost can be allowed at once
  // e.g. FRONTEND_URL="https://screenscoretest.netlify.app,http://localhost:3000"
  // Trailing slashes are stripped so accidental misconfiguration on Render/Railway still works
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))  // strip trailing slashes
    .filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow server-to-server (no origin) and listed origins
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
  app.use(express.json({ limit: '64kb' }));

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
    const { username, password } = req.body || {};
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
    const hash = await bcrypt.hash(password, 10);
    db.run(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [cleanUsername, hash],
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
      if (err || !user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '30d' });
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

  // ── Account update ────────────────────────────────────────────────────────
  app.put('/account', authenticateToken, (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password required' });
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be 6–128 characters' });
    }
    bcrypt.hash(password, 10).then((hash) => {
      db.run('UPDATE users SET password = ? WHERE id = ?', [hash, req.user.id], function (err) {
        if (err) return res.status(500).json({ error: 'Update failed' });
        res.json({ success: true });
      });
    });
  });

  // ── Platforms GET ─────────────────────────────────────────────────────────
  app.get('/platforms', authenticateToken, (req, res) => {
    // Auto-recreate user row if DB was wiped (Railway ephemeral filesystem)
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
    // Upsert — works even if the user row was wiped from DB
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

  // ── Movies (catalog) ─────────────────────────────────────────────────────
  app.get('/movies', authenticateToken, async (req, res) => {
    const serviceFiltersFromQuery = String(req.query.serviceFilters || '')
      .split(',').map((v) => v.trim()).filter(Boolean);

    // Auto-recreate user row if DB was wiped (Railway ephemeral filesystem)
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

            // If the user has no platforms saved in DB (e.g. after a DB wipe),
            // fall back to serviceFilters sent by the client so the catalog still builds.
            const scopePlatforms = platforms.length > 0 ? platforms : serviceFiltersFromQuery;

            const mediaType = req.query.mediaType || 'all';
            const sortBy = req.query.sortBy || 'popularity';
            const limit = req.query.limit || 24;
            const region = req.query.region || 'US';
            const page = req.query.page || 1;
            const languageFilters = String(req.query.languageFilters || '')
              .split(',').map((v) => v.trim()).filter(Boolean);
            const genreFilters = String(req.query.genreFilters || '')
              .split(',').map((v) => v.trim()).filter(Boolean);

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

  return app;
}

module.exports = { createApp };
