'use strict';

/**
 * One person's work, narrowed to what the reader can actually watch.
 *
 * Two things were wrong with the answer this used to give. It read only the
 * `cast` half of `combined_credits`, so a director's films were invisible —
 * directing is a crew credit, and the Directors lens could only ever have
 * answered with the cameos they happened to appear in. And it returned every
 * credit whatever its availability, while the screen showing them said "no
 * titles found on your streaming services", which was a sentence about a list
 * that was not the list underneath it.
 *
 * A person is also asked about in a role. "What has this person directed" and
 * "what has this person been in" are different questions, and for the many
 * directors who also act they used to get the same answer.
 */

process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || 'test-key';

const { createTestDb, closeDb } = require('../testHelpers');
const {
  getPersonTitlesOnPlatforms, collectPersonCredits, buildScopeKey,
} = require('../../catalogCache');
const { clearApiCaches, resetTmdbBreaker } = require('../../movieService');

const FILMS = {
  10: { title: 'Directed, on Netflix', flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] },
  20: { title: 'Directed, nowhere',    flatrate: [] },
  30: { title: 'Wrote, on Netflix',    flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] },
  40: { title: 'Acted, on Netflix',    flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] },
  50: { title: 'Unreleased',           flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] },
};

let detailCalls = 0;

function credit(id, extra) {
  return {
    id, media_type: 'movie', title: FILMS[id].title, poster_path: '/p.jpg',
    release_date: id === 50 ? '2999-01-01' : '2020-01-01',
    popularity: 100 - id, vote_average: 7, ...extra,
  };
}

const CREDITS = {
  cast: [credit(40, { character: 'Herself' })],
  crew: [
    credit(10, { job: 'Director' }),
    credit(20, { job: 'Director' }),
    credit(30, { job: 'Screenplay' }),
    credit(50, { job: 'Director' }),
  ],
};

function installTmdb() {
  detailCalls = 0;
  global.fetch = jest.fn(async (url) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/3/, '');
    const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

    if (path === '/search/person') {
      return json({ results: [{ id: 500, name: 'Ava Example', popularity: 9 }] });
    }
    if (path === '/person/500') return json({ id: 500, name: 'Ava Example' });
    if (path === '/person/500/combined_credits') return json(CREDITS);

    const detail = path.match(/^\/movie\/(\d+)$/);
    if (detail) {
      detailCalls += 1;
      const film = FILMS[detail[1]];
      return json({
        id: Number(detail[1]), title: film.title, release_date: '2020-01-01',
        genres: [], overview: '', poster_path: '/p.jpg', vote_average: 7, vote_count: 100,
        'watch/providers': { results: { US: { flatrate: film.flatrate, rent: [], buy: [] } } },
      });
    }
    return json({});
  });
}

describe('what of one person\'s work is on your services', () => {
  let db;
  const platforms = ['netflix'];
  const ask = (person, role) => getPersonTitlesOnPlatforms(db, {
    person, role, platforms, languages: [], region: 'US',
  });
  const titles = (result) => result.items.map((i) => i.title);

  beforeEach(async () => {
    db = await createTestDb();
    resetTmdbBreaker(); clearApiCaches(); installTmdb();
  });
  afterEach(async () => { delete global.fetch; clearApiCaches(); await closeDb(db); });

  test('finds work a person directed, which is a crew credit', async () => {
    // The whole point. Reading only `cast` returned nothing here.
    expect(titles(await ask('p:500', 'director'))).toEqual(['Directed, on Netflix']);
  });

  test('leaves out what the reader cannot watch', async () => {
    // "Directed, nowhere" is on none of their services. Listing it would make
    // the screen's own empty-state sentence untrue of the screen.
    const result = await ask('p:500', 'director');
    expect(titles(result)).not.toContain('Directed, nowhere');
    expect(result.items.every((i) => i.availableOn.length || i.purchaseOn.length)).toBe(true);
  });

  test('answers in the role it was asked about', async () => {
    // A director who acts is not two people, but "what did they direct" and
    // "what were they in" are two questions.
    expect(titles(await ask('p:500', 'director'))).toEqual(['Directed, on Netflix']);
    expect(titles(await ask('p:500', 'writer'))).toEqual(['Wrote, on Netflix']);
    expect(titles(await ask('p:500', 'actor'))).toEqual(['Acted, on Netflix']);
  });

  test('with no role, every credit counts', async () => {
    expect(titles(await ask('p:500', null)).sort()).toEqual([
      'Acted, on Netflix', 'Directed, on Netflix', 'Wrote, on Netflix',
    ]);
  });

  test('keeps the credit that earned the row', async () => {
    const [film] = (await ask('p:500', 'writer')).items;
    expect(film.roles).toEqual(['Screenplay']);
  });

  test('resolves a name when the import never captured an id', async () => {
    // Histories imported before crew ids were kept identify people by name.
    const result = await ask('n:Ava Example', 'director');
    expect(result.personId).toBe(500);
    expect(result.personName).toBe('Ava Example');
    expect(titles(result)).toEqual(['Directed, on Netflix']);
  });

  test('names the person even when asked by id', async () => {
    // A credit carries no name, so a page opened by id would otherwise have
    // nothing to put at the top of it.
    expect((await ask('p:500', 'director')).personName).toBe('Ava Example');
  });

  test('leaves out work nobody can watch yet', async () => {
    expect(titles(await ask('p:500', 'director'))).not.toContain('Unreleased');
  });

  test('costs no request for a title the catalog already knows', async () => {
    // A prolific career is hundreds of credits and each lookup is a request.
    // The reader's own scope already holds resolved availability for every
    // title in it, so the common case should be free.
    const scopeKey = buildScopeKey(platforms, 'US', []);
    await new Promise((res, rej) => db.run(
      `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, year, poster_url,
         popularity, available_on_json, available_on_keys_json, purchase_on_json, updated_at)
       VALUES (?, 'movie', 10, ?, 2020, '/p.jpg', 90, ?, ?, '[]', ?)`,
      [scopeKey, FILMS[10].title, JSON.stringify(['Netflix']), JSON.stringify(['netflix']),
       new Date().toISOString()],
      (e) => (e ? rej(e) : res())));

    clearApiCaches();
    detailCalls = 0;
    const result = await ask('p:500', 'director');

    expect(titles(result)).toEqual(['Directed, on Netflix']);
    // Only "Directed, nowhere" needed pricing up; the cached one was free.
    expect(detailCalls).toBe(1);
  });

  test('leaves out a cached title that is on none of their services', async () => {
    // The catalog scope holds every title in the sweep, including ones whose
    // availability resolved to nothing. Those rows are cheap to return and
    // wrong to return, and the live path's filter does not cover them.
    const scopeKey = buildScopeKey(platforms, 'US', []);
    await new Promise((res, rej) => db.run(
      `INSERT INTO catalog_cache_entries (scope_key, media_type, tmdb_id, title, year, poster_url,
         popularity, available_on_json, available_on_keys_json, purchase_on_json, updated_at)
       VALUES (?, 'movie', 20, ?, 2020, '/p.jpg', 80, '[]', '[]', '[]', ?)`,
      [scopeKey, FILMS[20].title, new Date().toISOString()],
      (e) => (e ? rej(e) : res())));

    clearApiCaches();
    expect(titles(await ask('p:500', 'director'))).toEqual(['Directed, on Netflix']);
  });

  test('asks TMDB nothing at all when no services are picked', async () => {
    // An empty provider set resolves nothing, so the list comes back empty
    // either way — but without the guard it costs a person search, a profile,
    // a credits call and thirty title lookups to arrive at the same nothing.
    clearApiCaches();
    global.fetch.mockClear();

    const result = await getPersonTitlesOnPlatforms(db, {
      person: 'p:500', role: 'director', platforms: [], languages: [], region: 'US',
    });

    expect(result.items).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('gathering a person\'s credits', () => {
  test('merges a film they both directed and wrote into one row', async () => {
    const both = {
      cast: [],
      crew: [
        credit(10, { job: 'Director' }),
        { ...credit(10, { job: 'Screenplay' }) },
      ],
    };
    const rows = collectPersonCredits(both, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].roles).toEqual(['Director', 'Screenplay']);
  });
});
