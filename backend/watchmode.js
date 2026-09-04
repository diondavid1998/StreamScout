'use strict';

/**
 * Watchmode: the pros-and-cons summary, and what it costs to rent.
 *
 * This one is rationed in a way the others are not, and the whole design falls
 * out of that. The account's quota is a **lifetime** figure — 2,500 requests
 * for the account, not per month — so anything that walks a library is off the
 * table: a single Letterboxd import of two thousand films would spend 80% of
 * everything the key will ever have. TMDB is per-second and effectively free at
 * this scale; OMDB is a daily quota that refills. This refills never.
 *
 * So Watchmode is only ever asked about a title someone has actually opened,
 * and the answer is kept forever. A reader opening a few titles a day costs a
 * few calls a day, and the second open of the same title costs nothing.
 *
 * What it is here for is the two things no other source has:
 *
 *   review_summary       one line of pros and one of cons
 *   will_you_like_this   who the film is and is not for
 *   sources              rent and buy prices, which TMDB's providers omit
 *
 * It deliberately does *not* supply ratings. Its `user_rating` and
 * `critic_score` are Watchmode's own blends rather than named scores — for Heat
 * it reports 8.4 and 80 where IMDb says 8.3 and Metacritic 76 — so they cannot
 * be labelled as anyone's, and OMDB already provides the three that can.
 */

const WATCHMODE_BASE_URL = 'https://api.watchmode.com/v1';

/**
 * Tripped by any answer meaning "stop asking".
 *
 * More load-bearing here than anywhere else in this codebase: a quota that
 * never refills means every wasted call is gone for good. Unlike OMDB's daily
 * breaker there is no midnight to reset at, so this one holds for an hour and
 * then allows a single probe rather than assuming the door has reopened.
 */
const BREAKER_COOLDOWN_MS = 60 * 60 * 1000;
let breakerUntil = 0;

function isRationed() { return Date.now() < breakerUntil; }
function tripBreaker(reason) {
  breakerUntil = Date.now() + BREAKER_COOLDOWN_MS;
  console.warn(`[watchmode] paused for an hour: ${reason}`);
}
/** Test seam, and the door back in if a key is topped up mid-run. */
function resetBreaker() { breakerUntil = 0; }

function run(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); })
  );
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  );
}

async function ensureWatchmodeTables(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS watchmode_cache (
      media_type   TEXT NOT NULL,
      tmdb_id      INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      fetched_at   TEXT NOT NULL,
      PRIMARY KEY (media_type, tmdb_id)
    )`
  );
}

/** The handful of fields worth keeping out of a large response. */
function normalizeWatchmode(details, sources, region = 'US') {
  const summary = (details?.review_summary || '').trim();
  // The summary arrives as "Pros: a; b | Cons: c; d" in one string. Split so the
  // client can style the two halves differently rather than print the marker.
  let pros = null;
  let cons = null;
  if (summary) {
    const [prosPart, consPart] = summary.split('|').map((s) => s.trim());
    pros = (prosPart || '').replace(/^pros:\s*/i, '').trim() || null;
    cons = (consPart || '').replace(/^cons:\s*/i, '').trim() || null;
  }

  // Cheapest rent and buy in the region. A title is listed once per quality and
  // per storefront, so the interesting number is the floor, not the first row.
  const inRegion = (Array.isArray(sources) ? sources : []).filter((s) => s.region === region);
  const cheapest = (type) => {
    const priced = inRegion
      .filter((s) => s.type === type && typeof s.price === 'number' && s.price > 0)
      .sort((a, b) => a.price - b.price);
    if (!priced.length) return null;
    return { price: priced[0].price, service: priced[0].name };
  };

  return {
    pros,
    cons,
    // "You'll like this if… Not for you if…" — the one genuinely editorial line
    // any of these services gives.
    verdict: (details?.will_you_like_this || '').trim() || null,
    rent: cheapest('rent'),
    buy: cheapest('buy'),
    // Free-with-subscription services, named. Kept separate from TMDB's own
    // provider list rather than merged: this one is a second opinion, and two
    // sources quietly disagreeing is worse than one being clearly labelled.
    streamingOn: [...new Set(
      inRegion.filter((s) => s.type === 'sub').map((s) => s.name)
    )].slice(0, 8),
  };
}

/**
 * Watchmode's take on one title, from cache whenever it has been asked before.
 *
 * Returns null rather than throwing: this is a garnish on the detail sheet, and
 * a title with no Watchmode entry — or a spent quota — must still open.
 */
async function getWatchmodeDetails(db, mediaType, tmdbId, { apiKey = process.env.WATCHMODE_API_KEY } = {}) {
  const cached = await get(
    db,
    'SELECT payload_json FROM watchmode_cache WHERE media_type = ? AND tmdb_id = ?',
    [mediaType, tmdbId]
  );
  if (cached) {
    try { return JSON.parse(cached.payload_json); } catch { /* refetch below */ }
  }

  if (!apiKey || isRationed()) return null;

  // Watchmode addresses TMDB titles as "movie-550" / "tv-1399".
  const watchmodeId = `${mediaType}-${tmdbId}`;
  const url = (path) =>
    `${WATCHMODE_BASE_URL}/title/${watchmodeId}/${path}/?apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const [detailsRes, sourcesRes] = await Promise.all([
      fetch(url('details'), { signal: AbortSignal.timeout(15000) }),
      fetch(url('sources'), { signal: AbortSignal.timeout(15000) }),
    ]);

    // 402 is the quota being spent, 429 the rate limit. Neither is an answer
    // about this title, so neither may be cached as one.
    for (const response of [detailsRes, sourcesRes]) {
      if (response.status === 402 || response.status === 429) {
        tripBreaker(`HTTP ${response.status}`);
        return null;
      }
    }
    // A title Watchmode has never heard of is a real answer, and worth
    // remembering so it is not asked again — but there is nothing to show.
    if (detailsRes.status === 404) {
      const empty = { pros: null, cons: null, verdict: null, rent: null, buy: null, streamingOn: [] };
      await storeWatchmode(db, mediaType, tmdbId, empty);
      return empty;
    }
    if (!detailsRes.ok) return null;

    const details = await detailsRes.json();
    const sources = sourcesRes.ok ? await sourcesRes.json() : [];
    const payload = normalizeWatchmode(details, sources);
    await storeWatchmode(db, mediaType, tmdbId, payload);
    return payload;
  } catch (error) {
    console.warn(`[watchmode] ${watchmodeId} failed: ${error.message}`);
    return null;
  }
}

async function storeWatchmode(db, mediaType, tmdbId, payload) {
  await run(
    db,
    `INSERT INTO watchmode_cache (media_type, tmdb_id, payload_json, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(media_type, tmdb_id) DO UPDATE SET
       payload_json = excluded.payload_json,
       fetched_at   = excluded.fetched_at`,
    [mediaType, tmdbId, JSON.stringify(payload), new Date().toISOString()]
  );
}

module.exports = {
  ensureWatchmodeTables,
  getWatchmodeDetails,
  normalizeWatchmode,
  resetBreaker,
  isRationed,
};
