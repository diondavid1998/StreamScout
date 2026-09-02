'use strict';

/**
 * Reading a Letterboxd export.
 *
 * The export is a folder of CSVs, not one file, and the interesting columns are
 * spread across three of them:
 *
 *   diary.csv     one row per viewing — date, rating, rewatch flag, tags
 *   ratings.csv   one row per rated film — the rating, but no viewing date
 *   watched.csv   one row per film ever marked watched — no rating, no date
 *   watchlist.csv films saved for later
 *   reviews.csv   diary rows that carry written reviews
 *
 * The three watched-history files overlap: a film logged in the diary is also
 * in ratings.csv and watched.csv. Reading them naively triples the count, so
 * this module merges them in that order of specificity — the diary wins, then
 * ratings fills in films never logged, then watched.csv catches the rest.
 *
 * Nothing here talks to TMDB. Everything it returns comes out of the files the
 * user handed over.
 */

/** Columns we look for, lowercased. Letterboxd's headers are title case. */
const COLUMNS = {
  name: 'name',
  year: 'year',
  rating: 'rating',
  watchedDate: 'watched date',
  date: 'date',
  rewatch: 'rewatch',
  tags: 'tags',
  uri: 'letterboxd uri',
  review: 'review',
};

/**
 * Split one CSV line, honouring quoted fields and doubled quotes.
 *
 * Letterboxd quotes any field containing a comma — which is most tag lists and
 * a good number of film titles — so a naive split on "," corrupts them.
 */
function parseCsvRow(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
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

/**
 * A CSV into header-keyed objects.
 *
 * Rows are joined across newlines while a quote is open, because a review body
 * can contain line breaks and would otherwise be read as several broken rows.
 */
function parseCsv(text) {
  const normalised = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalised.split('\n');
  const lines = [];
  let pending = null;
  for (const line of rawLines) {
    const merged = pending === null ? line : `${pending}\n${line}`;
    const quotes = (merged.match(/"/g) || []).length;
    if (quotes % 2 === 1) { pending = merged; continue; }
    pending = null;
    if (merged.trim()) lines.push(merged);
  }
  if (pending !== null && pending.trim()) lines.push(pending);
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseCsvRow(lines[0]).map((h) => h.replace(/^"|"$/g, '').toLowerCase().trim());
  const rows = lines.slice(1).map((line) => {
    const cols = parseCsvRow(line);
    const row = {};
    headers.forEach((header, i) => { row[header] = (cols[i] ?? '').replace(/^"|"$/g, ''); });
    return row;
  });
  return { headers, rows };
}

/**
 * Which export a file is.
 *
 * The filename is the strong signal — Letterboxd's names are fixed — but a file
 * renamed on the way through Files or email still resolves, because the column
 * sets differ enough to tell apart.
 */
function classifyExport(fileName, headers) {
  const base = String(fileName || '').toLowerCase().split('/').pop();
  if (base.includes('diary')) return 'diary';
  if (base.includes('review')) return 'reviews';
  if (base.includes('rating')) return 'ratings';
  if (base.includes('watchlist')) return 'watchlist';
  if (base.includes('watched')) return 'watched';
  if (base.includes('like')) return 'likes';

  const has = (col) => headers.includes(col);
  if (has(COLUMNS.review)) return 'reviews';
  if (has(COLUMNS.watchedDate) || has(COLUMNS.rewatch)) return 'diary';
  if (has(COLUMNS.rating)) return 'ratings';
  if (has(COLUMNS.name) && has(COLUMNS.year)) return 'watched';
  return 'unknown';
}

/** Letterboxd ratings are 0.5–5.0 in half steps. Anything else is not a rating. */
function parseRating(value) {
  const rating = parseFloat(value);
  if (!Number.isFinite(rating) || rating < 0.5 || rating > 5) return null;
  // Guard against a 10-point scale sneaking in from a third-party export.
  return Math.round(rating * 2) / 2;
}

function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function parseYear(value) {
  const year = parseInt(value, 10);
  return Number.isInteger(year) && year > 1870 && year < 2200 ? year : null;
}

function parseTags(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20);
}

/** Case- and spacing-insensitive identity for a film within one export. */
function filmKey(name, year) {
  return `${String(name).toLowerCase().replace(/\s+/g, ' ').trim()}|${year ?? ''}`;
}

function toEntry(row, kind) {
  const name = (row[COLUMNS.name] || '').trim();
  if (!name) return null;
  const year = parseYear(row[COLUMNS.year]);
  return {
    name,
    year,
    rating: parseRating(row[COLUMNS.rating]),
    // A diary row carries both: "Watched Date" is when it was seen, "Date" is
    // when it was logged. The first is the one any time analysis wants.
    watchedOn: parseDate(row[COLUMNS.watchedDate]) || (kind === 'diary' ? parseDate(row[COLUMNS.date]) : null),
    isRewatch: /^(yes|true|1)$/i.test(String(row[COLUMNS.rewatch] || '').trim()) ? 1 : 0,
    tags: parseTags(row[COLUMNS.tags]),
    uri: (row[COLUMNS.uri] || '').trim() || null,
    hasReview: Boolean((row[COLUMNS.review] || '').trim()),
    source: kind,
  };
}

/**
 * Merge a whole export into one diary and one watchlist.
 *
 * `files` is `[{ name, text }]` — every CSV the user handed over, in any order.
 */
function readExport(files) {
  const parsed = [];
  for (const file of files || []) {
    if (!file || typeof file.text !== 'string') continue;
    const { headers, rows } = parseCsv(file.text);
    if (!rows.length) continue;
    parsed.push({ kind: classifyExport(file.name, headers), rows, name: file.name });
  }

  const byKind = (kind) => parsed.filter((f) => f.kind === kind).flatMap((f) => f.rows.map((r) => toEntry(r, kind))).filter(Boolean);

  const diary = [...byKind('diary'), ...byKind('reviews')];
  const ratings = byKind('ratings');
  const watched = byKind('watched');
  const watchlist = byKind('watchlist');

  // Diary rows are viewings and all of them count — two rows for the same film
  // on different dates are two viewings, which is exactly what a rewatch is.
  const entries = [];
  const seen = new Set();
  const seenViewing = new Set();
  for (const entry of diary) {
    const viewing = `${filmKey(entry.name, entry.year)}@${entry.watchedOn || ''}`;
    // reviews.csv repeats diary rows that carry a review; the same viewing must
    // not be counted twice because it was written about.
    if (seenViewing.has(viewing)) continue;
    seenViewing.add(viewing);
    seen.add(filmKey(entry.name, entry.year));
    entries.push(entry);
  }
  for (const entry of ratings) {
    const key = filmKey(entry.name, entry.year);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  for (const entry of watched) {
    const key = filmKey(entry.name, entry.year);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }

  const watchlistUnique = [];
  const watchlistSeen = new Set();
  for (const entry of watchlist) {
    const key = filmKey(entry.name, entry.year);
    if (watchlistSeen.has(key)) continue;
    watchlistSeen.add(key);
    watchlistUnique.push(entry);
  }

  return {
    entries,
    watchlist: watchlistUnique,
    files: parsed.map((f) => ({ name: f.name, kind: f.kind, rows: f.rows.length })),
    stats: {
      films: seen.size,
      viewings: entries.length,
      rated: entries.filter((e) => e.rating !== null).length,
      dated: entries.filter((e) => e.watchedOn !== null).length,
      rewatches: entries.filter((e) => e.isRewatch).length,
      watchlist: watchlistUnique.length,
      hasDiary: diary.length > 0,
    },
  };
}

module.exports = { parseCsv, parseCsvRow, classifyExport, parseRating, parseTags, filmKey, readExport };
