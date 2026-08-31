import React from 'react';
import { ratingEntriesForItem } from './utils';

/**
 * One catalog card. Shared by the catalog grid and the search results, so a
 * title looks and behaves the same wherever it appears.
 *
 * Its own module and wrapped in React.memo because the whole app used to be a
 * single component: any state change — a keystroke in the search box, one
 * bookmark toggle — re-rendered all 24 cards along with the filter rail and the
 * settings pane, because nothing below App could bail out. The card only
 * re-renders now when its own movie, its saved state, or the ratings-loading
 * flag actually change.
 *
 * Every prop it takes must be referentially stable or the memo does nothing:
 * `styles` and the four helpers are module scope, the callbacks are useCallback.
 */
function MovieCard({
  movie,
  styles,
  isWatched,
  isWatchlisted,
  ratingsLoading,
  providerNameToPlatform,
  formatMediaType,
  getRatingVisual,
  getRatingChipStyle,
  onOpen,
  onToggleWatchlist,
  onToggleWatched,
}) {
  const ratingEntries = ratingEntriesForItem(movie);
  const isTV = movie.mediaType === 'tv';

  return (
    // A clickable div is invisible to the keyboard: it cannot be tabbed to, it
    // cannot be activated, and the dialog it opens has nowhere to return focus
    // to on close. tabIndex plus Enter/Space plus the button role fix all three.
    <div
      style={{ ...styles.movieCard, ...styles.movieCardClickable }}
      className="movie-card-wrap"
      data-media={movie.mediaType}
      role="button"
      tabIndex={0}
      aria-label={`${movie.title} — open details`}
      onClick={(e) => onOpen(movie, e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // Space scrolls the page by default.
        e.preventDefault();
        onOpen(movie, e.currentTarget);
      }}
    >
      <div style={styles.cardActions}>
        <button type="button"
          style={{ ...styles.watchedBtn, ...(isWatchlisted ? styles.watchlistBtnActive : {}) }}
          onClick={(e) => { e.stopPropagation(); onToggleWatchlist(movie); }}
          title={isWatchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
          aria-label={isWatchlisted ? 'Remove from watchlist' : 'Add to watchlist'}>
          {isWatchlisted ? '🔖' : '🏷'}
        </button>
        <button type="button"
          style={{ ...styles.watchedBtn, ...(isWatched ? styles.watchedBtnActive : {}) }}
          onClick={(e) => { e.stopPropagation(); onToggleWatched(movie); }}
          title={isWatched ? 'Remove from watched' : 'Mark as watched'}
          aria-label={isWatched ? 'Remove from watched' : 'Mark as watched'}>
          {isWatched ? '✓' : '○'}
        </button>
      </div>
      {movie.posterUrl ? (
        <img src={movie.posterUrl} alt={movie.title} style={styles.moviePoster}
          className="movie-poster-el" loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; const ph = e.currentTarget.nextSibling; if (ph) ph.style.display = 'flex'; }} />
      ) : null}
      <div style={{ ...styles.moviePosterPlaceholder, display: movie.posterUrl ? 'none' : 'flex' }} className="movie-poster-ph">🎬</div>
      <div style={styles.movieBody}>
        <div style={styles.movieTitle} className="movie-title-el">{movie.title}</div>
        <div style={styles.movieSubhead}>
          <span style={{ ...styles.chip, ...(isTV ? styles.chipTV : styles.chipAccent) }}>{formatMediaType(movie.mediaType)}</span>
          {movie.year ? <span style={styles.chip}>{movie.year}</span> : null}
        </div>
        {movie.overview ? <div style={styles.movieOverview}>{movie.overview}</div> : null}
        {movie.genres?.length ? (
          <div style={styles.providerRow}>
            {movie.genres.slice(0, 4).map((genre) => <span key={genre} style={styles.chipGenre}>{genre}</span>)}
          </div>
        ) : null}
        {movie.availableOn?.length ? (
          <div style={styles.providerRow}>
            {movie.availableOn.map((providerName) => {
              const platform = providerNameToPlatform[providerName];
              return (
                <span key={providerName} style={styles.providerChip}>
                  {platform?.logo ? <img src={platform.logo} alt={providerName} style={styles.providerLogo} /> : null}
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
              const chipAccent = getRatingChipStyle(entry.key, entry.value);
              return (
                <span key={entry.key} style={{ ...styles.ratingChip, ...chipAccent }}>
                  {visual ? <img src={visual} alt={entry.label} style={styles.ratingLogo} /> : null}
                  <span style={styles.ratingContent}>
                    <span style={styles.ratingLabel}>{entry.label}</span>
                    <span style={styles.ratingValue}>{entry.value}</span>
                  </span>
                </span>
              );
            })}
          </div>
        ) : ratingsLoading ? (
          <div style={{ fontSize: 11, color: 'rgba(110,122,147,0.7)', marginTop: 8 }}>⏳ Ratings loading…</div>
        ) : null}
      </div>
    </div>
  );
}

export default React.memo(MovieCard);
