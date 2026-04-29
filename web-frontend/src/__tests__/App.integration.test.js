/**
 * Integration tests for the StreamScore React app.
 * The backend API is mocked via jest.fn() / global.fetch mock.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('Logged-in catalog view', () => {
  function setupLoggedInSession() {
    localStorage.setItem('streamScout.authToken', 'mock-jwt');
    localStorage.setItem('streamScout.username', 'testuser');
  }

  /**
   * Full flow: session restore (GET /platforms) → platforms page →
   * click "Save and Continue" (PUT /platforms) → movies page (GET /movies)
   */
  async function renderToCatalog(catalogResponse = EMPTY_CATALOG) {
    setupLoggedInSession();
    setupFetchMock([
      mockResponse({ platforms: ['netflix'], languages: [] }), // GET /platforms (session restore)
      mockResponse({ success: true }),                          // PUT /platforms (Save and Continue)
      catalogResponse,                                          // GET /movies
    ]);

    render(<App />);

    // Wait for loadingSession=false and page='platforms' (Save and Continue appears)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save and Continue/i })).toBeInTheDocument();
    }, { timeout: 8000 });

    // Click Save and Continue to navigate to catalog
    fireEvent.click(screen.getByRole('button', { name: /Save and Continue/i }));

    // Wait for the transition away from platforms page (page='movies' renders, Save btn gone)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Save and Continue/i })).not.toBeInTheDocument();
    }, { timeout: 8000 });

    return global.fetch;
  }

  it('fetches /platforms then PUT /platforms then /movies on Save and Continue', async () => {
    await renderToCatalog();

    // Verify GET /platforms (session restore), PUT /platforms (save), GET /movies
    const calls = global.fetch.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(3);
    const urls = calls.map((c) => c[0]);
    const methods = calls.map((c) => c[1]?.method);
    expect(urls.some((u) => u.includes('/platforms'))).toBe(true);
    expect(methods.some((m) => m === 'PUT')).toBe(true);
    expect(urls.some((u) => u.includes('/movies'))).toBe(true);
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

    // TMDb 8.5 should appear (formatted to 1dp)
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

    expect(screen.getByText(/Page 1 of 3/i)).toBeInTheDocument();
  });

  it('shows All / Movies / Shows filter buttons', async () => {
    await renderToCatalog();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^All$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Movies$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Shows$/i })).toBeInTheDocument();
    }, { timeout: 8000 });
  });

  it('shows a Genre filter option', async () => {
    await renderToCatalog();

    await waitFor(() => {
      expect(screen.getByText(/Genre/i)).toBeInTheDocument();
    }, { timeout: 8000 });
  });
});

