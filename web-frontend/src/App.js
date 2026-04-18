import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000';
const AUTH_TOKEN_KEY = 'movieKnight.authToken';
const AUTH_USERNAME_KEY = 'movieKnight.username';
const BYPASS_MODE_KEY = 'movieKnight.bypassMode';
const PAGE_SIZE = 24;

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background:
      'radial-gradient(ellipse at 18% 0%, rgba(233,69,96,0.14) 0%, transparent 46%),' +
      'radial-gradient(ellipse at 84% 95%, rgba(80,108,220,0.09) 0%, transparent 46%),' +
      'linear-gradient(180deg, #0b0c11 0%, #0e1019 100%)',
    color: '#eef0f7',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, system-ui, sans-serif',
    WebkitFontSmoothing: 'antialiased',
    padding: '28px 16px 48px',
  },
  shell: {
    width: '100%',
    maxWidth: 1080,
    display: 'flex',
    justifyContent: 'center',
  },
  card: {
    background: 'linear-gradient(160deg, rgba(16,19,28,0.99) 0%, rgba(12,14,21,0.99) 100%)',
    borderRadius: 28,
    boxShadow: '0 40px 100px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.055)',
    padding: '36px 32px',
    width: '100%',
    maxWidth: 960,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    border: '1px solid rgba(255,255,255,0.065)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
  },
  authCard: {
    maxWidth: 420,
    padding: '48px 40px',
  },
  headerRow: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 28,
    flexWrap: 'wrap',
  },
  headingGroup: {
    textAlign: 'left',
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: '#e94560',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    margin: 0,
    fontSize: 30,
    fontWeight: 800,
    lineHeight: 1.06,
    letterSpacing: '-0.025em',
    background: 'linear-gradient(135deg, #ffffff 30%, rgba(200,210,235,0.8) 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  subtitle: {
    margin: '9px 0 0',
    color: '#6e7a93',
    fontSize: 14,
    lineHeight: 1.55,
  },
  authMeta: {
    width: '100%',
    marginBottom: 32,
    textAlign: 'left',
  },
  form: {
    width: '100%',
  },
  input: {
    width: '100%',
    padding: '15px 16px',
    margin: '8px 0',
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.1)',
    fontSize: 16,
    background: 'rgba(255,255,255,0.05)',
    color: '#eef0f7',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  },
  button: {
    width: '100%',
    padding: '15px 20px',
    margin: '12px 0 0',
    borderRadius: 14,
    border: 'none',
    background: 'linear-gradient(135deg, #e94560 0%, #c8304a 100%)',
    color: '#fff',
    fontWeight: 700,
    fontSize: 16,
    cursor: 'pointer',
    fontFamily: 'inherit',
    letterSpacing: '-0.01em',
    boxShadow: '0 8px 24px rgba(233,69,96,0.32), inset 0 1px 0 rgba(255,255,255,0.12)',
    transition: 'opacity 0.2s ease, transform 0.2s ease',
  },
  buttonSecondary: {
    background: 'rgba(255,255,255,0.07)',
    boxShadow: 'none',
    border: '1px solid rgba(255,255,255,0.09)',
  },
  buttonSmall: {
    width: 'auto',
    padding: '9px 16px',
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 10,
  },
  buttonLoading: {
    opacity: 0.6,
    pointerEvents: 'none',
  },
  authSwitch: {
    marginTop: 20,
    color: '#6e7a93',
    fontSize: 14,
  },
  inlineButton: {
    background: 'none',
    border: 'none',
    padding: 0,
    color: '#e94560',
    font: 'inherit',
    cursor: 'pointer',
    fontWeight: 600,
  },
  error: {
    width: '100%',
    background: 'rgba(233,69,96,0.1)',
    color: '#ff8fa3',
    marginTop: 16,
    borderRadius: 12,
    padding: '12px 16px',
    fontWeight: 600,
    fontSize: 14,
    boxSizing: 'border-box',
    border: '1px solid rgba(233,69,96,0.2)',
  },
  info: {
    width: '100%',
    background: 'rgba(94,166,255,0.09)',
    color: '#90c4ff',
    marginTop: 16,
    borderRadius: 12,
    padding: '12px 16px',
    fontWeight: 500,
    fontSize: 14,
    boxSizing: 'border-box',
    border: '1px solid rgba(94,166,255,0.14)',
  },
  topActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'nowrap',
    alignItems: 'center',
    flexShrink: 0,
  },
  controlRow: {
    width: '100%',
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    marginBottom: 20,
  },
  dropdownGrid: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
    marginBottom: 20,
  },
  dropdownPanel: {
    width: '100%',
    borderRadius: 16,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  dropdownSummary: {
    listStyle: 'none',
    cursor: 'pointer',
    padding: '13px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: '#c0c8d8',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    userSelect: 'none',
  },
  dropdownMeta: {
    color: '#6e7a93',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
  },
  dropdownBody: {
    padding: '4px 16px 16px',
  },
  serviceFilterRow: {
    width: '100%',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flex: '1 1 150px',
  },
  controlLabel: {
    color: '#6e7a93',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  select: {
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    color: '#eef0f7',
    padding: '11px 14px',
    fontSize: 15,
    fontFamily: 'inherit',
    outline: 'none',
    width: '100%',
    cursor: 'pointer',
  },
  catalogMeta: {
    width: '100%',
    color: '#6e7a93',
    fontSize: 13,
    marginBottom: 20,
    lineHeight: 1.55,
    padding: '11px 16px',
    borderRadius: 13,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.05)',
  },
  platformGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))',
    gap: 14,
    width: '100%',
    marginBottom: 24,
    marginTop: 8,
  },
  platformCard: {
    width: '100%',
    minHeight: 108,
    borderRadius: 16,
    background: 'rgba(255,255,255,0.04)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1.5px solid rgba(255,255,255,0.07)',
    cursor: 'pointer',
    padding: '12px 8px',
    boxSizing: 'border-box',
    gap: 8,
  },
  platformCardSelected: {
    border: '1.5px solid rgba(233,69,96,0.65)',
    background: 'linear-gradient(160deg, rgba(233,69,96,0.14) 0%, rgba(180,30,54,0.09) 100%)',
    boxShadow: '0 8px 28px rgba(233,69,96,0.22), inset 0 1px 0 rgba(255,255,255,0.07)',
  },
  platformLabel: {
    textAlign: 'center',
    fontSize: 11,
    color: '#8a93a8',
    fontWeight: 600,
    userSelect: 'none',
    maxWidth: '100%',
    lineHeight: 1.3,
  },
  platformLogo: {
    width: 70,
    height: 70,
    objectFit: 'contain',
    objectPosition: 'center',
    display: 'block',
  },
  sectionActions: {
    width: '100%',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    flexWrap: 'wrap',
  },
  sectionBlock: {
    width: '100%',
    marginTop: 8,
    marginBottom: 20,
  },
  sectionLabel: {
    color: '#6e7a93',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  movieList: {
    width: '100%',
    display: 'grid',
    gap: 14,
  },
  movieCard: {
    background: 'linear-gradient(145deg, rgba(20,23,34,0.97) 0%, rgba(14,16,24,0.97) 100%)',
    borderRadius: 20,
    padding: '18px 20px',
    color: '#eef0f7',
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '108px minmax(0, 1fr)',
    gap: 18,
    boxSizing: 'border-box',
    border: '1px solid rgba(255,255,255,0.06)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.28)',
    position: 'relative',
    overflow: 'hidden',
  },
  moviePoster: {
    width: 108,
    height: 162,
    borderRadius: 14,
    objectFit: 'cover',
    background: 'rgba(255,255,255,0.04)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.38)',
    flexShrink: 0,
  },
  moviePosterPlaceholder: {
    width: 108,
    height: 162,
    borderRadius: 14,
    background: 'linear-gradient(160deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#3a4258',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    flexShrink: 0,
  },
  movieBody: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  movieTitle: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 8,
    lineHeight: 1.18,
    letterSpacing: '-0.01em',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  movieSubhead: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 10,
  },
  chip: {
    borderRadius: 8,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 700,
    background: 'rgba(255,255,255,0.07)',
    color: '#b0bac8',
    letterSpacing: '0.02em',
  },
  chipAccent: {
    background: 'rgba(233,69,96,0.17)',
    color: '#ff8fa3',
    border: '1px solid rgba(233,69,96,0.25)',
  },
  chipTV: {
    background: 'rgba(94,166,255,0.17)',
    color: '#7db8ff',
    border: '1px solid rgba(94,166,255,0.22)',
  },
  chipMuted: {
    background: 'rgba(94,166,255,0.13)',
    color: '#90c4ff',
  },
  // Genre chips — purple accent
  chipGenre: {
    background: 'rgba(142,96,255,0.15)',
    color: '#c4a8ff',
    border: '1px solid rgba(142,96,255,0.3)',
    borderRadius: 8,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.02em',
  },
  serviceFilterButton: {
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.10)',
    background: 'rgba(255,255,255,0.05)',
    color: '#b0bac8',
    padding: '9px 14px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.02em',
    transition: 'all 0.18s ease',
  },
  serviceFilterButtonActive: {
    background: 'rgba(233,69,96,0.17)',
    border: '1px solid rgba(233,69,96,0.4)',
    color: '#ff8fa3',
  },
  genreFilterButtonActive: {
    background: 'rgba(142,96,255,0.2)',
    border: '1px solid rgba(142,96,255,0.45)',
    color: '#c4a8ff',
  },
  serviceLogoTiny: {
    width: 18,
    height: 18,
    objectFit: 'contain',
    display: 'block',
    flexShrink: 0,
  },
  movieOverview: {
    fontSize: 13,
    color: '#7a8499',
    marginBottom: 8,
    lineHeight: 1.62,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
  },
  ratingGrid: {
    display: 'flex',
    gap: 8,
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
    padding: '2px 0 4px',
    marginTop: 12,
  },
  ratingChip: {
    borderRadius: 12,
    padding: '9px 12px',
    background: 'rgba(255,255,255,0.05)',
    color: '#edf1f8',
    fontSize: 12,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid rgba(255,255,255,0.09)',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  ratingLogo: {
    width: 22,
    height: 22,
    objectFit: 'contain',
    flexShrink: 0,
  },
  ratingContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    lineHeight: 1.1,
  },
  ratingLabel: {
    fontSize: 9,
    color: '#6e7a93',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  ratingValue: {
    fontSize: 14,
    color: '#eef0f7',
    fontWeight: 700,
  },
  providerRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  providerChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 10px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.10)',
    color: '#c8d0e0',
    fontSize: 11,
    fontWeight: 600,
  },
  providerLogo: {
    width: 16,
    height: 16,
    objectFit: 'contain',
    display: 'block',
    flexShrink: 0,
  },
  movieDate: {
    fontSize: 12,
    color: '#e94560',
    fontWeight: 600,
  },
  emptyState: {
    color: '#6e7a93',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 14,
    lineHeight: 1.5,
  },
  loadMoreWrap: {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    marginTop: 24,
  },
  paginationRow: {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    flexWrap: 'wrap',
    marginTop: 24,
  },
  paginationSummary: {
    color: '#6e7a93',
    fontSize: 12,
    fontWeight: 600,
    marginRight: 4,
  },
  pageButton: {
    minWidth: 40,
    height: 40,
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: '#c0c8d8',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.18s ease',
  },
  pageButtonActive: {
    background: 'linear-gradient(135deg, rgba(233,69,96,0.26), rgba(200,48,74,0.3))',
    border: '1px solid rgba(233,69,96,0.48)',
    color: '#fff',
  },
};

const streamingPlatforms = [
  { key: 'netflix', name: 'Netflix', logo: require('./logos/netflix.png') },
  { key: 'hulu', name: 'Hulu', logo: require('./logos/hulu.jpeg') },
  { key: 'prime', name: 'Prime Video', logo: require('./logos/prime.png') },
  { key: 'disney', name: 'Disney+', logo: require('./logos/disney+.png') },
  { key: 'paramount', name: 'Paramount+', logo: require('./logos/paramount+.png') },
  { key: 'peacock', name: 'Peacock', logo: require('./logos/peacock.png') },
  { key: 'max', name: 'Max', logo: require('./logos/max.png') },
  { key: 'crunchyroll', name: 'Crunchyroll', logo: require('./logos/crunchyroll.png') },
];

const ratingLogos = {
  tmdb: require('./logos/tmdb.jpeg'),
  imdb: require('./logos/imdb.png'),
  metacritic: require('./logos/metacritic.jpeg'),
  rtMovieFresh: require('./logos/80%+_rt_movie.jpeg'),
  rtMovieCertified: require('./logos/90%+_rt_movie.png'),
  rtTvFresh: require('./logos/60%+_rt_tv.png'),
  rtRotten: require('./logos/60%-_rt_tv.jpeg'),
};

const languageOptions = [
  { key: 'en', name: 'English' },
  { key: 'es', name: 'Spanish' },
  { key: 'fr', name: 'French' },
  { key: 'de', name: 'German' },
  { key: 'it', name: 'Italian' },
  { key: 'pt', name: 'Portuguese' },
  { key: 'ja', name: 'Japanese' },
  { key: 'ko', name: 'Korean' },
  { key: 'hi', name: 'Hindi' },
  { key: 'zh', name: 'Mandarin' },
  { key: 'cn', name: 'Cantonese' },
  { key: 'ta', name: 'Tamil' },
  { key: 'te', name: 'Telugu' },
  { key: 'ml', name: 'Malayalam' },
];

function App() {
  const [page, setPage] = useState('login');
  const [authMode, setAuthMode] = useState('login');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [movies, setMovies] = useState([]);
  const [catalogMeta, setCatalogMeta] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [loadingMovies, setLoadingMovies] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('popularity');
  const [isBypassMode, setIsBypassMode] = useState(false);
  const [serviceFilters, setServiceFilters] = useState([]);
  const [languageFilters, setLanguageFilters] = useState([]);
  const [genreFilters, setGenreFilters] = useState([]);
  const [catalogPage, setCatalogPage] = useState(1);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showIosTip, setShowIosTip] = useState(false);
  const abortRef = useRef(null);

  const buildApiErrorMessage = (data, fallbackMessage) => {
    if (data?.error && data?.details) {
      return `${data.error}: ${data.details}`;
    }
    return data?.error || fallbackMessage;
  };

  const clearFeedback = () => {
    setError('');
    setInfo('');
  };

  const clearSession = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USERNAME_KEY);
    localStorage.removeItem(BYPASS_MODE_KEY);
    setToken('');
    setMovies([]);
    setCatalogMeta(null);
    setSelected([]);
    setLanguages([]);
    setShowSettings(false);
    setPassword('');
    setIsBypassMode(false);
    setServiceFilters([]);
    setLanguageFilters([]);
    setCatalogPage(1);
  };

  const logout = (message = 'You have been signed out.') => {
    clearSession();
    setPage('login');
    setAuthMode('login');
    setInfo(message);
  };

  const storeSession = (nextToken, nextUsername) => {
    localStorage.setItem(AUTH_TOKEN_KEY, nextToken);
    localStorage.setItem(AUTH_USERNAME_KEY, nextUsername);
    setToken(nextToken);
  };

  const parseResponseBody = async (response) => {
    const rawText = await response.text();

    if (!rawText) {
      return {};
    }

    try {
      return JSON.parse(rawText);
    } catch {
      return { error: rawText };
    }
  };

  const apiFetch = async (path, options = {}) => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (response.status === 401 || response.status === 403) {
      logout('Your session expired. Sign in again.');
      throw new Error('Unauthorized');
    }

    return response;
  };

  const fetchPlatforms = async (jwt) => {
    const response = await fetch(`${API_BASE}/platforms`, {
      headers: { Authorization: `Bearer ${jwt || token}` },
    });

    if (response.status === 401 || response.status === 403) {
      logout('Your session expired. Sign in again.');
      return false;
    }

    const data = await parseResponseBody(response);

    if (!response.ok) {
      setError(buildApiErrorMessage(data, 'Failed to load your streaming platforms.'));
      return false;
    }

    setSelected(Array.isArray(data.platforms) ? data.platforms : []);
    setLanguages(Array.isArray(data.languages) ? data.languages : []);
    return true;
  };

  const fetchMovies = useCallback(async () => {
    if (isBypassMode) {
      setMovies([]);
      setCatalogMeta(null);
      setError('');
      setInfo('Tester mode is active. Sign in with a real account to load the live catalog.');
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingMovies(true);
    setError('');
    setInfo('');

    try {
      const query = new URLSearchParams({
        mediaType: mediaTypeFilter,
        sortBy,
        limit: String(PAGE_SIZE),
        region: 'US',
        page: String(catalogPage),
      });

      if (serviceFilters.length) {
        query.set('serviceFilters', serviceFilters.join(','));
      }

      if (languageFilters.length) {
        query.set('languageFilters', languageFilters.join(','));
      }

      if (genreFilters.length) {
        query.set('genreFilters', genreFilters.join(','));
      }

      const response = await apiFetch(`/movies?${query.toString()}`, {
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await parseResponseBody(response);

      if (!response.ok) {
        setError(buildApiErrorMessage(data, 'Failed to fetch movies.'));
        return;
      }

      const items = Array.isArray(data.items) ? data.items : [];
      setMovies(items);
      setCatalogMeta(data.meta || null);
      if (!items.length) {
        setInfo(
          serviceFilters.length || languageFilters.length
            ? 'No titles matched the current catalog filters.'
            : 'No titles were returned for the platforms currently selected.'
        );
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err.message !== 'Unauthorized') {
        setError(`Network error: ${err.message}. Make sure the backend is running at ${API_BASE}.`);
      }
    } finally {
      setLoadingMovies(false);
    }
  }, [isBypassMode, mediaTypeFilter, sortBy, catalogPage, serviceFilters, languageFilters, genreFilters, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatMediaType = (value) => {
    if (value === 'documentary') {
      return 'Documentary';
    }

    if (value === 'tv') {
      return 'TV';
    }

    if (value === 'movie') {
      return 'Movie';
    }

    return value;
  };

  const providerNameToPlatform = useMemo(
    () => Object.fromEntries(streamingPlatforms.map((platform) => [platform.name, platform])),
    []
  );

  const toggleServiceFilter = (serviceKey) => {
    setCatalogPage(1);
    setServiceFilters((current) =>
      current.includes(serviceKey)
        ? current.filter((value) => value !== serviceKey)
        : [...current, serviceKey]
    );
  };

  const toggleLanguage = (languageKey) => {
    setLanguages((current) =>
      current.includes(languageKey)
        ? current.filter((value) => value !== languageKey)
        : [...current, languageKey]
    );
  };

  const toggleLanguageFilter = (languageKey) => {
    setCatalogPage(1);
    setLanguageFilters((current) =>
      current.includes(languageKey)
        ? current.filter((value) => value !== languageKey)
        : [...current, languageKey]
    );
  };

  const toggleGenreFilter = (genreKey) => {
    setCatalogPage(1);
    setGenreFilters((current) =>
      current.includes(genreKey)
        ? current.filter((value) => value !== genreKey)
        : [...current, genreKey]
    );
  };

  const ALL_GENRES = [
    { key: 'Action', label: 'Action' },
    { key: 'Adventure', label: 'Adventure' },
    { key: 'Animation', label: 'Animation' },
    { key: 'anime', label: '✦ Anime' },
    { key: 'Comedy', label: 'Comedy' },
    { key: 'Crime', label: 'Crime' },
    { key: 'Documentary', label: 'Documentary' },
    { key: 'Drama', label: 'Drama' },
    { key: 'Fantasy', label: 'Fantasy' },
    { key: 'Horror', label: 'Horror' },
    { key: 'Mystery', label: 'Mystery' },
    { key: 'Romance', label: 'Romance' },
    { key: 'Science Fiction', label: 'Sci-Fi' },
    { key: 'Thriller', label: 'Thriller' },
    { key: 'Western', label: 'Western' },
  ];

  const totalPages = useMemo(() => Math.max(catalogMeta?.totalPages || 1, 1), [catalogMeta]);
  const pageNumbers = useMemo(
    () => Array.from({ length: Math.min(totalPages, 7) }, (_, index) => {
      if (totalPages <= 7) return index + 1;
      const start = Math.max(1, Math.min(catalogPage - 3, totalPages - 6));
      return start + index;
    }),
    [totalPages, catalogPage]
  );

  const parsePercent = (value) => {
    if (!value) {
      return null;
    }

    const match = String(value).match(/(\d+)/);
    return match ? Number(match[1]) : null;
  };

  const getRottenTomatoesCriticsLogo = (item) => {
    const score = parsePercent(item?.ratings?.rottenTomatoes);
    if (score === null) {
      return null;
    }

    if (score < 60) {
      return ratingLogos.rtRotten;
    }

    if (item.mediaType === 'movie') {
      return score >= 90 ? ratingLogos.rtMovieCertified : ratingLogos.rtMovieFresh;
    }

    return ratingLogos.rtTvFresh;
  };

  const getRatingVisual = (item, key) => {
    if (key === 'tmdb') {
      return ratingLogos.tmdb;
    }

    if (key === 'imdb') {
      return ratingLogos.imdb;
    }

    if (key === 'rottenTomatoes') {
      return getRottenTomatoesCriticsLogo(item);
    }

    if (key === 'metacritic') {
      return ratingLogos.metacritic;
    }

    return null;
  };

  const ratingEntriesForItem = (item) => {
    const ratings = item.ratings || {};
    const clean = (v) => (v && v !== 'N/A' ? v : null);
    return [
      { key: 'tmdb', label: 'TMDb', value: ratings.tmdb ? String(Number(ratings.tmdb).toFixed(1)) : null },
      { key: 'imdb', label: 'IMDb', value: clean(ratings.imdb) },
      { key: 'rottenTomatoes', label: 'Critics', value: clean(ratings.rottenTomatoes) },
      { key: 'metacritic', label: 'Metacritic', value: clean(ratings.metacritic) },
    ].filter((entry) => entry.value);
  };

  useEffect(() => {
    const restoreSession = async () => {
      const storedToken = localStorage.getItem(AUTH_TOKEN_KEY);
      const storedUsername = localStorage.getItem(AUTH_USERNAME_KEY);
      const bypassMode = localStorage.getItem(BYPASS_MODE_KEY) === 'true';

      if (bypassMode) {
        setIsBypassMode(true);
        setUsername(storedUsername || 'tester');
        setPage('platforms');
        setInfo('Tester mode is active.');
        setLoadingSession(false);
        return;
      }

      if (!storedToken) {
        setLoadingSession(false);
        return;
      }

      try {
        const response = await fetch(`${API_BASE}/platforms`, {
          headers: { Authorization: `Bearer ${storedToken}` },
        });

        if (response.status === 401 || response.status === 403) {
          clearSession();
          setPage('login');
          setAuthMode('login');
          setInfo('Your session expired. Sign in again.');
          return;
        }

        const data = await parseResponseBody(response);

        if (!response.ok) {
          setError(buildApiErrorMessage(data, 'Failed to restore your account.'));
          return;
        }

        setToken(storedToken);
        setUsername(storedUsername || '');
        setSelected(Array.isArray(data.platforms) ? data.platforms : []);
        setLanguages(Array.isArray(data.languages) ? data.languages : []);
        setPage('platforms');
        setInfo(`Signed in as ${storedUsername || 'your account'}.`);
      } catch (err) {
        setError(`Network error: ${err.message}. Make sure the backend is running at ${API_BASE}.`);
      } finally {
        setLoadingSession(false);
      }
    };

    restoreSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Single effect: fetch movies whenever the page is movies OR any filter/sort/page changes
  useEffect(() => {
    if (page === 'movies') {
      fetchMovies();
    }
  }, [page, fetchMovies]);

  useEffect(() => {
    setServiceFilters((current) => current.filter((key) => selected.includes(key)));
  }, [selected]);

  useEffect(() => {
    setLanguageFilters((current) => current.filter((key) => languages.includes(key)));
  }, [languages]);

  useEffect(() => {
    const handler = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handler);

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isIos && !isInStandaloneMode) {
      setShowIosTip(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  const handleAuth = async (event) => {
    event.preventDefault();
    clearFeedback();

    const cleanUsername = username.trim();
    if (!cleanUsername || !password) {
      setError('Enter both a username and password.');
      return;
    }

    setLoadingAuth(true);

    try {
      const response = await fetch(`${API_BASE}/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUsername, password }),
      });
      const data = await parseResponseBody(response);

      if (!response.ok || !data.token) {
        setError(buildApiErrorMessage(data, `Unable to ${authMode}.`));
        return;
      }

      storeSession(data.token, cleanUsername);
      setUsername(cleanUsername);
      setPassword('');
      setPage('platforms');
      setAuthMode('login');

      const restored = await fetchPlatforms(data.token);
      if (restored) {
        setInfo(authMode === 'register' ? 'Account created. Choose your services.' : 'Signed in successfully.');
      }
    } catch (err) {
      setError(`Network error: ${err.message}. Make sure the backend is running at ${API_BASE}.`);
    } finally {
      setLoadingAuth(false);
      setLoadingSession(false);
    }
  };

  const handleBypassLogin = async () => {
    clearFeedback();

    const bypassUsername = username.trim() || 'tester';
    localStorage.setItem(AUTH_USERNAME_KEY, bypassUsername);
    localStorage.setItem(BYPASS_MODE_KEY, 'true');
    setToken('');
    setIsBypassMode(true);
    setUsername(bypassUsername);
    setPassword('');
    setPage('platforms');
    setSelected([]);
    setMovies([]);
    setCatalogMeta(null);
    setInfo(`Tester mode enabled for ${bypassUsername}.`);
  };

  const handleSavePlatforms = async () => {
    clearFeedback();

    if (isBypassMode) {
      setPage('movies');
      setShowSettings(false);
      setMovies([]);
      setCatalogMeta(null);
      setCatalogPage(1);
      setInfo('Tester mode active. You skipped login, so live catalog data is disabled until you sign in.');
      return;
    }

    try {
      const response = await apiFetch('/platforms', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ platforms: selected, languages }),
      });
      const data = await parseResponseBody(response);

      if (!response.ok || !data.success) {
        setError(buildApiErrorMessage(data, 'Failed to save platforms.'));
        return;
      }

      setPage('movies');
      setShowSettings(false);
      setCatalogPage(1);
      setInfo('Platforms saved.');
      await fetchMovies();
    } catch (err) {
      if (err.message !== 'Unauthorized') {
        setError(`Network error: ${err.message}. Make sure the backend is running at ${API_BASE}.`);
      }
    }
  };

  const renderFeedback = () => (
    <>
      {error ? <div style={styles.error}>{error}</div> : null}
      {!error && info ? <div style={styles.info}>{info}</div> : null}
    </>
  );

  const renderPlatformSelector = () => (
    <div style={styles.platformGrid} className="platform-grid-wrap">
      {streamingPlatforms.map((platform) => {
        const isSelected = selected.includes(platform.key);

        return (
          <div key={platform.key}>
            <input
              type="checkbox"
              id={`platform-${platform.key}`}
              checked={isSelected}
              onChange={(event) => {
                if (event.target.checked) {
                  setSelected((current) => [...current, platform.key]);
                } else {
                  setSelected((current) => current.filter((value) => value !== platform.key));
                }
              }}
              style={{ display: 'none' }}
            />
            <label
              htmlFor={`platform-${platform.key}`}
              className="platform-tile"
              style={{
                ...styles.platformCard,
                ...(isSelected ? styles.platformCardSelected : {}),
              }}
            >
              <img src={platform.logo} alt={platform.name} style={styles.platformLogo} className="platform-tile-logo" />
              <span style={styles.platformLabel} className="platform-tile-label">{platform.name}</span>
            </label>
          </div>
        );
      })}
    </div>
  );

  if (loadingSession) {
    return (
      <div style={styles.container} className="mk-container">
        <div style={{ ...styles.card, ...styles.authCard }} className="mk-card mk-card-auth">
          <div style={styles.authMeta}>
            <div style={styles.eyebrow}>StreamScore</div>
            <h1 style={styles.title}>Restoring session</h1>
            <p style={styles.subtitle}>Checking your saved sign-in state and loading your account.</p>
          </div>
        </div>
      </div>
    );
  }

  if (page === 'login') {
    const isRegister = authMode === 'register';

    return (
      <div style={styles.container} className="mk-container">
        <div style={styles.shell} className="mk-shell">
          <div style={{ ...styles.card, ...styles.authCard }} className="mk-card mk-card-auth fade-in">
            <div style={styles.authMeta}>
              <div style={styles.eyebrow}>🎬 StreamScore</div>
              <h1 style={styles.title}>{isRegister ? 'Create your account' : 'Sign in'}</h1>
              <p style={styles.subtitle}>
                {isRegister
                  ? 'Register once, save your streaming services, and pull movie picks from your backend.'
                  : 'Use your existing account to manage platforms and fetch movie recommendations.'}
              </p>
            </div>

            <form onSubmit={handleAuth} style={styles.form}>
              <input
                style={styles.input}
                className="mk-input"
                placeholder="Username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
              />
              <input
                style={styles.input}
                className="mk-input"
                placeholder="Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
              <button
                style={{ ...styles.button, ...(loadingAuth ? styles.buttonLoading : {}) }}
                className="btn-tap"
                type="submit"
                disabled={loadingAuth}
              >
                {loadingAuth ? 'Working...' : isRegister ? 'Create Account' : 'Sign In'}
              </button>
              {!isRegister ? (
                <button
                  style={{ ...styles.button, ...styles.buttonSecondary }}
                  className="btn-tap"
                  onClick={handleBypassLogin}
                  type="button"
                >
                  Bypass for Testing
                </button>
              ) : null}
            </form>

            <div style={styles.authSwitch}>
              {isRegister ? 'Already have an account? ' : 'Need an account? '}
              <button
                style={styles.inlineButton}
                onClick={() => {
                  clearFeedback();
                  setAuthMode(isRegister ? 'login' : 'register');
                }}
                type="button"
              >
                {isRegister ? 'Sign in instead' : 'Create one'}
              </button>
            </div>

            {renderFeedback()}
          </div>
        </div>
      </div>
    );
  }

  if (showSettings || page === 'platforms') {
    return (
      <div style={styles.container} className="mk-container">
        <div style={styles.shell} className="mk-shell">
          <div style={styles.card} className="mk-card fade-in">
            <div style={styles.headerRow} className="header-row-wrap">
              <div style={styles.headingGroup}>
                <div style={styles.eyebrow}>Streaming Setup</div>
                <h1 style={styles.title}>{showSettings ? 'Edit your services' : 'Choose your streaming platforms'}</h1>
                <p style={styles.subtitle}>
                  Signed in as {username || 'your account'}. Select every service you want StreamScore to search.
                </p>
              </div>
              <div style={styles.topActions} className="top-actions-wrap">
                {page === 'platforms' ? null : (
                  <button
                    style={{ ...styles.button, ...styles.buttonSecondary, ...styles.buttonSmall }}
                    className="btn-tap"
                    onClick={() => {
                      setShowSettings(false);
                      setPage('movies');
                      clearFeedback();
                    }}
                    type="button"
                  >
                    ← Back
                  </button>
                )}
                <button
                  style={{ ...styles.button, ...styles.buttonSecondary, ...styles.buttonSmall }}
                  className="btn-tap"
                  onClick={() => logout()}
                  type="button"
                >
                  Logout
                </button>
              </div>
            </div>

            <div style={styles.dropdownGrid} className="dropdown-grid-wrap">
              <details style={styles.dropdownPanel} open>
                <summary style={styles.dropdownSummary}>
                  <span>Streaming Services</span>
                  <span style={styles.dropdownMeta}>{selected.length} selected</span>
                </summary>
                <div style={styles.dropdownBody}>{renderPlatformSelector()}</div>
              </details>

              <details style={styles.dropdownPanel} open>
                <summary style={styles.dropdownSummary}>
                  <span>Languages</span>
                  <span style={styles.dropdownMeta}>{languages.length} selected</span>
                </summary>
                <div style={styles.dropdownBody}>
                  <div style={styles.serviceFilterRow}>
                    {languageOptions.map((language) => {
                      const isActive = languages.includes(language.key);

                      return (
                        <button
                          key={language.key}
                          type="button"
                          onClick={() => toggleLanguage(language.key)}
                          className="btn-tap"
                          style={{
                            ...styles.serviceFilterButton,
                            ...(isActive ? styles.serviceFilterButtonActive : {}),
                          }}
                        >
                          <span>{language.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </details>
            </div>

            <div style={styles.sectionActions}>
              <button style={styles.button} className="btn-tap" onClick={handleSavePlatforms} type="button">
                {showSettings ? 'Save Changes' : 'Save and Continue →'}
              </button>
            </div>

            {renderFeedback()}
          </div>
        </div>
      </div>
    );
  }

  if (page === 'movies') {
    return (
      <div style={styles.container} className="mk-container">
        <div style={styles.shell} className="mk-shell">
          <div style={styles.card} className="mk-card fade-in">
            <div style={styles.headerRow} className="header-row-wrap">
              <div style={styles.headingGroup}>
                <div style={styles.eyebrow}>🎬 Catalog</div>
                <h1 style={styles.title}>StreamScore</h1>
                <p style={styles.subtitle}>Live movies &amp; TV from your selected streaming services.</p>
              </div>
              <div style={styles.topActions} className="top-actions-wrap">
                <button
                  style={{
                    ...styles.button,
                    ...styles.buttonSmall,
                    ...(loadingMovies ? styles.buttonLoading : {}),
                  }}
                  className="btn-tap"
                  onClick={fetchMovies}
                  disabled={loadingMovies}
                  type="button"
                >
                  {loadingMovies ? 'Loading...' : 'Refresh'}
                </button>
                <button
                  style={{ ...styles.button, ...styles.buttonSecondary, ...styles.buttonSmall }}
                  className="btn-tap"
                  onClick={() => {
                    clearFeedback();
                    setShowSettings(true);
                  }}
                  type="button"
                >
                  ⚙ Settings
                </button>
                {installPrompt && (
                  <button
                    style={{ ...styles.button, ...styles.buttonSmall }}
                    className="btn-tap"
                    onClick={handleInstall}
                    type="button"
                  >
                    ⬇ Install App
                  </button>
                )}
                <button
                  style={{ ...styles.button, ...styles.buttonSecondary, ...styles.buttonSmall }}
                  className="btn-tap"
                  onClick={() => logout()}
                  type="button"
                >
                  Logout
                </button>
              </div>
            </div>

            {showIosTip && (
              <div style={{ ...styles.info, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>📲 To install on iPhone: tap the <strong>Share</strong> button in Safari, then <strong>"Add to Home Screen"</strong>.</span>
                <button
                  type="button"
                  onClick={() => setShowIosTip(false)}
                  style={{ ...styles.inlineButton, fontSize: 18, lineHeight: 1, flexShrink: 0 }}
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            )}

            <div style={styles.controlRow} className="control-row-wrap">
              <div style={styles.controlGroup}>
                <span style={styles.controlLabel}>Type</span>
                <select style={styles.select} className="mk-select" value={mediaTypeFilter} onChange={(event) => { setMediaTypeFilter(event.target.value); setCatalogPage(1); }}>
                  <option value="tv">TV Shows</option>
                  <option value="movie">Movies</option>
                  <option value="all">Movies + TV</option>
                  <option value="documentary">Documentary</option>
                </select>
              </div>
              <div style={styles.controlGroup}>
                <span style={styles.controlLabel}>Sort By</span>
                <select style={styles.select} className="mk-select" value={sortBy} onChange={(event) => { setSortBy(event.target.value); setCatalogPage(1); }}>
                  <option value="popularity">Popularity</option>
                  <option value="tmdb">TMDb Rating</option>
                  <option value="imdb">IMDb Rating</option>
                  <option value="rotten_tomatoes">Rotten Tomatoes</option>
                  <option value="metacritic">Metacritic</option>
                  <option value="release_date">Release Date</option>
                  <option value="title">Title</option>
                </select>
              </div>
            </div>

            <div style={styles.dropdownGrid} className="dropdown-grid-wrap">
              <details style={styles.dropdownPanel}>
                <summary style={styles.dropdownSummary}>
                  <span>Service Filter</span>
                  <span style={styles.dropdownMeta}>{serviceFilters.length || 'All'}</span>
                </summary>
                <div style={styles.dropdownBody}>
                  <div style={styles.serviceFilterRow}>
                    {streamingPlatforms
                      .filter((platform) => selected.includes(platform.key))
                      .map((platform) => {
                        const isActive = serviceFilters.includes(platform.key);

                        return (
                          <button
                            key={platform.key}
                            type="button"
                            onClick={() => toggleServiceFilter(platform.key)}
                            className="btn-tap"
                            style={{
                              ...styles.serviceFilterButton,
                              ...(isActive ? styles.serviceFilterButtonActive : {}),
                            }}
                          >
                            <img src={platform.logo} alt={platform.name} style={styles.serviceLogoTiny} />
                            <span>{platform.name}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              </details>

              <details style={styles.dropdownPanel}>
                <summary style={styles.dropdownSummary}>
                  <span>Language Filter</span>
                  <span style={styles.dropdownMeta}>{languageFilters.length || 'All'}</span>
                </summary>
                <div style={styles.dropdownBody}>
                  <div style={styles.serviceFilterRow}>
                    {languageOptions
                      .filter((language) => languages.includes(language.key))
                      .map((language) => {
                        const isActive = languageFilters.includes(language.key);

                        return (
                          <button
                            key={language.key}
                            type="button"
                            onClick={() => toggleLanguageFilter(language.key)}
                            className="btn-tap"
                            style={{
                              ...styles.serviceFilterButton,
                              ...(isActive ? styles.serviceFilterButtonActive : {}),
                            }}
                          >
                            <span>{language.name}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              </details>

              <details style={styles.dropdownPanel}>
                <summary style={styles.dropdownSummary}>
                  <span>Genre Filter</span>
                  <span style={{ ...styles.dropdownMeta, ...(genreFilters.length ? { color: '#c4a8ff' } : {}) }}>
                    {genreFilters.length ? `${genreFilters.length} selected` : 'All'}
                  </span>
                </summary>
                <div style={styles.dropdownBody}>
                  <div style={styles.serviceFilterRow}>
                    {ALL_GENRES.map((genre) => {
                      const isActive = genreFilters.includes(genre.key);
                      return (
                        <button
                          key={genre.key}
                          type="button"
                          onClick={() => toggleGenreFilter(genre.key)}
                          className="btn-tap"
                          style={{
                            ...styles.serviceFilterButton,
                            ...(isActive ? styles.genreFilterButtonActive : {}),
                          }}
                        >
                          <span>{genre.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {genreFilters.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setGenreFilters([]); setCatalogPage(1); }}
                      style={{ background: 'none', border: 'none', color: '#e94560', fontSize: 12, cursor: 'pointer', marginTop: 8, fontFamily: 'inherit' }}
                    >
                      Clear genres
                    </button>
                  )}
                </div>
              </details>
            </div>

            {catalogMeta ? (
              <div style={styles.catalogMeta}>
                Showing {catalogMeta.visibleCount || movies.length} titles · page {catalogMeta.page || catalogPage} of {Math.ceil((catalogMeta.resultCount || movies.length) / 20)}{catalogMeta.lastUpdatedAt ? ` · Updated ${new Date(catalogMeta.lastUpdatedAt).toLocaleString()}` : ''}{catalogMeta.refreshing ? ' · ⟳ Syncing…' : ''}
              </div>
            ) : null}

            {loadingMovies ? (
              <div style={styles.movieList}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} style={{ ...styles.movieCard, opacity: 0.45 }} className="movie-card-wrap">
                    <div style={{ ...styles.moviePosterPlaceholder, background: 'rgba(255,255,255,0.06)' }} className="movie-poster-ph shimmer" />
                    <div style={styles.movieBody}>
                      <div style={{ height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.08)', marginBottom: 12, width: '60%' }} className="shimmer" />
                      <div style={{ height: 16, borderRadius: 8, background: 'rgba(255,255,255,0.05)', marginBottom: 8, width: '40%' }} className="shimmer" />
                      <div style={{ height: 14, borderRadius: 8, background: 'rgba(255,255,255,0.04)', width: '90%' }} className="shimmer" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={styles.movieList}>
                {movies.map((movie) => {
                  const ratingEntries = ratingEntriesForItem(movie);
                  const isTV = movie.mediaType === 'tv';
                  return (
                    <div key={movie.id} style={styles.movieCard} className="movie-card-wrap" data-media={movie.mediaType}>
                      {movie.posterUrl ? (
                        <img src={movie.posterUrl} alt={movie.title} style={styles.moviePoster} className="movie-poster-el" loading="lazy" />
                      ) : (
                        <div style={styles.moviePosterPlaceholder} className="movie-poster-ph">🎬</div>
                      )}
                      <div style={styles.movieBody}>
                        <div style={styles.movieTitle} className="movie-title-el">
                          {movie.title}
                        </div>
                        <div style={styles.movieSubhead}>
                          <span style={{ ...styles.chip, ...(isTV ? styles.chipTV : styles.chipAccent) }}>{formatMediaType(movie.mediaType)}</span>
                          {movie.year ? <span style={styles.chip}>{movie.year}</span> : null}
                        </div>
                        {movie.overview ? <div style={styles.movieOverview}>{movie.overview}</div> : null}
                        {movie.genres?.length ? (
                          <div style={styles.providerRow}>
                            {movie.genres.slice(0, 4).map((genre) => (
                              <span key={genre} style={styles.chipGenre}>{genre}</span>
                            ))}
                          </div>
                        ) : null}
                        {movie.availableOn?.length ? (
                          <div style={styles.providerRow}>
                            {movie.availableOn.map((providerName) => {
                              const platform = providerNameToPlatform[providerName];
                              return (
                                <span key={providerName} style={styles.providerChip}>
                                  {platform ? <img src={platform.logo} alt={providerName} style={styles.providerLogo} /> : null}
                                  <span>{providerName}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                        {ratingEntries.length ? (
                          <div style={styles.ratingGrid} className="rating-row">
                            {ratingEntries.map((entry) => {
                              const visual = getRatingVisual(movie, entry.key);
                              return (
                                <span key={entry.key} style={styles.ratingChip}>
                                  {visual ? <img src={visual} alt={entry.label} style={styles.ratingLogo} /> : null}
                                  <span style={styles.ratingContent}>
                                    <span style={styles.ratingLabel}>{entry.label}</span>
                                    <span style={styles.ratingValue}>{entry.value}</span>
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!movies.length && !loadingMovies ? <div style={styles.emptyState}>No catalog titles match the current filters.</div> : null}
            {totalPages > 1 ? (
              <div style={styles.paginationRow}>
                <span style={styles.paginationSummary}>Page {catalogPage} of {totalPages}</span>
                <button
                  type="button"
                  style={styles.pageButton}
                  className="btn-tap page-btn"
                  onClick={() => setCatalogPage((current) => Math.max(1, current - 1))}
                  disabled={catalogPage === 1}
                >
                  ‹ Prev
                </button>
                {pageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    className="btn-tap page-btn"
                    style={{
                      ...styles.pageButton,
                      ...(pageNumber === catalogPage ? styles.pageButtonActive : {}),
                    }}
                    onClick={() => setCatalogPage(pageNumber)}
                  >
                    {pageNumber}
                  </button>
                ))}
                <button
                  type="button"
                  style={styles.pageButton}
                  className="btn-tap page-btn"
                  onClick={() => setCatalogPage((current) => Math.min(totalPages, current + 1))}
                  disabled={catalogPage === totalPages}
                >
                  Next ›
                </button>
              </div>
            ) : null}
            {renderFeedback()}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default App;
