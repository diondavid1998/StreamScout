'use strict';

/**
 * Turning TMDB's series fields into the one line of copy a Currently Watching
 * row shows.
 *
 * The whole feature says one of three things, and never a specific date:
 *
 *   New episodes Thursdays        — actively running
 *   All episodes out              — returning, but nothing scheduled
 *   All episodes and seasons out  — Ended or Canceled
 *
 * A day of the week is deliberately weaker than a date, and that is the point:
 * a show that skips a week reads as a show taking a week off rather than as the
 * app being wrong. It also means no per-episode schedule has to be fetched —
 * everything below comes from `GET /tv/{id}`, which the app already calls.
 */

// Every date in this feature is reasoned about in US Central. TMDB air dates
// carry no time zone, so "is this in the past" needs *a* clock to be measured
// against, and picking one explicitly is what stops the answer from changing
// with the server's locale.
const APP_TIME_ZONE = 'America/Chicago';

const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// TMDB's terminal statuses. Both spellings of "cancelled" are accepted because
// the API is not consistent about it across endpoints.
const ENDED_STATUSES = new Set(['ended', 'canceled', 'cancelled']);

// How far past a cached next-air date can be before it stops being evidence.
//
// This matters more here than it would with a nightly job: nothing refreshes on
// a schedule any more, so a row can sit untouched for weeks. Inside two weeks a
// past date still describes the show's rhythm and is worth showing. Beyond it,
// the season has plausibly wrapped, and the honest answer is the status.
const STALE_NEXT_DATE_DAYS = 14;

const DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's calendar date in US Central, as `YYYY-MM-DD`. */
function todayInAppZone(now = new Date()) {
  const parts = {};
  for (const part of DATE_PARTS.formatToParts(now)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Split a bare `YYYY-MM-DD` into its numbers, rejecting anything that is not
 * exactly that shape or that does not survive the round trip (`2026-02-31`).
 */
function parseDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day, date };
}

/**
 * The weekday a bare date falls on.
 *
 * Read as a calendar date, not as an instant. `new Date('2026-09-14')` is UTC
 * midnight, which in Central is the evening of the 13th — so converting the
 * time zone here would report Sunday as Saturday. The date TMDB gives is
 * already the local air date; it only needs naming, not moving.
 */
function weekdayFromDateString(value) {
  const parsed = parseDateParts(value);
  return parsed ? WEEKDAYS[parsed.date.getUTCDay()] : null;
}

/** Whole days from `from` to `to`, both bare dates. Negative when `to` is earlier. */
function daysBetween(from, to) {
  const a = parseDateParts(from);
  const b = parseDateParts(to);
  if (!a || !b) return null;
  return Math.round((b.date.getTime() - a.date.getTime()) / 86400000);
}

/** `2026-09-14` → `Sep 14`. */
function formatShortDate(value) {
  const parsed = parseDateParts(value);
  return parsed ? `${MONTHS[parsed.month - 1]} ${parsed.day}` : null;
}

function isEndedStatus(status) {
  return ENDED_STATUSES.has(String(status || '').trim().toLowerCase());
}

/**
 * The one line a row shows, plus the state behind it so callers can filter.
 *
 * `airing` wins over `ended` when both could apply: a dated future episode is
 * stronger evidence than a status field TMDB may not have updated yet.
 */
function describeSeries({ status, nextAirDate, lastAirDate } = {}, now = new Date()) {
  const today = typeof now === 'string' ? now : todayInAppZone(now);
  const weekday = weekdayFromDateString(nextAirDate);
  const daysAway = weekday ? daysBetween(today, nextAirDate) : null;

  if (weekday && daysAway !== null && daysAway >= -STALE_NEXT_DATE_DAYS) {
    // Beyond a week out, "New episodes Thursdays" alone would be true and
    // useless — the season has not started. The start date is the only date
    // this feature ever shows, and only in this one case.
    const message =
      daysAway > 7
        ? `New episodes ${weekday}s from ${formatShortDate(nextAirDate)}`
        : `New episodes ${weekday}s`;
    return { state: 'airing', message, weekday, nextAirDate: nextAirDate || null, lastAirDate: lastAirDate || null };
  }

  if (isEndedStatus(status)) {
    return {
      state: 'ended',
      message: 'All episodes and seasons out',
      weekday: null,
      nextAirDate: null,
      lastAirDate: lastAirDate || null,
    };
  }

  // Returning or in production with nothing on the schedule: between seasons,
  // or on a long break. Either way there is nothing left to wait for right now.
  return {
    state: 'all_out',
    message: 'All episodes out',
    weekday: null,
    nextAirDate: null,
    lastAirDate: lastAirDate || null,
  };
}

module.exports = {
  APP_TIME_ZONE,
  STALE_NEXT_DATE_DAYS,
  todayInAppZone,
  weekdayFromDateString,
  daysBetween,
  formatShortDate,
  isEndedStatus,
  describeSeries,
};
