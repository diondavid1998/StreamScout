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
    justifyContent: 'center',
    background:
      'radial-gradient(circle at top, rgba(229, 76, 76, 0.18), transparent 32%), linear-gradient(135deg, #16171c 0%, #101114 45%, #1b2230 100%)',
    color: '#fff',
    fontFamily: '"Segoe UI", Roboto, system-ui, sans-serif',
    letterSpacing: 0.01,
    padding: '32px 16px',
  },
  shell: {
    width: '100%',
    maxWidth: 1120,
    display: 'flex',
    justifyContent: 'center',
  },
  card: {
    background: 'linear-gradient(180deg, rgba(15, 18, 25, 0.98), rgba(18, 21, 29, 0.95))',
    borderRadius: 28,
    boxShadow: '0 30px 100px rgba(0, 0, 0, 0.38)',
    padding: 32,
    width: '100%',
    maxWidth: 980,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    border: '1px solid rgba(255, 255, 255, 0.07)',
    backdropFilter: 'blur(18px)',
  },
  authCard: {
    maxWidth: 440,
  },
  headerRow: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  headingGroup: {
    textAlign: 'left',
    flex: 1,
    minWidth: 240,
  },
  eyebrow: {
    color: '#ff9b72',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  title: {
    margin: 0,
    fontSize: 32,
    lineHeight: 1.05,
  },
  subtitle: {
    margin: '12px 0 0',
    color: '#b8bdc9',
    fontSize: 15,
    lineHeight: 1.5,
  },
  authMeta: {
    width: '100%',
    marginBottom: 28,
    textAlign: 'left',
  },
  form: {
    width: '100%',
  },
  input: {
    width: '100%',
    padding: 14,
    margin: '10px 0',
    borderRadius: 12,
    border: '1px solid rgba(255, 255, 255, 0.12)',
    fontSize: 16,
    background: '#1a1d25',
    color: '#fff',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  button: {
    width: '100%',
    padding: 14,
    margin: '14px 0 0',
    borderRadius: 12,
    border: 'none',
    background: 'linear-gradient(90deg, #ff6a3d 0%, #e93854 100%)',
    color: '#fff',
    fontWeight: 700,
    fontSize: 16,
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxShadow: '0 12px 28px rgba(233, 56, 84, 0.28)',
    transition: 'opacity 0.2s ease, transform 0.2s ease',
  },
  buttonSecondary: {
    background: 'rgba(255, 255, 255, 0.06)',
    boxShadow: 'none',
  },
  buttonSmall: {
    width: 'auto',
    padding: '10px 16px',
    margin: 0,
    fontSize: 14,
  },
  buttonLoading: {
    opacity: 0.7,
    pointerEvents: 'none',
  },
  authSwitch: {
    marginTop: 16,
    color: '#b8bdc9',
    fontSize: 14,
  },
  inlineButton: {
    background: 'none',
    border: 'none',
    padding: 0,
    color: '#ff9b72',
    font: 'inherit',
    cursor: 'pointer',
  },
  error: {
    width: '100%',
    background: 'rgba(226, 72, 72, 0.15)',
    color: '#ff9191',
    marginTop: 16,
    borderRadius: 12,
    padding: '12px 14px',
    fontWeight: 600,
    boxSizing: 'border-box',
  },
  info: {
    width: '100%',
    background: 'rgba(94, 166, 255, 0.12)',
    color: '#a8d2ff',
    marginTop: 16,
    borderRadius: 12,
    padding: '12px 14px',
    fontWeight: 500,
    boxSizing: 'border-box',
  },
  topActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  controlRow: {
    width: '100%',
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
    alignItems: 'center',
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
    borderRadius: 18,
    background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.025))',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  dropdownSummary: {
    listStyle: 'none',
    cursor: 'pointer',
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: '#eef2f8',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  dropdownMeta: {
    color: '#97a6bf',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
  },
  dropdownBody: {
    padding: '0 16px 16px',
  },
  serviceFilterRow: {
    width: '100%',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 160,
  },
  controlLabel: {
    color: '#b8bdc9',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  select: {
    borderRadius: 12,
    border: '1px solid rgba(255, 255, 255, 0.12)',
    background: '#1a1d25',
    color: '#fff',
    padding: '12px 14px',
    fontSize: 15,
    fontFamily: 'inherit',
    outline: 'none',
  },
  catalogMeta: {
    width: '100%',
    color: '#a8b0bf',
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 1.5,
    padding: '14px 16px',
    borderRadius: 16,
    background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.03))',
    border: '1px solid rgba(255, 255, 255, 0.06)',
  },
  platformGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
    gap: 20,
    width: '100%',
    marginBottom: 28,
    marginTop: 12,
    justifyItems: 'center',
  },
  platformCard: {
    width: 120,
    minHeight: 136,
    borderRadius: 18,
    background: 'linear-gradient(180deg, rgba(36, 41, 54, 0.95), rgba(24, 28, 37, 0.95))',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    cursor: 'pointer',
    transition: 'all 0.25s ease',
    flexShrink: 0,
    padding: 12,
    boxSizing: 'border-box',
    gap: 12,
  },
  platformCardSelected: {
    border: '1px solid rgba(255, 138, 92, 0.95)',
    background: 'linear-gradient(180deg, rgba(68, 35, 31, 0.95), rgba(33, 20, 26, 0.98))',
    boxShadow: '0 14px 32px rgba(255, 106, 61, 0.24)',
    transform: 'translateY(-4px)',
  },
  platformLabel: {
    textAlign: 'center',
    fontSize: 13,
    color: '#d3d6de',
    fontWeight: 500,
    userSelect: 'none',
    maxWidth: '100%',
    lineHeight: 1.3,
  },
  platformLogo: {
    width: 96,
    height: 96,
    objectFit: 'contain',
    objectPosition: 'center',
    display: 'block',
  },
  sectionActions: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  sectionBlock: {
    width: '100%',
    marginTop: 8,
    marginBottom: 20,
  },
  sectionLabel: {
    color: '#b8bdc9',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  movieList: {
    width: '100%',
    display: 'grid',
    gap: 18,
  },
  movieCard: {
    background: 'linear-gradient(145deg, rgba(29, 34, 45, 0.98), rgba(17, 20, 28, 0.98))',
    borderRadius: 24,
    padding: 20,
    color: '#fff',
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '120px minmax(0, 1fr)',
    gap: 20,
    boxSizing: 'border-box',
    border: '1px solid rgba(255, 255, 255, 0.07)',
    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.22)',
  },
  moviePoster: {
    width: 120,
    height: 180,
    borderRadius: 18,
    objectFit: 'cover',
    background: 'rgba(255, 255, 255, 0.04)',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.3)',
  },
  moviePosterPlaceholder: {
    width: 120,
    height: 180,
    borderRadius: 18,
    background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.03))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#9ca3af',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
  },
  movieBody: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  movieTitle: {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 10,
    lineHeight: 1.08,
  },
  movieSubhead: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 14,
  },
  chip: {
    borderRadius: 999,
    padding: '7px 11px',
    fontSize: 11,
    fontWeight: 700,
    background: 'rgba(255, 255, 255, 0.07)',
    color: '#e1e7f0',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  chipAccent: {
    background: 'linear-gradient(90deg, rgba(255, 106, 61, 0.2), rgba(233, 56, 84, 0.22))',
    color: '#ffd0c1',
  },
  chipMuted: {
    background: 'rgba(94, 166, 255, 0.14)',
    color: '#bedeff',
  },
  serviceFilterButton: {
    borderRadius: 999,
    border: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(255, 255, 255, 0.04)',
    color: '#e9eef8',
    padding: '10px 14px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  serviceFilterButtonActive: {
    background: 'linear-gradient(90deg, rgba(255, 106, 61, 0.2), rgba(233, 56, 84, 0.22))',
    border: '1px solid rgba(255, 148, 112, 0.4)',
    color: '#fff4ef',
  },
  serviceLogoTiny: {
    width: 18,
    height: 18,
    objectFit: 'contain',
    display: 'block',
    flexShrink: 0,
  },
  movieOverview: {
    fontSize: 15,
    color: '#cfd5e0',
    marginBottom: 10,
    lineHeight: 1.65,
  },
  ratingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 10,
    marginTop: 16,
  },
  ratingChip: {
    borderRadius: 18,
    padding: '12px 14px',
    background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0.035))',
    color: '#edf1f8',
    fontSize: 13,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    border: '1px solid rgba(255, 255, 255, 0.06)',
  },
  ratingLogo: {
    width: 28,
    height: 28,
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
    fontSize: 10,
    color: '#98a4ba',
    textTransform: 'uppercase',
    letterSpacing: '0.11em',
  },
  ratingValue: {
    fontSize: 15,
    color: '#f5f7fb',
    fontWeight: 700,
  },
  providerRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  providerChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    borderRadius: 999,
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    color: '#e7edf7',
    fontSize: 12,
    fontWeight: 700,
  },
  providerLogo: {
    width: 20,
    height: 20,
    objectFit: 'contain',
    display: 'block',
    flexShrink: 0,
  },
  movieDate: {
    fontSize: 13,
    color: '#ffbf9f',
  },
  emptyState: {
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 12,
  },
  loadMoreWrap: {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    marginTop: 20,
  },
  paginationRow: {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    marginTop: 20,
  },
  paginationSummary: {
    color: '#9ca3af',
    fontSize: 13,
    marginRight: 4,
  },
  pageButton: {
    minWidth: 42,
    height: 42,
    borderRadius: 999,
    border: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(255, 255, 255, 0.04)',
    color: '#eef2f8',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  pageButtonActive: {
    background: 'linear-gradient(90deg, rgba(255, 106, 61, 0.22), rgba(233, 56, 84, 0.24))',
    border: '1px solid rgba(255, 148, 112, 0.4)',
    color: '#fff',
  },
};

const streamingPlatforms = [
  { key: 'netflix', name: 'Netflix', logo: require('./logos/netflix.png') },
  { key: 'hulu', name: 'Hulu', logo: require('./logos/hulu.jpeg') },
  { key: 'prime', name: 'Prime Video', logo: require('./logos/prime.jpeg') },
  { key: 'disney', name: 'Disney+', logo: require('./logos/disney+.jpeg') },
  { key: 'paramount', name: 'Paramount+', logo: require('./logos/paramount+.jpeg') },
  { key: 'peacock', name: 'Peacock', logo: require('./logos/peacock.png') },
  { key: 'max', name: 'Max', logo: require('./logos/max.jpeg') },
  { key: 'crunchyroll', name: 'Crunchyroll', logo: require('./logos/crunchyroll.jpeg') },
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
  const [catalogPage, setCatalogPage] = useState(1);
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
  }, [isBypassMode, mediaTypeFilter, sortBy, catalogPage, serviceFilters, languageFilters, token]); // eslint-disable-line react-hooks/exhaustive-deps

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
    return [
      { key: 'tmdb', label: 'TMDb', value: ratings.tmdb ? String(Number(ratings.tmdb).toFixed(1)) : null },
      { key: 'imdb', label: 'IMDb', value: ratings.imdb },
      { key: 'rottenTomatoes', label: 'Critics', value: ratings.rottenTomatoes },
      { key: 'metacritic', label: 'Metacritic', value: ratings.metacritic },
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
    <div style={styles.platformGrid}>
      {streamingPlatforms.map((platform) => {
        const isSelected = selected.includes(platform.key);

        return (
          <div key={platform.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
              style={{
                ...styles.platformCard,
                ...(isSelected ? styles.platformCardSelected : {}),
              }}
            >
              <img src={platform.logo} alt={platform.name} style={styles.platformLogo} />
              <span style={styles.platformLabel}>{platform.name}</span>
            </label>
          </div>
        );
      })}
    </div>
  );

  if (loadingSession) {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.card, ...styles.authCard }}>
          <div style={styles.authMeta}>
            <div style={styles.eyebrow}>MovieKnight</div>
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
      <div style={styles.container}>
        <div style={styles.shell}>
          <div style={{ ...styles.card, ...styles.authCard }}>
            <div style={styles.authMeta}>
              <div style={styles.eyebrow}>MovieKnight</div>
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
                placeholder="Username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
              />
              <input
                style={styles.input}
                placeholder="Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
              <button
                style={{ ...styles.button, ...(loadingAuth ? styles.buttonLoading : {}) }}
                type="submit"
                disabled={loadingAuth}
              >
                {loadingAuth ? 'Working...' : isRegister ? 'Create Account' : 'Sign In'}
              </button>
              {!isRegister ? (
                <button
                  style={{ ...styles.button, ...styles.buttonSecondary }}
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
      <div style={styles.container}>
        <div style={styles.shell}>
          <div style={styles.card}>
            <div style={styles.headerRow}>
              <div style={styles.headingGroup}>
                <div style={styles.eyebrow}>Streaming Setup</div>
                <h1 style={styles.title}>{showSettings ? 'Edit your services' : 'Choose your streaming platforms'}</h1>
                <p style={styles.subtitle}>
                  Signed in as {username || 'your account'}. Select every service you want MovieKnight to search.
                </p>
              </div>
              <div style={styles.topActions}>
                {page === 'platforms' ? null : (
                  <button
                    style={{ ...styles.button, ...styles.buttonSecondary, ...styles.buttonSmall }}
                    onClick={() => {
                      setShowSettings(false);
                      setPage('movies');
                      clearFeedback();
                    }}
                    type="button"
                  >
                    Back to Movies
                  </button>
                )}
                <button
                  style={{ ...styles.button, ...styles.buttonSecondary, ...styles.buttonSmall }}
                  onClick={() => logout()}
                  type="button"
                >
                  Logout
                </button>
              </div>
            </div>

            <div style={styles.dropdownGrid}>
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
              <button style={styles.button} onClick={handleSavePlatforms} type="button">
                {showSettings ? 'Save Changes' : 'Save and Continue'}
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
      <div style={styles.container}>
        <div style={styles.shell}>
          <div style={styles.card}>
            <div style={styles.headerRow}>
              <div style={styles.headingGroup}>
                <div style={styles.eyebrow}>Catalog</div>
                <h1 style={styles.title}>Streaming Catalog</h1>
                <p style={styles.subtitle}>Live provider-backed movies and TV titles for the services attached to this account.</p>
              </div>
              <div style={styles.topActions}>
                <button
                  style={{
                    ...styles.button,
                    ...styles.buttonSmall,
                    ...(loadingMovies ? styles.buttonLoading : {}),
                  }}
                  onClick={fetchMovies}
                  disabled={loadingMovies}
                  type="button"
                >
                  {loadingMovies ? 'Loading...' : 'Refresh'}
                </button>
                <button
                  style={{ ...styles.button, ...styles.buttonSecondary, ...styles.buttonSmall }}
                  onClick={() => {
                    clearFeedback();
                    setShowSettings(true);
                  }}
                  type="button"
                >
                  Settings
                </button>
                <button
                  style={{ ...styles.button, ...styles.buttonSecondary, ...styles.buttonSmall }}
                  onClick={() => logout()}
                  type="button"
                >
                  Logout
                </button>
              </div>
            </div>

            <div style={styles.controlRow}>
              <div style={styles.controlGroup}>
                <span style={styles.controlLabel}>Type</span>
                <select style={styles.select} value={mediaTypeFilter} onChange={(event) => { setMediaTypeFilter(event.target.value); setCatalogPage(1); }}>
                  <option value="tv">TV Shows</option>
                  <option value="movie">Movies</option>
                  <option value="all">Movies + TV</option>
                  <option value="documentary">Documentary</option>
                </select>
              </div>
              <div style={styles.controlGroup}>
                <span style={styles.controlLabel}>Sort By</span>
                <select style={styles.select} value={sortBy} onChange={(event) => { setSortBy(event.target.value); setCatalogPage(1); }}>
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

            <div style={styles.dropdownGrid}>
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

            {catalogMeta ? (
              <div style={styles.catalogMeta}>
                Showing {catalogMeta.visibleCount || movies.length} titles on page {catalogMeta.page || catalogPage} from {catalogMeta.resultCount || movies.length} cached matches across {catalogMeta.platformCount || selected.length} selected services.
                {catalogMeta.lastUpdatedAt ? ` Updated ${new Date(catalogMeta.lastUpdatedAt).toLocaleString()}.` : ''}
                {catalogMeta.refreshing ? ' ⟳ Syncing in background…' : ''}
                {catalogMeta.languages?.length
                  ? ` Languages: ${catalogMeta.languages
                      .map((languageKey) => languageOptions.find((language) => language.key === languageKey)?.name || languageKey)
                      .join(', ')}.`
                  : ''}
              </div>
            ) : null}

            {loadingMovies ? (
              <div style={styles.movieList}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} style={{ ...styles.movieCard, opacity: 0.45 }}>
                    <div style={{ ...styles.moviePosterPlaceholder, background: 'rgba(255,255,255,0.06)' }} />
                    <div style={styles.movieBody}>
                      <div style={{ height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.08)', marginBottom: 12, width: '60%' }} />
                      <div style={{ height: 16, borderRadius: 8, background: 'rgba(255,255,255,0.05)', marginBottom: 8, width: '40%' }} />
                      <div style={{ height: 14, borderRadius: 8, background: 'rgba(255,255,255,0.04)', width: '90%' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={styles.movieList}>
                {movies.map((movie) => {
                  const ratingEntries = ratingEntriesForItem(movie);
                  return (
                    <div key={movie.id} style={styles.movieCard}>
                      {movie.posterUrl ? (
                        <img src={movie.posterUrl} alt={movie.title} style={styles.moviePoster} loading="lazy" />
                      ) : (
                        <div style={styles.moviePosterPlaceholder}>No Poster</div>
                      )}
                      <div style={styles.movieBody}>
                        <div style={styles.movieTitle}>
                          {movie.title}
                        </div>
                        <div style={styles.movieSubhead}>
                          <span style={{ ...styles.chip, ...styles.chipAccent }}>{formatMediaType(movie.mediaType)}</span>
                          {movie.year ? <span style={styles.chip}>{movie.year}</span> : null}
                        </div>
                        {movie.overview ? <div style={styles.movieOverview}>{movie.overview}</div> : null}
                        {movie.genres?.length ? (
                          <div style={styles.providerRow}>
                            {movie.genres.slice(0, 4).map((genre) => (
                              <span key={genre} style={styles.chip}>{genre}</span>
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
                          <div style={styles.ratingGrid}>
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
                  onClick={() => setCatalogPage((current) => Math.max(1, current - 1))}
                  disabled={catalogPage === 1}
                >
                  Prev
                </button>
                {pageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
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
                  onClick={() => setCatalogPage((current) => Math.min(totalPages, current + 1))}
                  disabled={catalogPage === totalPages}
                >
                  Next
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
