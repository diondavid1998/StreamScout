// Entry point — creates the real database, wires up the app, and starts listening.
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { ensureCatalogTables, startDailyCatalogRefresh } = require('./catalogCache');
const { createApp } = require('./app');

const PORT = process.env.PORT || 4000;

const db = new sqlite3.Database(process.env.DB_PATH || './db.sqlite', (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Bootstrap schema
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  platforms TEXT DEFAULT '[]',
  languages TEXT DEFAULT '[]'
)`);

db.all('PRAGMA table_info(users)', [], (err, columns) => {
  if (err || !Array.isArray(columns)) return;
  if (!columns.some((col) => col.name === 'languages')) {
    db.run("ALTER TABLE users ADD COLUMN languages TEXT DEFAULT '[]'");
  }
});

ensureCatalogTables(db).catch((error) => {
  console.error('Failed to initialize catalog cache tables:', error);
});
startDailyCatalogRefresh(db);

const app = createApp(db);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
