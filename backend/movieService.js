require('dotenv').config();

const TMDB_CREDENTIAL = process.env.TMDB_API_KEY;
const OMDB_API_KEY = process.env.OMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const DEFAULT_REGION = 'US';
const DISCOVER_PAGE_COUNT = 1;
const CACHE_TTL_MS = 10 * 60 * 1000;
const DOCUMENTARY_GENRE_ID = 99;
const DEFAULT_PAGE_SIZE = 24;
const PREFETCH_DISCOVER_PAGES = 5;
const SNAPSHOT_DISCOVER_PAGES = 6;
const MAX_SNAPSHOT_ITEMS = 300;

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

const PLATFORM_CONFIG = {
  netflix:    { id: 8,    name: 'Netflix' },
  hulu:       { id: 15,   name: 'Hulu' },
  prime:      { id: 9,    name: 'Prime Video' },
  disney:     { id: 337,  name: 'Disney+' },
  paramount:  { ids: [2303, 2616], name: 'Paramount+' },  // Premium + Essential
  apple:      { id: 350,  name: 'Apple TV+' },            // was 2 (Apple TV Store = rentals)
  peacock:    { id: 386,  name: 'Peacock' },
  max:        { id: 1899, name: 'Max' },                  // was 384 (nonexistent)
  crunchyroll:{ id: 283,  name: 'Crunchyroll' },          // was 105 (nonexistent)
  starz:      { id: 43,   name: 'Starz' },                // was 318 (Adult Swim)
  showtime:   { id: 37,   name: 'Showtime' },
  amc:        { id: 526,  name: 'AMC+' },                 // was 174 (nonexistent)
  tubi:       { id: 73,   name: 'Tubi' },                 // was 219 (nonexistent)
  pluto:      { id: 300,  name: 'Pluto TV' },
  roku:       { id: 207,  name: 'The Roku Channel' },     // was 432 (Flix Premiere)
  youtube:    { id: 188,  name: 'YouTube Premium' },      // was 192 (plain YouTube)
  mubi:       { id: 11,   name: 'MUBI' },
  britbox:    { id: 151,  name: 'BritBox' },              // was 370 (nonexistent)
  hayu:       { id: 223,  name: 'Hayu' },
  shudder:    { id: 99,   name: 'Shudder' },              // was 67 (nonexistent)
  acorn:      { id: 87,   name: 'Acorn TV' },             // was 1 (nonexistent)
  curiosity:  { id: 190,  name: 'Curiosity Stream' },     // was 179 (nonexistent)
  sling:      { id: 299,  name: 'Sling TV' },             // was 405 (nonexistent)
  philo:      { id: 2383, name: 'Philo' },                // was 342 (nonexistent)
  fubo:       { id: 257,  name: 'fuboTV' },               // was 283 (= Crunchyroll!)
  viu:        { id: 270,  name: 'Viu' },
  kanopy:     { id: 191,  name: 'Kanopy' },               // was 221 (nonexistent)
  crave:      { id: 230,  name: 'Crave' },
  ifc:        { id: 338,  name: 'IFC Films Unlimited' },
  criterion:  { id: 258,  name: 'Criterion Channel' },    // was 31 (nonexistent)
  hidive:     { id: 430,  name: 'HiDive' },
};

const tmdbCache = new Map();
const omdbCache = new Map();

function getCacheEntry(cache, key) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCacheEntry(cache, key, value, ttlMs = CACHE_TTL_MS) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
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
    throw new Error(data.status_message || data.Error || data.message || `Request failed with status ${response.status}`);
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

  const data = await fetchJson(url.toString(), {
    headers: buildTmdbHeaders(),
  });

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

async function discoverTitles(mediaType, providerIds, page, region = DEFAULT_REGION, extraParams = {}) {
  const data = await fetchTmdb(`/discover/${mediaType}`, {
    include_adult: false,
    include_video: mediaType === 'movie' ? false : undefined,
    language: 'en-US',
    page,
    sort_by: 'popularity.desc',
    watch_region: region,
    with_watch_monetization_types: 'flatrate',
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
    append_to_response: 'credits',
    language: 'en-US',
  });
}

function normalizeProviders(details, providerMapById, region = DEFAULT_REGION) {
  const regionProviders = details['watch/providers']?.results?.[region]?.flatrate || [];
  const mappedProviders = regionProviders
    .map((provider) => providerMapById.get(provider.provider_id))
    .filter(Boolean);

  return {
    names: mappedProviders.map((provider) => provider.name),
    keys: mappedProviders.map((provider) => provider.key),
  };
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
    year: releaseDate ? String(releaseDate).slice(0, 4) : null,
    posterPath: rawItem.poster_path || details.poster_path || null,
    posterUrl: rawItem.poster_path || details.poster_path ? `${TMDB_IMAGE_BASE_URL}${rawItem.poster_path || details.poster_path}` : null,
    backdropPath: rawItem.backdrop_path || details.backdrop_path || null,
    tmdbRating: rawItem.vote_average || details.vote_average || null,
    tmdbVoteCount: rawItem.vote_count || details.vote_count || null,
    popularity: rawItem.popularity || details.popularity || null,
    originalLanguage: rawItem.original_language || details.original_language || null,
    genres: Array.isArray(details.genres) ? details.genres.map((genre) => genre.name) : [],
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

  sorted.sort((left, right) => {
    switch (sortBy) {
      case 'title':
        return left.title.localeCompare(right.title);
      case 'release_date':
        return String(right.releaseDate || '').localeCompare(String(left.releaseDate || ''));
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
  const limit = Math.min(Math.max(Number(options.limit) || DEFAULT_PAGE_SIZE, 1), 500);
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
    20
  );
  const selectedMediaTypes = mediaType === 'all' || mediaType === 'documentary' ? ['movie', 'tv'] : [mediaType];
  const { providerIds, providerMapById } = buildProviderSelection(platforms);
  const selectedLanguages = Array.isArray(options.languages)
    ? options.languages.filter(Boolean)
    : [];
  const extraDiscoverParams = mediaType === 'documentary' ? { with_genres: DOCUMENTARY_GENRE_ID } : {};

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

  const discoveredBatches = await Promise.all(
    selectedMediaTypes.flatMap((type) =>
      ((options.restrictLanguages && selectedLanguages.length) ? selectedLanguages : [null]).flatMap((languageCode) =>
        Array.from({ length: pageCount }, (_, index) =>
          discoverTitles(type, providerIds, index + 1, region, {
            ...extraDiscoverParams,
            ...(languageCode ? { with_original_language: languageCode } : {}),
          }).then((results) =>
            results.map((item) => ({ ...item, media_type: type }))
          )
        )
      )
    )
  );

  const discoveredItems = dedupeCatalog(discoveredBatches.flat().map((item) => ({
    ...item,
    media_type: item.media_type || (item.title ? 'movie' : 'tv'),
  })));

  const enrichedItems = await mapWithConcurrency(discoveredItems, 5, async (item) => {
    const details = await fetchTitleDetails(item.media_type, item.id, {
      includeExternalIds,
    });
    const ratings = includeRatings
      ? await fetchOmdbRatings(details.external_ids?.imdb_id)
      : buildRatingsPayload({});
    const availableOn = normalizeProviders(details, providerMapById, region);

    return normalizeCatalogItem(item, details, ratings, availableOn, item.media_type);
  });

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
async function searchTitleOnTmdb(name, year) {
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const normName = normalize(name);

  const trySearch = async (endpoint, yearParam, yearValue) => {
    try {
      const data = await fetchTmdb(endpoint, { query: name, [yearParam]: yearValue, language: 'en-US' });
      const results = data.results || [];
      const match =
        results.find((r) => {
          const t = normalize(r.title || r.name || '');
          return t === normName || t.includes(normName) || normName.includes(t);
        }) || (results.length > 0 ? results[0] : null);
      return match;
    } catch {
      return null;
    }
  };

  // Try movie with exact year, then ±1
  for (const yr of [year, year - 1, year + 1]) {
    const match = await trySearch('/search/movie', 'primary_release_year', yr);
    if (match) {
      return {
        itemId: `movie-${match.id}`,
        title: match.title,
        posterUrl: match.poster_path ? `${TMDB_IMAGE_BASE_URL}${match.poster_path}` : null,
        mediaType: 'movie',
      };
    }
  }

  // Fallback to TV search
  for (const yr of [year, year - 1, year + 1]) {
    const match = await trySearch('/search/tv', 'first_air_date_year', yr);
    if (match) {
      return {
        itemId: `tv-${match.id}`,
        title: match.name,
        posterUrl: match.poster_path ? `${TMDB_IMAGE_BASE_URL}${match.poster_path}` : null,
        mediaType: 'tv',
      };
    }
  }

  return null;
}

async function fetchTitlesByPerson(personId, platforms) {
  const { providerIds, providerMapById } = buildProviderSelection(platforms);
  if (!providerIds.length) return [];

  const [movieResults, tvResults] = await Promise.all([
    discoverTitles('movie', providerIds, 1, DEFAULT_REGION, { with_cast: String(personId) }),
    discoverTitles('tv', providerIds, 1, DEFAULT_REGION, { with_cast: String(personId) }),
  ]);

  const allItems = dedupeCatalog([
    ...movieResults.map((item) => ({ ...item, media_type: 'movie' })),
    ...tvResults.map((item) => ({ ...item, media_type: 'tv' })),
  ]).slice(0, 24);

  const enriched = await mapWithConcurrency(allItems, 4, async (item) => {
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

module.exports = {
  PLATFORM_CONFIG,
  fetchOmdbRatings,
  fetchCatalogByPlatforms,
  fetchTitleDetails,
  fetchTitleWithCredits,
  isOmdbRateLimited,
  searchTitleOnTmdb,
  fetchTitlesByPerson,
  // Exported for unit testing
  buildRatingsPayload,
  toSortableRating,
};
