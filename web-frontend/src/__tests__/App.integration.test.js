/**
 * Integration tests for the WhatsOn React app.
 * The backend API is mocked via jest.fn() / global.fetch mock.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

// ── Fetch mock helpers ────────────────────────────────────────────────────────

function mockResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function setupFetchMock(responses) {
  let idx = 0;
  global.fetch = jest.fn(() => {
    const r = Array.isArray(responses)
      ? responses[Math.min(idx++, responses.length - 1)]
      : responses;
    return Promise.resolve(r);
  });
}

// Give catalog flow tests enough time (session restore + navigate + render)
jest.setTimeout(15000);

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

// ── Shared fixtures ───────────────────────────────────────────────────────────

const EMPTY_CATALOG = {
  items: [],
  meta: {
    page: 1,
    pageSize: 24,
    totalPages: 1,
    resultCount: 0,
    visibleCount: 0,
    mediaType: 'all',
    sortBy: 'popularity',
    activeServiceFilters: [],
    activeLanguageFilters: [],
    platformCount: 0,
  },
};

const SAMPLE_CATALOG = {
  items: [
    {
      id: 'movie-123',
      title: 'Test Movie',
      mediaType: 'movie',
      year: 2024,
      overview: 'A great test movie.',
      posterUrl: null,
      genres: ['Action', 'Drama'],
      availableOn: ['Netflix'],
      popularity: 100,
      ratings: { tmdb: 8.5, imdb: '8.5/10', rottenTomatoes: '92%', metacritic: '85/100' },
    },
    {
      id: 'tv-456',
      title: 'Test Show',
      mediaType: 'tv',
      year: 2023,
      overview: 'A great test show.',
      posterUrl: null,
      genres: ['Drama'],
      availableOn: ['Hulu'],
      popularity: 80,
      ratings: { tmdb: 7.2, imdb: null, rottenTomatoes: null, metacritic: null },
    },
  ],
  meta: {
    page: 1,
    pageSize: 24,
    totalPages: 3,
    resultCount: 60,
    visibleCount: 2,
    mediaType: 'all',
    sortBy: 'popularity',
    activeServiceFilters: [],
    activeLanguageFilters: [],
    platformCount: 2,
  },
};

// ── Auth page ─────────────────────────────────────────────────────────────────

describe('Auth page', () => {
  it('renders the Sign In form by default', async () => {
    // No token in storage → no fetch needed
    global.fetch = jest.fn();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    });
    // Button specifically
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument();
  });

  it('switches to Register mode when "Create one" is clicked', async () => {
    global.fetch = jest.fn();

    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Username')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Create one'));
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
  });

  it('shows an error returned from the API on login failure', async () => {
    setupFetchMock([
      mockResponse({ error: 'Invalid credentials' }, { ok: false, status: 401 }),
    ]);

    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Username')).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText('Username'), 'wronguser');
    await userEvent.type(screen.getByPlaceholderText('Password'), 'wrongpass');
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

    await waitFor(() => {
      expect(screen.getByText(/Invalid credentials/i)).toBeInTheDocument();
    });
  });

  it('calls /login then /platforms after successful login', async () => {
    setupFetchMock([
      mockResponse({ token: 'mock-jwt-token' }),           // POST /login
      mockResponse({ platforms: [], languages: [] }),       // GET /platforms
    ]);

    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Username')).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText('Username'), 'testuser');
    await userEvent.type(screen.getByPlaceholderText('Password'), 'password123');
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
      const calls = global.fetch.mock.calls.map((c) => c[0]);
      expect(calls[0]).toContain('/login');
      expect(calls[1]).toContain('/platforms');
    });
  });

  it('shows Register form when toggled', async () => {
    global.fetch = jest.fn();

    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Username')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Create one'));

    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
    expect(screen.getByText('Sign in instead')).toBeInTheDocument();
  });
});

// ── Logged-in session: catalog view ──────────────────────────────────────────

/**
 * Routes by URL rather than by call order. The catalog page fires several
 * requests concurrently (/movies, /watched, /watchlist), so an index-based
 * mock hands the wrong body to whichever happens to land second.
 */
function setupApiMock({ platforms = ['netflix'], catalog = EMPTY_CATALOG, watchlist = [], watched = [], search = [] } = {}) {
  global.fetch = jest.fn((url, options = {}) => {
    const href = String(url);
    if (href.includes('/platforms')) {
      return Promise.resolve(
        options.method === 'PUT'
          ? mockResponse({ success: true })
          : mockResponse({ platforms, languages: [] })
      );
    }
    if (href.includes('/search')) return Promise.resolve(mockResponse({ items: search }));
    if (href.includes('/movies')) return Promise.resolve(mockResponse(catalog));
    if (href.includes('/watchlist')) return Promise.resolve(mockResponse({ items: watchlist }));
    if (href.includes('/watched')) return Promise.resolve(mockResponse({ items: watched }));
    if (href.includes('/catalog-status')) return Promise.resolve(mockResponse({ lastSyncedAt: null, itemCount: 0 }));
    return Promise.resolve(mockResponse({}));
  });
  return global.fetch;
}

describe('Logged-in catalog view', () => {
  function setupLoggedInSession() {
    localStorage.setItem('whatsOn.authToken', 'mock-jwt');
    localStorage.setItem('whatsOn.username', 'testuser');
  }

  /**
   * A user with saved platforms lands on the catalog directly — session restore
   * reads /platforms and skips the picker when the list is non-empty.
   */
  async function renderToCatalog(catalog = EMPTY_CATALOG, extra = {}) {
    setupLoggedInSession();
    const fetchMock = setupApiMock({ catalog, ...extra });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Settings/i })).toBeInTheDocument();
    }, { timeout: 8000 });

    return fetchMock;
  }

  it('restores the session and loads the catalog without visiting the picker', async () => {
    await renderToCatalog();

    const urls = global.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/platforms'))).toBe(true);
    expect(urls.some((u) => u.includes('/movies'))).toBe(true);
    // Platforms are already saved, so the setup screen is skipped entirely.
    expect(screen.queryByRole('button', { name: /Save and Continue/i })).not.toBeInTheDocument();
  });

  it('sends the user to the picker when no platforms are saved', async () => {
    setupLoggedInSession();
    setupApiMock({ platforms: [] });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save and Continue/i })).toBeInTheDocument();
    }, { timeout: 8000 });
  });

  it('PUTs /platforms and loads the catalog on Save and Continue', async () => {
    setupLoggedInSession();
    setupApiMock({ platforms: [], catalog: SAMPLE_CATALOG });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save and Continue/i })).toBeInTheDocument();
    }, { timeout: 8000 });

    fireEvent.click(screen.getByLabelText('Netflix'));
    fireEvent.click(screen.getByRole('button', { name: /Save and Continue/i }));

    await waitFor(() => {
      const methods = global.fetch.mock.calls.map((c) => c[1]?.method);
      expect(methods).toContain('PUT');
    }, { timeout: 8000 });

    await waitFor(() => {
      expect(screen.getByText('Test Movie')).toBeInTheDocument();
    }, { timeout: 8000 });
  });

  it('requests the catalog exactly once when entering it', async () => {
    // The watchlistIds Set is rebuilt on every load; depending on its identity
    // used to change fetchMovies' identity and fire a second, identical request.
    await renderToCatalog(SAMPLE_CATALOG, {
      watchlist: [{ itemId: 'movie-999', title: 'Saved', mediaType: 'movie' }],
    });

    await waitFor(() => expect(screen.getByText('Test Movie')).toBeInTheDocument(), { timeout: 8000 });
    await new Promise((resolve) => setTimeout(resolve, 600));

    const movieCalls = global.fetch.mock.calls.filter((c) => String(c[0]).includes('/movies'));
    expect(movieCalls).toHaveLength(1);
  });

  it('renders movie cards returned from the API', async () => {
    await renderToCatalog(SAMPLE_CATALOG);

    await waitFor(() => {
      expect(screen.getByText('Test Movie')).toBeInTheDocument();
      expect(screen.getByText('Test Show')).toBeInTheDocument();
    }, { timeout: 8000 });
  });

  it('displays the TMDb rating badge', async () => {
    await renderToCatalog(SAMPLE_CATALOG);

    await waitFor(() => {
      expect(screen.getByText('Test Movie')).toBeInTheDocument();
    }, { timeout: 8000 });

    expect(screen.getByText('8.5')).toBeInTheDocument();
  });

  it('shows genre chips on movie cards', async () => {
    await renderToCatalog(SAMPLE_CATALOG);

    await waitFor(() => {
      expect(screen.getByText('Test Movie')).toBeInTheDocument();
    }, { timeout: 8000 });

    expect(screen.getByText('Action')).toBeInTheDocument();
  });

  it('shows pagination controls with correct page count', async () => {
    await renderToCatalog(SAMPLE_CATALOG); // totalPages: 3

    await waitFor(() => {
      expect(screen.getByText('Test Movie')).toBeInTheDocument();
    }, { timeout: 8000 });

    // Exact, case-sensitive: the meta line above also reads "page 1 of 3".
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prev/i })).toBeDisabled();
  });

  it('offers the media-type options as a select', async () => {
    await renderToCatalog();

    // The All / Movies / Shows buttons were replaced by a dropdown.
    const typeSelect = await screen.findByDisplayValue('Movies + TV');
    expect(typeSelect).toBeInTheDocument();
    expect(within(typeSelect).getByRole('option', { name: 'Movies' })).toBeInTheDocument();
    expect(within(typeSelect).getByRole('option', { name: 'TV Shows' })).toBeInTheDocument();
    expect(within(typeSelect).getByRole('option', { name: 'Documentary' })).toBeInTheDocument();
  });

  it('shows a Genre filter option', async () => {
    await renderToCatalog();

    await waitFor(() => {
      expect(screen.getByText(/Genre/i)).toBeInTheDocument();
    }, { timeout: 8000 });
  });

  it('uses 1950 as the default lower bound for the year range filter', async () => {
    await renderToCatalog();

    const yearRangeButton = await screen.findByRole('button', { name: /Year Range/i });
    fireEvent.click(yearRangeButton);

    const [minSlider, maxSlider] = screen.getAllByRole('slider');

    expect(minSlider).toHaveAttribute('min', '1950');
    expect(minSlider).toHaveValue('1950');
    expect(maxSlider).toHaveAttribute('min', '1950');
    expect(maxSlider).toHaveValue(String(new Date().getFullYear()));
  });
});

// ── Search and watchlist ─────────────────────────────────────────────────────

describe('Search', () => {
  const SEARCH_RESULT = {
    id: 'movie-777',
    title: 'Obscure Indie Film',
    mediaType: 'movie',
    year: 1998,
    overview: 'Not in the popular snapshot.',
    genres: [],
    availableOn: [],
    popularity: 1,
    ratings: {},
  };

  beforeEach(() => {
    localStorage.setItem('whatsOn.authToken', 'mock-jwt');
    localStorage.setItem('whatsOn.username', 'testuser');
  });

  async function renderCatalog(extra = {}) {
    setupApiMock({ catalog: SAMPLE_CATALOG, ...extra });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Test Movie')).toBeInTheDocument(), { timeout: 8000 });
  }

  it('queries /search and shows results in place of the catalog', async () => {
    await renderCatalog({ search: [SEARCH_RESULT] });

    fireEvent.change(screen.getByLabelText(/Search all movies/i), {
      target: { value: 'obscure' },
    });

    await waitFor(() => {
      expect(screen.getByText('Obscure Indie Film')).toBeInTheDocument();
    }, { timeout: 8000 });

    const searchCalls = global.fetch.mock.calls.filter((c) => String(c[0]).includes('/search'));
    expect(searchCalls.length).toBeGreaterThan(0);
    expect(String(searchCalls[0][0])).toContain('q=obscure');
    // The catalog grid is replaced while a search is active.
    expect(screen.queryByText('Test Movie')).not.toBeInTheDocument();
  });

  it('does not search for a single character', async () => {
    await renderCatalog({ search: [SEARCH_RESULT] });

    fireEvent.change(screen.getByLabelText(/Search all movies/i), { target: { value: 'o' } });
    await new Promise((resolve) => setTimeout(resolve, 600));

    const searchCalls = global.fetch.mock.calls.filter((c) => String(c[0]).includes('/search'));
    expect(searchCalls).toHaveLength(0);
  });

  it('returns to the catalog when the search is cleared', async () => {
    await renderCatalog({ search: [SEARCH_RESULT] });

    const input = screen.getByLabelText(/Search all movies/i);
    fireEvent.change(input, { target: { value: 'obscure' } });
    await waitFor(() => expect(screen.getByText('Obscure Indie Film')).toBeInTheDocument(), { timeout: 8000 });

    fireEvent.click(screen.getByRole('button', { name: /Back to catalog/i }));

    await waitFor(() => expect(screen.getByText('Test Movie')).toBeInTheDocument(), { timeout: 8000 });
  });
});

describe('Clearing and importing saved lists', () => {
  beforeEach(() => {
    localStorage.setItem('whatsOn.authToken', 'mock-jwt');
    localStorage.setItem('whatsOn.username', 'testuser');
  });

  async function openWatchlistTab(extra = {}) {
    setupApiMock({ catalog: SAMPLE_CATALOG, ...extra });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Test Movie')).toBeInTheDocument(), { timeout: 8000 });
    fireEvent.click(screen.getByRole('button', { name: /Settings/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Watchlist/i }));
  }

  it('sends DELETE /watchlist when the clear button is confirmed', async () => {
    window.confirm = jest.fn(() => true);
    await openWatchlistTab({
      watchlist: [{ itemId: 'movie-9', title: 'Saved', mediaType: 'movie' }],
    });

    const clearButtons = await screen.findAllByRole('button', { name: /Clear all/i });
    fireEvent.click(clearButtons[1]);

    await waitFor(() => {
      const call = global.fetch.mock.calls.find(
        (c) => String(c[0]).endsWith('/watchlist') && c[1]?.method === 'DELETE'
      );
      expect(call).toBeTruthy();
    }, { timeout: 8000 });
  });

  it('does not call the API when the confirm is declined', async () => {
    window.confirm = jest.fn(() => false);
    await openWatchlistTab({
      watched: [{ itemId: 'movie-1', title: 'Seen', mediaType: 'movie' }],
    });

    const clearButtons = await screen.findAllByRole('button', { name: /Clear all/i });
    fireEvent.click(clearButtons[0]);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const deletes = global.fetch.mock.calls.filter((c) => c[1]?.method === 'DELETE');
    expect(deletes).toHaveLength(0);
  });

  it('marks only the first watchlist import batch as replacing', async () => {
    setupApiMock({ catalog: SAMPLE_CATALOG });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Test Movie')).toBeInTheDocument(), { timeout: 8000 });

    // Drive the import loop directly through the API contract the UI uses:
    // 60 items across two batches of 50 and 10.
    const items = Array.from({ length: 60 }, (_, i) => ({ name: `Film ${i}`, year: 2024 }));
    const file = new File(
      [['Name,Year', ...items.map((i) => `${i.name},${i.year}`)].join('\n')],
      'watchlist.csv',
      { type: 'text/csv' }
    );

    fireEvent.click(screen.getByRole('button', { name: /Settings/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Profile/i }));

    global.fetch.mockImplementation((url, options = {}) => {
      const href = String(url);
      if (href.includes('/import/letterboxd/preview')) {
        return Promise.resolve(mockResponse({ importType: 'watchlist', count: items.length, items }));
      }
      if (href.includes('/import/letterboxd')) {
        return Promise.resolve(mockResponse({ matched: 50, notFound: 0, processed: 50, replaced: 0 }));
      }
      if (href.includes('/watchlist')) return Promise.resolve(mockResponse({ items: [] }));
      if (href.includes('/watched')) return Promise.resolve(mockResponse({ items: [] }));
      return Promise.resolve(mockResponse({}));
    });

    const inputs = document.querySelectorAll('input[type="file"][accept=".csv,text/csv"]');
    // Second file input is the watchlist one.
    fireEvent.change(inputs[1], { target: { files: [file] } });

    fireEvent.click(await screen.findByRole('button', { name: /^Import all$/i }, { timeout: 8000 }));

    await waitFor(() => {
      const importCalls = global.fetch.mock.calls.filter(
        (c) => String(c[0]).includes('/import/letterboxd') && !String(c[0]).includes('preview')
      );
      expect(importCalls.length).toBe(2);
      const bodies = importCalls.map((c) => JSON.parse(c[1].body));
      expect(bodies[0].replaceExisting).toBe(true);
      expect(bodies[1].replaceExisting).toBeUndefined();
    }, { timeout: 8000 });
  });
});

describe('Watchlist from the catalog', () => {
  beforeEach(() => {
    localStorage.setItem('whatsOn.authToken', 'mock-jwt');
    localStorage.setItem('whatsOn.username', 'testuser');
  });

  it('POSTs to /watchlist when the bookmark control is used', async () => {
    setupApiMock({ catalog: SAMPLE_CATALOG });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Test Movie')).toBeInTheDocument(), { timeout: 8000 });

    const addButtons = screen.getAllByRole('button', { name: /Add to watchlist/i });
    fireEvent.click(addButtons[0]);

    await waitFor(() => {
      const posted = global.fetch.mock.calls.find(
        (c) => String(c[0]).includes('/watchlist') && c[1]?.method === 'POST'
      );
      expect(posted).toBeTruthy();
      expect(JSON.parse(posted[1].body).itemId).toBe('movie-123');
    }, { timeout: 8000 });
  });

  it('shows both watchlist views when the user has saved titles', async () => {
    setupApiMock({
      catalog: SAMPLE_CATALOG,
      watchlist: [{ itemId: 'movie-999', title: 'Saved', mediaType: 'movie' }],
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Test Movie')).toBeInTheDocument(), { timeout: 8000 });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /From watchlist/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Streaming watchlist/i })).toBeInTheDocument();
    }, { timeout: 8000 });
  });

  it('asks for the whole watchlist, and for only the streamable part, separately', async () => {
    setupApiMock({
      catalog: SAMPLE_CATALOG,
      watchlist: [{ itemId: 'movie-999', title: 'Saved', mediaType: 'movie' }],
    });
    render(<App />);
    await waitFor(
      () => expect(screen.getByRole('button', { name: /From watchlist/i })).toBeInTheDocument(),
      { timeout: 8000 }
    );

    fireEvent.click(screen.getByRole('button', { name: /From watchlist/i }));
    await waitFor(() => {
      const urls = global.fetch.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('watchlistOnly=true') && !u.includes('streamingOnly'))).toBe(true);
    }, { timeout: 8000 });

    fireEvent.click(screen.getByRole('button', { name: /Streaming watchlist/i }));
    await waitFor(() => {
      const urls = global.fetch.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('watchlistOnly=true') && u.includes('streamingOnly=true'))).toBe(true);
    }, { timeout: 8000 });
  });
});
