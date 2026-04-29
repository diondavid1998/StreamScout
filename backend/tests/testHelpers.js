'use strict';

/**
 * Shared test helpers for backend integration tests.
 * Creates an in-memory SQLite database and bootstraps the schema.
 */

const sqlite3 = require('sqlite3').verbose();

/**
 * Returns a promise that resolves once the in-memory database is ready
 * with the users table and catalog cache tables created.
 */
async function createTestDb() {
  const { ensureCatalogTables } = require('../catalogCache');

  const db = new sqlite3.Database(':memory:');

  const exec = (sql) =>
    new Promise((resolve, reject) =>
      db.run(sql, (err) => (err ? reject(err) : resolve()))
    );

  await exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT,
    profile_pic TEXT,
    platforms TEXT DEFAULT '[]',
    languages TEXT DEFAULT '[]'
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS watched_items (
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

  await exec(`CREATE TABLE IF NOT EXISTS watchlist_items (
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

  await exec(`CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    email TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Create catalog cache tables
  await ensureCatalogTables(db);

  return db;
}

/**
 * Closes the database connection.
 */
function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

module.exports = { createTestDb, closeDb };
