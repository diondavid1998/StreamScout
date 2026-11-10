'use strict';

/**
 * "Just Added" lists what arrived since the last look, not the back catalogue.
 *
 * A sync stamps the first time it sees a title, and Just Added sorts on that
 * stamp. But a scope's first sync has nothing to compare with: everything in
 * it was already on the service. Stamping those as new put the entire catalog
 * at the top of Just Added — and when the catalog was swept deeper, several
 * thousand long-available titles at once, burying anything genuinely new.
 */

process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || 'test-key';

jest.mock('../../movieService', () => ({
  ...jest.requireActual('../../movieService'),
  fetchCatalogByPlatforms: jest.fn(),
}));

const { createTestDb, closeDb } = require('../testHelpers');
const { syncScope, readCachedCatalog, buildScopeKey } = require('../../catalogCache');
const { fetchCatalogByPlatforms } = require('../../movieService');

const SCOPE = buildScopeKey(['netflix'], 'US', []);
const film = (id) => ({
  mediaType: 'movie', tmdbId: id, title: `Film ${id}`, overview: '', year: 2020,
  genres: [], ratings: {}, sortableRatings: {}, availableOn: ['Netflix'],
  availableOnKeys: ['netflix'], purchaseOn: [],
});

describe('Just Added after a baseline sync', () => {
  let db;
  beforeEach(async () => { db = await createTestDb(); fetchCatalogByPlatforms.mockReset(); });
  afterEach(() => closeDb(db));

  const justAdded = async () => (await readCachedCatalog(db, {
    scopeKey: SCOPE, sortBy: 'recently_added', pageSize: 10,
  })).items.map((i) => i.title);

  test('lists a title that arrived after the first sync ahead of the back catalogue', async () => {
    fetchCatalogByPlatforms.mockResolvedValue({ items: [film(1), film(2), film(3)], meta: {} });
    await syncScope(db, { platforms: ['netflix'], languages: [], region: 'US' });

    fetchCatalogByPlatforms.mockResolvedValue({ items: [film(1), film(2), film(3), film(4)], meta: {} });
    await syncScope(db, { platforms: ['netflix'], languages: [], region: 'US' });

    expect((await justAdded())[0]).toBe('Film 4');
  });

  test('a title from the baseline keeps its baseline place on later syncs', async () => {
    // COALESCE keeps the first stamp. If the baseline stamp were null, the next
    // sync would fill it with today and flood Just Added after all.
    fetchCatalogByPlatforms.mockResolvedValue({ items: [film(1)], meta: {} });
    await syncScope(db, { platforms: ['netflix'], languages: [], region: 'US' });
    fetchCatalogByPlatforms.mockResolvedValue({ items: [film(1), film(9)], meta: {} });
    await syncScope(db, { platforms: ['netflix'], languages: [], region: 'US' });
    fetchCatalogByPlatforms.mockResolvedValue({ items: [film(1), film(9)], meta: {} });
    await syncScope(db, { platforms: ['netflix'], languages: [], region: 'US' });

    expect(await justAdded()).toEqual(['Film 9', 'Film 1']);
  });

  test('a provider config change starts a new baseline rather than a flood', async () => {
    fetchCatalogByPlatforms.mockResolvedValue({ items: [film(1)], meta: {} });
    await syncScope(db, { platforms: ['netflix'], languages: [], region: 'US' });
    fetchCatalogByPlatforms.mockResolvedValue({ items: [film(1), film(2)], meta: {} });
    await syncScope(db, { platforms: ['netflix'], languages: [], region: 'US' });

    // What a deploy that bumps PROVIDER_CONFIG_VERSION does — and this one does,
    // sweeping deeper and so finding many titles for the first time.
    await new Promise((r, j) => db.run('DELETE FROM catalog_cache_state', (e) => (e ? j(e) : r())));
    fetchCatalogByPlatforms.mockResolvedValue({
      items: [film(1), film(2), ...[101, 102, 103].map(film)], meta: {},
    });
    await syncScope(db, { platforms: ['netflix'], languages: [], region: 'US' });

    // Film 2 genuinely arrived; the three the deeper sweep surfaced did not.
    expect((await justAdded())[0]).toBe('Film 2');
  });
});
