require('dotenv').config();

const TMDB_CREDENTIAL = process.env.TMDB_API_KEY;
const OMDB_API_KEY = process.env.OMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const DEFAULT_REGION = 'US';

// How a title can be "included with your subscription".
//
//   flatrate — a normal subscription tier (Netflix, Max)
//   free     — free with no ads and no account (Pluto TV, Kanopy via a library)
//   ads      — free but ad-supported (Tubi, The Roku Channel, Pluto)
//
// Only `flatrate` used to be requested and read, so the four free services in
// the picker — Tubi, Pluto TV, The Roku Channel and Kanopy — could be selected
// but never returned a single title.
const INCLUDED_MONETIZATION = ['flatrate', 'free', 'ads'];

// The two ways a title costs money on its own.
//
// These used to be excluded outright, on the reasoning that this app answers
// "what can I already watch", not "what could I buy". That reasoning still
// holds for anyone who has not asked — which is why VOD is a service you pick
// rather than a tier that is always on. Nothing below changes for a user who
// leaves it unselected.
//
// Named VOD, not PVOD. PVOD means the premium window specifically — a film
// still in or just out of cinemas, at around twenty pounds, before it reaches
// any subscription. These two buckets are all of transactional video on demand,
// a four-pound rental of a 1995 film included, and TMDB carries no price or
// window to tell those apart with. The question this answers is "can I rent or
// buy it right now", and VOD is the name of that question.
const PURCHASE_MONETIZATION = ['rent', 'buy'];

// VOD is one entry in the picker but not one storefront, so it gets a key of
// its own and every store that rents or sells is filed under it.
const VOD_KEY = 'vod';
const DISCOVER_PAGE_COUNT = 1;
const CACHE_TTL_MS = 10 * 60 * 1000;
// Hard ceiling on each in-memory response cache. A full snapshot sync touches
// ~1,000 titles, so this holds a couple of syncs' worth of hot keys without
// letting the process grow unbounded across daily refreshes.
const MAX_CACHE_ENTRIES = 2500;
const DOCUMENTARY_GENRE_ID = 99;
const DEFAULT_PAGE_SIZE = 24;
const PREFETCH_DISCOVER_PAGES = 5;
const SNAPSHOT_DISCOVER_PAGES = 25;
const SNAPSHOT_LANGUAGE_DISCOVER_PAGES = 3;
const MAX_SNAPSHOT_ITEMS = 1000;
// How much of a sweep has to survive before it is worth persisting. Below this
// the run is treated as an outage and retried, rather than written down as the
// catalogue and kept.
const MIN_ENRICH_SUCCESS_RATIO = 0.5;

// OMDB circuit breaker — trips when the daily request limit is hit.
// Resets automatically at next midnight so hydration resumes the following day.
let omdbRateLimited = false;
function tripOmdbRateLimit() {
  if (omdbRateLimited) return;
  omdbRateLimited = true;
  console.warn('OMDB daily limit reached — pausing all OMDB requests until midnight.');
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  setTimeout(() => {
    omdbRateLimited = false;
    console.info('OMDB circuit breaker reset — requests will resume.');
  }, midnight.getTime() - now.getTime()).unref();
}
function isOmdbRateLimited() { return omdbRateLimited; }

/**
 * The services the app covers.
 *
 * Fifteen, deliberately. The list ran to thirty-one, and the tail of it —
 * regional channels, live-TV bundles, single-genre niches — was a long scroll
 * of things almost nobody was picking, in front of everybody, every time they
 * set the app up. Each one also widens the TMDB discover query, so the cost of
 * carrying them was not only visual.
 *
 * Removing a key is safe by construction: `buildProviderSelection` drops any it
 * does not recognise, so a stored selection naming a retired service still
 * works, minus that service.
 */
const PLATFORM_CONFIG = {
  netflix:    { id: 8,    name: 'Netflix' },
  hulu:       { id: 15,   name: 'Hulu' },
  prime:      { id: 9,    name: 'Prime Video' },
  disney:     { id: 337,  name: 'Disney+' },
  paramount:  { ids: [2303, 2616], name: 'Paramount+' },  // Premium + Essential
  apple:      { id: 350,  name: 'Apple TV+' },            // not 2 (Apple TV Store = rentals)
  peacock:    { id: 386,  name: 'Peacock' },
  max:        { id: 1899, name: 'Max' },
  crunchyroll:{ id: 283,  name: 'Crunchyroll' },
  starz:      { id: 43,   name: 'Starz' },
  showtime:   { id: 37,   name: 'Showtime' },
  amc:        { id: 526,  name: 'AMC+' },
  tubi:       { id: 73,   name: 'Tubi' },
  pluto:      { id: 300,  name: 'Pluto TV' },
  mubi:       { id: 11,   name: 'MUBI' },

  // Not a service anyone subscribes to — a tier. Selecting it says "also show
  // me what I could rent or buy right now", and these are the storefronts that
  // answer.
  //
  // The ids scope the discover query only. Availability is read from TMDB's own
  // `rent` and `buy` buckets rather than from this list, so a storefront missing
  // here still shows up on a title's card correctly — it just will not pull that
  // title into the catalog on its own. That is the safe direction to be wrong in:
  // a store nobody listed costs you some breadth, not a wrong answer.
  vod: {
    ids: [
      2,    // Apple TV  (the store — Apple TV+ the subscription is 350)
      3,    // Google Play Movies
      7,    // Fandango at Home (formerly Vudu)
      10,   // Amazon Video  (the store — Prime Video the subscription is 9)
      68,   // Microsoft Store
      192,  // YouTube
    ],
    name: 'VOD',
    // What marks this entry as the purchase tier everywhere else in the code.
    purchase: true,
  },
};
const tmdbCache = new Map();
const omdbCache = new Map();

function getCacheEntry(cache, key) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }

  // Move to the back so eviction targets genuinely cold keys.
  cache.delete(key);
  cache.set(key, entry);

  return entry.value;
}

/**
 * Insert with LRU eviction.
 *
 * These caches are long-lived on a server process, and a single catalog sync
 * writes a detail payload per title under a URL that is never requested again.
 * Without a bound the maps only grow: expiry alone never frees anything,
 * because getCacheEntry can only evict a key something asks for a second time.
 * Map preserves insertion order, so deleting the first key drops the oldest
 * entry; re-inserting on read (below) keeps hot keys at the back.
 */
function setCacheEntry(cache, key, value, ttlMs = CACHE_TTL_MS) {
  cache.delete(key);
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function decodeJwtPayload(token) {
  if (!token || !token.includes('.')) {
    return null;
  }

  try {
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function getTmdbApiKey() {
  if (!TMDB_CREDENTIAL) {
    return null;
  }

  if (!TMDB_CREDENTIAL.includes('.')) {
    return TMDB_CREDENTIAL;
  }

  return decodeJwtPayload(TMDB_CREDENTIAL)?.aud || null;
}

function buildTmdbHeaders() {
  if (!TMDB_CREDENTIAL) {
    throw new Error('TMDB_API_KEY is not configured');
  }

  return {
    accept: 'application/json',
  };
}

/**
 * Raised when a title search could not reach TMDB at all, as opposed to
 * reaching it and being told the film does not exist. Only the second is an
 * answer, and only the second may be remembered.
 */
class TmdbUnreachableError extends Error {
  constructor(name) {
    super(`Could not reach TMDB while searching for "${name}"`);
    this.name = 'TmdbUnreachableError';
  }
}

/**
 * Stop asking TMDB for a minute after it makes clear it does not want to be
 * asked.
 *
 * Without this every call in a batch fails on its own terms, because nothing
 * tells the second request that the first was just refused. A single resolve
 * batch is up to 120 requests eight at a time, so an unreachable TMDB costs
 * nearly four minutes of timeouts to learn one thing — and a rate-limited one
 * gets 120 more requests from us after telling us to stop, which is how a short
 * limit becomes a long one.
 *
 * A minute, not until midnight. OMDB's breaker waits for the daily quota it is
 * built around to roll over; TMDB's limit is short and per-second, so holding
 * for hours would lock someone out of their own lookup over a blip.
 *
 * What trips it is deliberately narrow. A 429 or a 5xx or a dead socket is TMDB
 * declining to answer. A 404 is an answer — the title does not exist — and a
 * 401 is a misconfigured key that no amount of waiting fixes and that an
 * operator needs to see rather than have muffled.
 */
const TMDB_BREAKER_COOLDOWN_MS = 60 * 1000;
/**
 * How many refusals in a row open it.
 *
 * Not one. A single failed request is the normal cost of a flaky network, and
 * `searchTitleOnTmdb` is built around exactly that: when `/search/multi` fails
 * it falls back to year-scoped searches, which routinely succeed. Opening on
 * the first failure would block the fallback that exists to recover from it and
 * turn a recoverable blip into a minute of nothing. Three consecutive refusals
 * is a service that is actually down; one is Tuesday.
 */
const TMDB_BREAKER_THRESHOLD = 3;
let tmdbBreakerUntil = 0;
let tmdbConsecutiveRefusals = 0;

class TmdbUnavailableError extends Error {
  constructor(message = 'TMDB is not answering right now') {
    super(message);
    this.name = 'TmdbUnavailableError';
    this.status = 503;
  }
}

function isTmdbUnavailable() { return Date.now() < tmdbBreakerUntil; }

function noteTmdbRefusal(reason) {
  tmdbConsecutiveRefusals += 1;
  if (tmdbConsecutiveRefusals < TMDB_BREAKER_THRESHOLD) return;
  const wasOpen = isTmdbUnavailable();
  tmdbBreakerUntil = Date.now() + TMDB_BREAKER_COOLDOWN_MS;
  // Logged once per opening rather than once per refused call, so an outage
  // leaves a line in the log instead of a wall.
  if (!wasOpen) console.warn(`[tmdb] pausing requests for 60s after ${tmdbConsecutiveRefusals} refusals: ${reason}`);
}

/** Any answer at all means the service is back; the count starts over. */
function noteTmdbSuccess() { tmdbConsecutiveRefusals = 0; }

/** Test seam, and the way back in once a key or a network is fixed. */
function resetTmdbBreaker() {
  tmdbBreakerUntil = 0;
  tmdbConsecutiveRefusals = 0;
}

/** Whether a failure means "TMDB declined" rather than "no such title". */
function isTmdbRefusal(error) {
  const status = error?.status;
  if (status === 404 || status === 401 || status === 403) return false;
  // No status at all means the request never completed — DNS, socket, abort.
  if (status === undefined) return true;
  return status === 429 || status >= 500;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const error = new Error(
      data.status_message || data.Error || data.message || `Request failed with status ${response.status}`
    );
    // Carried so callers can tell "no such title" from "not right now". Without
    // it every failure looks the same and a 404 gets treated like an outage.
    error.status = response.status;
    throw error;
  }

  return data;
}

async function fetchTmdb(path, params = {}) {
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  const apiKey = getTmdbApiKey();

  if (apiKey) {
    url.searchParams.set('api_key', apiKey);
  }

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const cacheKey = url.toString();
  const cached = getCacheEntry(tmdbCache, cacheKey);
  if (cached) {
    return cached;
  }

  // Checked after the cache, not before: a cached answer is free and correct
  // whether or not TMDB is currently reachable, and refusing to serve it would
  // make an outage look worse than it is.
  if (isTmdbUnavailable()) {
    throw new TmdbUnavailableError();
  }

  let data;
  try {
    data = await fetchJson(url.toString(), { headers: buildTmdbHeaders() });
    noteTmdbSuccess();
  } catch (error) {
    // A 404 is TMDB answering, so it clears the count too — the service is
    // plainly up, this title just does not exist.
    if (isTmdbRefusal(error)) noteTmdbRefusal(error.message);
    else noteTmdbSuccess();
    throw error;
  }

  setCacheEntry(tmdbCache, cacheKey, data);
  return data;
}

async function fetchOmdbRatings(imdbId) {
  if (!OMDB_API_KEY || !imdbId) {
    return buildRatingsPayload({});
  }

  // Circuit breaker — don't waste requests when daily limit is known to be hit
  if (isOmdbRateLimited()) {
    return null;
  }

  const cacheKey = imdbId;
  const cached = getCacheEntry(omdbCache, cacheKey);
  if (cached) {
    return cached;
  }

  const url = new URL('https://www.omdbapi.com/');
  url.searchParams.set('apikey', OMDB_API_KEY);
  url.searchParams.set('i', imdbId);

  try {
    const data = await fetchJson(url.toString());
    // OMDB returns 200 with Response:"False" and Error when limit is hit
    if (data.Response === 'False' && /request limit/i.test(data.Error || '')) {
      tripOmdbRateLimit();
      return null;
    }
    const ratings = buildRatingsPayload(data);
    setCacheEntry(omdbCache, cacheKey, ratings);
    return ratings;
  } catch (error) {
    if (/request limit/i.test(error.message)) {
      tripOmdbRateLimit();
    }
    console.warn(`OMDB fetch failed for ${imdbId}: ${error.message}`);
    return null;
  }
}

function buildRatingsPayload(omdbData) {
  const ratings = Array.isArray(omdbData.Ratings) ? omdbData.Ratings : [];
  const findSourceValue = (source) => ratings.find((entry) => entry.Source === source)?.Value || null;

  return {
    imdb: findSourceValue('Internet Movie Database'),
    rottenTomatoes: findSourceValue('Rotten Tomatoes'),
    metacritic: findSourceValue('Metacritic'),
    letterboxd: null,
    omdbVotes: omdbData.imdbVotes || null,
    imdbId: omdbData.imdbID || null,
  };
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

/**
 * Whether a built selection asked for rentals and purchases.
 *
 * Read off the map rather than threaded through every call site: the VOD entry
 * is in the map exactly when the user picked it, so the map already knows. One
 * pass over at most a couple of dozen entries.
 */
function selectionIncludesPurchase(providerMapById) {
  for (const entry of providerMapById.values()) if (entry.purchase) return true;
  return false;
}

/** The monetization types a discover query should ask TMDB for. */
function monetizationFor(providerMapById) {
  return selectionIncludesPurchase(providerMapById)
    ? [...INCLUDED_MONETIZATION, ...PURCHASE_MONETIZATION]
    : INCLUDED_MONETIZATION;
}

function buildProviderSelection(platformKeys) {
  const selectedProviders = platformKeys
    .map((key) => ({ key, ...PLATFORM_CONFIG[key] }))
    .filter((p) => p.id || p.ids);

  const providerIds = selectedProviders.flatMap((p) => (p.ids ? p.ids : [p.id]));

  const providerMapById = new Map(
    selectedProviders.flatMap((p) => {
      const ids = p.ids ? p.ids : [p.id];
      return ids.map((id) => [id, p]);
    })
  );

  return { providerIds, providerMapById };
}

async function discoverTitles(
  mediaType, providerIds, page, region = DEFAULT_REGION, extraParams = {},
  monetization = INCLUDED_MONETIZATION
) {
  const data = await fetchTmdb(`/discover/${mediaType}`, {
    include_adult: false,
    include_video: mediaType === 'movie' ? false : undefined,
    language: 'en-US',
    page,
    sort_by: 'popularity.desc',
    watch_region: region,
    // TMDB matches a title when any one of these providers offers it under any
    // one of these types, so widening the list is a union, not an intersection:
    // adding the stores cannot drop a subscription title someone already had.
    with_watch_monetization_types: monetization.join('|'),
    with_watch_providers: providerIds.join('|'),
    ...extraParams,
  });

  return Array.isArray(data.results) ? data.results : [];
}

async function fetchTitleDetails(mediaType, tmdbId, { includeExternalIds = true } = {}) {
  const appendToResponse = includeExternalIds ? 'external_ids,watch/providers' : 'watch/providers';

  return fetchTmdb(`/${mediaType}/${tmdbId}`, {
    append_to_response: appendToResponse,
    language: 'en-US',
  });
}

async function fetchTitleWithCredits(mediaType, tmdbId) {
  return fetchTmdb(`/${mediaType}/${tmdbId}`, {
    // external_ids rides along on the same request and costs nothing extra. It
    // carries the IMDb id, which is how a title reaches the shared ratings
    // table — without it the analytics page cannot compare a rating to the
    // crowd's.
    // All four ride along on the one request and cost nothing extra. `credits`
    // carries the whole crew, not just the director; `external_ids` the IMDb id
    // that reaches the shared ratings table; `keywords` what a film is about
    // where genres only say what shelf it sits on; `release_dates` the US
    // certificate.
    append_to_response: 'credits,external_ids,keywords,release_dates',
    language: 'en-US',
  });
}

/**
 * Every offer on this title, tagged with the tier it came from.
 *
 * The tier rides along because the caller has to tell "included with something
 * you pay for monthly" apart from "yours for £13.99". Showing a rental in the
 * same breath as a subscription would be the same lie the free tiers used to
 * tell before they were read at all.
 */
function includedProviders(watchProviders, region = DEFAULT_REGION, { includePurchase = false } = {}) {
  const forRegion = watchProviders?.results?.[region];
  if (!forRegion) return [];
  const tiers = includePurchase
    ? [...INCLUDED_MONETIZATION, ...PURCHASE_MONETIZATION]
    : INCLUDED_MONETIZATION;
  return tiers.flatMap((tier) => (forRegion[tier] || []).map((p) => ({ ...p, tier })));
}

/**
 * Split a title's offers into what a subscription covers and what costs money.
 *
 * Subscription offers are matched against the user's selection, because "on
 * Netflix" is only interesting to someone who has Netflix. Purchase offers are
 * not: whoever sells it, you can buy it, so every store found under `rent` or
 * `buy` is named as it comes — which is also why an id missing from the VOD
 * list above cannot produce a wrong answer here.
 */
function normalizeProviders(details, providerMapById, region = DEFAULT_REGION) {
  const includePurchase = selectionIncludesPurchase(providerMapById);
  const seen = new Set();
  const names = [];
  const keys = [];
  const purchaseOffers = [];

  for (const provider of includedProviders(details['watch/providers'], region, { includePurchase })) {
    if (PURCHASE_MONETIZATION.includes(provider.tier)) {
      // One store lists a film under rent, under buy, or under both, and those
      // are different offers. Collapsing them to a name alone made a title you
      // can only purchase read as "Rent · Apple TV", which is the kind of small
      // untruth this codebase keeps finding in its own labels.
      const name = provider.provider_name;
      if (!name) continue;
      const existing = purchaseOffers.find((o) => o.name === name);
      if (existing) {
        if (!existing.tiers.includes(provider.tier)) existing.tiers.push(provider.tier);
      } else {
        purchaseOffers.push({ name, tiers: [provider.tier] });
      }
      if (!keys.includes(VOD_KEY)) keys.push(VOD_KEY);
      continue;
    }
    const entry = providerMapById.get(provider.provider_id);
    // A title can appear under more than one tier — free and ads both list
    // Pluto, for instance — so dedupe by key rather than trusting TMDB.
    if (entry && !seen.has(entry.key)) {
      seen.add(entry.key);
      names.push(entry.name);
      keys.push(entry.key);
    }
  }
  return { names, keys, purchaseOffers };
}

function normalizeCatalogItem(rawItem, details, ratings, providers, mediaType) {
  const title = rawItem.title || rawItem.name || details.title || details.name || 'Untitled';
  const releaseDate = rawItem.release_date || rawItem.first_air_date || details.release_date || details.first_air_date || null;
  // ratings may be null when OMDB is rate-limited or unavailable — treat as empty
  const r = ratings ?? {};

  return {
    id: `${mediaType}-${rawItem.id}`,
    tmdbId: rawItem.id,
    mediaType,
    title,
    overview: rawItem.overview || details.overview || '',
    releaseDate,
    year: releaseDate ? (parseInt(String(releaseDate).slice(0, 4), 10) || null) : null,
    posterPath: rawItem.poster_path || details.poster_path || null,
    posterUrl: rawItem.poster_path || details.poster_path ? `${TMDB_IMAGE_BASE_URL}${rawItem.poster_path || details.poster_path}` : null,
    backdropPath: rawItem.backdrop_path || details.backdrop_path || null,
    tmdbRating: rawItem.vote_average || details.vote_average || null,
    tmdbVoteCount: rawItem.vote_count || details.vote_count || null,
    popularity: rawItem.popularity || details.popularity || null,
    originalLanguage: rawItem.original_language || details.original_language || null,
    genres: Array.isArray(details.genres) ? details.genres.map((genre) => genre.name) : [],
    // Where you can rent or buy it, named separately from what a subscription
    // covers, each store carrying which of the two it offers. Empty for anyone
    // who has not picked VOD.
    purchaseOn: providers?.purchaseOffers || [],
    imdbId: details.external_ids?.imdb_id || r.imdbId || null,
    ratings: {
      tmdb: rawItem.vote_average || details.vote_average || null,
      imdb: r.imdb ?? null,
      rottenTomatoes: r.rottenTomatoes ?? null,
      metacritic: r.metacritic ?? null,
      letterboxd: null,
    },
    sortableRatings: {
      tmdb: rawItem.vote_average || details.vote_average || 0,
      imdb: toSortableRating(r.imdb),
      rottenTomatoes: toSortableRating(r.rottenTomatoes),
      metacritic: toSortableRating(r.metacritic),
      letterboxd: null,
    },
    availableOn: providers.names,
    availableOnKeys: providers.keys,
  };
}

function dedupeCatalog(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.media_type || item.mediaType}:${item.id || item.tmdbId}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function sortCatalog(items, sortBy = 'popularity') {
  const sorted = [...items];
  const compareDesc = (left, right) => (right ?? -Infinity) - (left ?? -Infinity);

  if (sortBy === 'release_date') {
    // ISO date strings sort correctly with plain comparison; avoid localeCompare overhead.
    sorted.sort((left, right) => {
      const l = left.releaseDate || '';
      const r = right.releaseDate || '';
      if (r > l) return 1;
      if (r < l) return -1;
      return 0;
    });
    return sorted;
  }

  sorted.sort((left, right) => {
    switch (sortBy) {
      case 'title':
        return left.title.localeCompare(right.title);
      case 'tmdb':
        return compareDesc(left.sortableRatings.tmdb, right.sortableRatings.tmdb);
      case 'imdb':
        return compareDesc(left.sortableRatings.imdb, right.sortableRatings.imdb);
      case 'rotten_tomatoes':
        return compareDesc(left.sortableRatings.rottenTomatoes, right.sortableRatings.rottenTomatoes);
      case 'metacritic':
        return compareDesc(left.sortableRatings.metacritic, right.sortableRatings.metacritic);
      case 'popularity':
      default:
        return compareDesc(left.popularity, right.popularity);
    }
  });

  return sorted;
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

async function fetchCatalogByPlatforms(platforms, options = {}) {
  if (!platforms || platforms.length === 0) {
    return {
      items: [],
      meta: {
        mediaType: options.mediaType || 'all',
        sortBy: options.sortBy || 'popularity',
        region: options.region || DEFAULT_REGION,
        platformCount: 0,
      },
    };
  }

  const mediaType = options.mediaType || 'all';
  const sortBy = options.sortBy || 'popularity';
  const region = options.region || DEFAULT_REGION;
  const limit = Math.min(Math.max(Number(options.limit) || DEFAULT_PAGE_SIZE, 1), 2000);
  const page = Math.max(Number(options.page) || 1, 1);
  const snapshotMode = Boolean(options.snapshotMode);
  const includeRatings = options.includeRatings !== false;
  const includeExternalIds = options.includeExternalIds !== false;
  const pageCount = Math.min(
    Math.max(
      Number(options.pageCount) ||
        (snapshotMode ? SNAPSHOT_DISCOVER_PAGES : Math.max(PREFETCH_DISCOVER_PAGES, page + 1)),
      DISCOVER_PAGE_COUNT
    ),
    50
  );
  const selectedMediaTypes = mediaType === 'all' || mediaType === 'documentary' ? ['movie', 'tv'] : [mediaType];
  const { providerIds, providerMapById } = buildProviderSelection(platforms);
  const selectedLanguages = Array.isArray(options.languages)
    ? [...new Set(options.languages.filter(Boolean))]
    : [];
  const extraDiscoverParams = mediaType === 'documentary' ? { with_genres: DOCUMENTARY_GENRE_ID } : {};
  const requestedLanguagePageCount = options.languagePageCount != null
    ? Number(options.languagePageCount)
    : (snapshotMode ? SNAPSHOT_LANGUAGE_DISCOVER_PAGES : 1);
  const languagePageCount = Math.min(
    pageCount,
    Math.max(
      Number.isFinite(requestedLanguagePageCount)
        ? requestedLanguagePageCount
        : (snapshotMode ? SNAPSHOT_LANGUAGE_DISCOVER_PAGES : 1),
      1
    )
  );

  if (!providerIds.length) {
    return {
      items: [],
      meta: {
        mediaType,
        sortBy,
        region,
        platformCount: 0,
      },
    };
  }

  // A wide selection is a thousand-odd requests, and TMDB will refuse some of
  // them. `Promise.all` would throw the first refusal and take every title that
  // did arrive down with it, so each page is settled on its own and a page that
  // failed contributes nothing instead of ending the sweep.
  const discoverOutcomes = await Promise.allSettled(
    selectedMediaTypes.flatMap((type) =>
      [null, ...((options.restrictLanguages && selectedLanguages.length) ? selectedLanguages : [])].flatMap((languageCode) =>
        Array.from({ length: languageCode ? languagePageCount : pageCount }, (_, index) =>
          discoverTitles(type, providerIds, index + 1, region, {
            ...extraDiscoverParams,
            ...(languageCode ? { with_original_language: languageCode } : {}),
          }, monetizationFor(providerMapById)).then((results) =>
            results.map((item) => ({ ...item, media_type: type }))
          )
        )
      )
    )
  );

  const discoveredBatches = discoverOutcomes
    .filter((outcome) => outcome.status === 'fulfilled')
    .map((outcome) => outcome.value);
  const discoverFailures = discoverOutcomes.length - discoveredBatches.length;

  // Every page failing is not a thin catalogue, it is an outage: say so rather
  // than reporting an empty shelf as the truth about someone's services.
  if (!discoveredBatches.length && discoverOutcomes.length) {
    throw discoverOutcomes[0].reason;
  }

  const discoveredItems = dedupeCatalog(discoveredBatches.flat().map((item) => ({
    ...item,
    media_type: item.media_type || (item.title ? 'movie' : 'tv'),
  })));

  // Same again per title. One film whose details TMDB declines is one film
  // missing from the shelf, not an empty shelf.
  let enrichFailures = 0;
  const enrichedItems = (await mapWithConcurrency(discoveredItems, 5, async (item) => {
    try {
      const details = await fetchTitleDetails(item.media_type, item.id, {
        includeExternalIds,
      });
      const ratings = includeRatings
        ? await fetchOmdbRatings(details.external_ids?.imdb_id)
        : buildRatingsPayload({});
      const availableOn = normalizeProviders(details, providerMapById, region);

      return normalizeCatalogItem(item, details, ratings, availableOn, item.media_type);
    } catch {
      enrichFailures += 1;
      return null;
    }
  })).filter(Boolean);

  // Losing most of the titles means TMDB stopped answering partway through —
  // usually the breaker opening mid-sweep, which fails everything after it.
  // Persisting that as the catalogue would freeze a fraction of it in place,
  // because a scope that has been written once is no longer cold.
  if (discoveredItems.length && enrichedItems.length < discoveredItems.length * MIN_ENRICH_SUCCESS_RATIO) {
    console.warn(
      `[tmdb] abandoning sweep: only ${enrichedItems.length} of ${discoveredItems.length} titles loaded ` +
      `(${discoverFailures} discover pages and ${enrichFailures} titles refused)`
    );
    // The message reaches the app, so it says what happened rather than how.
    throw new TmdbUnavailableError('TMDB stopped answering while loading your services. Retrying shortly.');
  }

  const sortedCatalog = sortCatalog(enrichedItems, sortBy);
  const snapshotItems = sortedCatalog.slice(0, Math.min(limit, MAX_SNAPSHOT_ITEMS));
  const pageSize = Math.min(limit, DEFAULT_PAGE_SIZE);
  const offset = (page - 1) * pageSize;
  const fetchedPageLooksFull = discoveredBatches.some((batch) => batch.length >= 20);
  const pagedItems = sortedCatalog.slice(offset, offset + pageSize);
  const totalPages = Math.max(
    1,
    Math.ceil(sortedCatalog.length / pageSize),
    fetchedPageLooksFull ? page + 1 : 0
  );
  const hasMore = sortedCatalog.length > offset + pageSize || fetchedPageLooksFull;

  return {
    items: snapshotMode ? snapshotItems : pagedItems,
    meta: {
      mediaType,
      sortBy,
      region,
      languages: selectedLanguages,
      discoverFailures,
      enrichFailures,
      page: snapshotMode ? 1 : page,
      pageSize: snapshotMode ? snapshotItems.length : pageSize,
      platformCount: providerIds.length,
      resultCount: snapshotMode ? snapshotItems.length : sortedCatalog.length,
      visibleCount: snapshotMode ? snapshotItems.length : pagedItems.length,
      totalPages: snapshotMode ? 1 : totalPages,
      hasMore: snapshotMode ? false : hasMore,
      lastUpdatedAt: new Date().toISOString(),
      ratingSources: ['TMDb', 'IMDb', 'Rotten Tomatoes', 'Metacritic'],
      unavailableSources: ['Letterboxd'],
    },
  };
}

// ── Letterboxd title search ───────────────────────────────────────────────
// Searches TMDB by title + year with ±1 year tolerance.
// Tries movie first, then TV, returns {itemId, title, posterUrl, mediaType} or null.
/**
 * The form two spellings of the same title are compared in.
 *
 * This decides whether a result TMDB already returned is allowed to count, so
 * anything it throws away is a film the search found and the import reported as
 * missing. The old rule kept `[a-z0-9 ]` and deleted the rest, which lost three
 * classes of title outright:
 *
 *   - An accent was deleted rather than folded, so TMDB's "Rashōmon" became
 *     `rashmon` and could never equal an export's "Rashomon". Same for Amélie,
 *     Léon, and every other title the two sources spell differently.
 *   - A title in any non-Latin script normalised to the empty string, and the
 *     search returns null on an empty name — so those rows were reported as not
 *     found without TMDB ever being asked about them.
 *   - Punctuation was deleted instead of separating the words it sat between,
 *     so "Spider-Man" became `spiderman` and stopped matching "Spider Man".
 *
 * Folding to ASCII handles the first, `\p{L}\p{N}` keeps the second (a Japanese
 * title now normalises to itself and matches its own spelling exactly), and
 * collapsing punctuation to a single space handles the third — which also keeps
 * the word-boundary test in `titleMatches` working, since that test needs
 * single spaces to line up.
 */
function normalizeTitle(value) {
  return String(value || '')
    // NFKD so a ligature or a full-width character decomposes too, not just an
    // accented letter; the combining marks it leaves behind are then dropped.
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Every run of non-alphanumeric characters becomes one space, so words that
    // punctuation separated stay separated and words it joined stay joined.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Only accept an exact normalized-title match (or a whole-word substring match)
// so short/common titles ("Up", "It") don't wrongly match unrelated results, and
// so we never silently fall back to the first (possibly unrelated) result.
function titleMatches(candidate, normName) {
  const t = normalizeTitle(candidate);
  if (!t) return false;
  if (t === normName) return true;
  const boundary = (haystack, needle) =>
    new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(haystack);
  return boundary(t, normName) || boundary(normName, t);
}

/**
 * Which of several same-named films the diary row actually means.
 *
 * The old rule was "the first one within a year of the target", and `ordered`
 * is TMDB's own ranking, which is popularity. That is the wrong tie-breaker for
 * exactly the titles most likely to tie: a one-word title that is also an
 * ordinary word. A reader logging the 2023 Tamil *Leo* is competing against
 * every other Leo released between 2022 and 2024, and the Tamil film will not
 * be the most popular of them worldwide — so the row silently resolved to a
 * different film, and every genre, director and actor counted from it belonged
 * to somebody else. Nothing about that looks wrong from the outside; the film
 * is simply missing from its own lens.
 *
 * Two signals were already in the response and unused. An exact title beats a
 * partial one — `titleMatches` deliberately accepts whole-word substrings, so
 * "Leo" also matches "Good Luck to You, Leo Grande" — and the exact release
 * year beats a neighbouring one, since the window exists to absorb a year's
 * disagreement rather than to make three years equal.
 *
 * This ranks rather than filters: every candidate the old code would have
 * accepted is still eligible, and TMDB's popularity still decides between
 * candidates that are otherwise identical. It can only change which of several
 * matches is chosen, never whether one is found.
 */
function bestCandidate(candidates, normName, year, inYearWindow) {
  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const date = candidate.release_date || candidate.first_air_date;
    if (!inYearWindow(date)) continue;
    const candidateYear = parseInt(String(date || '').slice(0, 4), 10);
    let score = 0;
    if (normalizeTitle(candidate.title || candidate.name) === normName) score += 4;
    if (candidateYear === year) score += 2;
    // Strictly greater, so an earlier candidate wins a tie — which preserves
    // TMDB's ordering, and with it the old behaviour, wherever the two signals
    // above cannot separate two results.
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return best;
}

function shapeSearchResult(match, mediaType) {
  return {
    itemId: `${mediaType}-${match.id}`,
    title: mediaType === 'movie' ? match.title : match.name,
    posterUrl: match.poster_path ? `${TMDB_IMAGE_BASE_URL}${match.poster_path}` : null,
    mediaType,
  };
}

/**
 * Resolve a Letterboxd row (title + year) to a TMDB item.
 *
 * The first pass is a single `/search/multi` call: it covers films and series at
 * once, and because the year is matched against each result's own release date
 * rather than sent as a query parameter, one request covers the ±1 year window
 * too. The previous implementation issued a year-scoped request per media type
 * per candidate year — six sequential round trips for a title it would go on to
 * report as not found, which is exactly the case a large import hits most.
 *
 * The year-scoped searches remain as a fallback for the two cases where multi
 * can still be hiding the answer — a name match under a different release year,
 * or a first page full enough to have cut a lower-ranked exact match off — so
 * match quality is unchanged.
 */
async function searchTitleOnTmdb(name, year) {
  const normName = normalizeTitle(name);
  if (!normName) return null;

  // Letterboxd leaves Year blank for a film with no release date yet, which is
  // most of what sits at the top of a watchlist. Those rows used to be thrown
  // away before the search; now they get one, and the year half of the ranking
  // simply does not apply.
  const hasYear = Number.isFinite(year);

  const inYearWindow = (dateString) => {
    if (!hasYear) return true;
    const resultYear = parseInt(String(dateString || '').slice(0, 4), 10);
    if (!Number.isFinite(resultYear)) return false;
    return Math.abs(resultYear - year) <= 1;
  };

  // Whether the year-scoped searches below are worth issuing at all.
  let worthFallingBack = true;
  // Whether TMDB answered any of the requests below. A null return means two
  // very different things — "no such film" and "nobody picked up" — and callers
  // cache the first one. Tracking this lets the second throw instead.
  let tmdbAnswered = false;

  try {
    const data = await fetchTmdb('/search/multi', { query: name, language: 'en-US' });
    tmdbAnswered = true;
    const results = data.results || [];
    const candidates = results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
    // Films first, matching the old movie-before-TV precedence.
    const ordered = [
      ...candidates.filter((r) => r.media_type === 'movie'),
      ...candidates.filter((r) => r.media_type === 'tv'),
    ];
    const byName = ordered.filter((r) => titleMatches(r.title || r.name, normName));

    const match = bestCandidate(byName, normName, year, inYearWindow);
    if (match) return shapeSearchResult(match, match.media_type);

    // Two reasons the answer could still be out there: the title matched but
    // under a different release year, or the first page of results was full and
    // a lower-ranked exact match got cut off, which a year-scoped search would
    // float up. Neither applies when a complete page of results holds nothing by
    // that name — and that is what an unresolvable row looks like. Skipping the
    // fallback there turns the most expensive outcome, a miss, from seven
    // requests into one.
    const pageWasTruncated = Number(data.total_results || 0) > results.length;
    worthFallingBack = byName.length > 0 || pageWasTruncated;
  } catch {
    // Reaching TMDB failed rather than the title being absent — still worth retrying.
  }

  if (!worthFallingBack) return null;

  const trySearch = async (endpoint, yearParam, yearValue) => {
    try {
      // A null year needs no guard here: fetchTmdb drops null, undefined and
      // empty params when it builds the URL, so the unscoped fallback simply
      // omits the year. Re-checking it here would be a branch nothing can take.
      const data = await fetchTmdb(endpoint, { query: name, [yearParam]: yearValue, language: 'en-US' });
      tmdbAnswered = true;
      const named = (data.results || []).filter((r) => titleMatches(r.title || r.name, normName));
      // Already scoped to one year by the query, so only the title half of the
      // ranking can separate these — but that half is the one that matters when
      // a short title matches something longer. An unscoped search has not even
      // that, so the title is all there is to go on.
      return bestCandidate(named, normName, yearValue, () => true);
    } catch {
      return null;
    }
  };

  // Without a year there is nothing to scope a fallback to, and asking TMDB for
  // primary_release_year=null is a request that can only come back wrong. One
  // unscoped search per media type is the whole of the fallback.
  const movieYears = hasYear ? [year, year - 1, year + 1] : [null];
  for (const yr of movieYears) {
    const match = await trySearch('/search/movie', 'primary_release_year', yr);
    if (match) return shapeSearchResult(match, 'movie');
  }

  const tvYears = hasYear ? [year, year - 1, year + 1] : [null];
  for (const yr of tvYears) {
    const match = await trySearch('/search/tv', 'first_air_date_year', yr);
    if (match) return shapeSearchResult(match, 'tv');
  }

  // Every request failed, so nothing here is evidence about the film itself.
  if (!tmdbAnswered) throw new TmdbUnreachableError(name);

  return null;
}

async function fetchTitlesByPerson(personId, platforms) {
  const { providerIds, providerMapById } = buildProviderSelection(platforms);
  if (!providerIds.length) return [];

  const today = new Date().toISOString().slice(0, 10);

  const personData = await fetchTmdb(`/person/${personId}/combined_credits`, {
    language: 'en-US',
  });

  const allCredits = (personData.cast || []).filter((credit) => {
    if (credit.media_type !== 'movie' && credit.media_type !== 'tv') return false;
    if (!credit.poster_path) return false;
    const releaseDate = credit.release_date || credit.first_air_date || '';
    return releaseDate.length >= 10 && releaseDate.slice(0, 10) <= today;
  });

  // Deduplicate by media_type:id first, then by normalized title
  const seenIds = new Set();
  const seenTitles = new Set();
  const uniqueCredits = allCredits.filter((credit) => {
    const idKey = `${credit.media_type}:${credit.id}`;
    const titleKey = (credit.title || credit.name || '').toLowerCase().trim();
    if (seenIds.has(idKey) || (titleKey && seenTitles.has(titleKey))) return false;
    seenIds.add(idKey);
    if (titleKey) seenTitles.add(titleKey);
    return true;
  });

  const topCredits = uniqueCredits
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 24);

  const enriched = await mapWithConcurrency(topCredits, 4, async (item) => {
    try {
      const details = await fetchTmdb(`/${item.media_type}/${item.id}`, {
        append_to_response: 'watch/providers',
        language: 'en-US',
      });
      const providers = normalizeProviders(details, providerMapById);
      return normalizeCatalogItem(item, details, null, providers, item.media_type);
    } catch { return null; }
  });

  return enriched.filter(Boolean);
}

// Search TMDB for any title by query string.
// Returns all matching results (up to 20), sorted so platform-available titles
// come first. Streaming availability is annotated but not used to filter results,
// so users can find and add unwatched titles to their watchlist.
async function searchCatalog(query, { platforms = [], region = DEFAULT_REGION } = {}) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const data = await fetchTmdb('/search/multi', {
    query: trimmed,
    language: 'en-US',
    include_adult: false,
  });

  const results = (data.results || [])
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .slice(0, 20);

  if (!results.length) return [];

  const { providerMapById } = buildProviderSelection(platforms);

  const enriched = await mapWithConcurrency(results, 5, async (item) => {
    try {
      const details = await fetchTitleDetails(item.media_type, item.id, { includeExternalIds: false });
      const providers = normalizeProviders(details, providerMapById, region);
      return normalizeCatalogItem(item, details, buildRatingsPayload({}), providers, item.media_type);
    } catch {
      return null;
    }
  });

  const valid = enriched.filter(Boolean);
  // Surface platform-available titles first, then by TMDB popularity
  valid.sort((a, b) => {
    const aAvail = a.availableOnKeys.length > 0 ? 1 : 0;
    const bAvail = b.availableOnKeys.length > 0 ? 1 : 0;
    if (bAvail !== aAvail) return bAvail - aAvail;
    return (b.popularity || 0) - (a.popularity || 0);
  });
  return valid;
}

module.exports = {
  PLATFORM_CONFIG,
  fetchOmdbRatings,
  fetchCatalogByPlatforms,
  fetchTitleDetails,
  fetchTitleWithCredits,
  isOmdbRateLimited,
  searchTitleOnTmdb,
  TmdbUnreachableError,
  TmdbUnavailableError,
  isTmdbUnavailable,
  resetTmdbBreaker,
  // Test seam. The response caches are module-level and live ten minutes, so a
  // suite that reuses a URL across cases otherwise answers the second case from
  // the first case's fixture.
  clearApiCaches: () => { tmdbCache.clear(); omdbCache.clear(); },
  isTmdbRefusal,
  includedProviders,
  selectionIncludesPurchase,
  monetizationFor,
  PURCHASE_MONETIZATION,
  VOD_KEY,
  searchCatalog,
  fetchTitlesByPerson,
  // Exported for unit testing
  buildRatingsPayload,
  toSortableRating,
  sortCatalog,
  buildProviderSelection,
  normalizeProviders,
};
