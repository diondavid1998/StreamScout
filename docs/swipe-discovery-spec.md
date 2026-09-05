# Swipe to discover — specification

A third screen alongside Discover and Analytics. One title at a time, full
bleed; swipe right to save it, left to pass. The queue is ordered by how well
each title matches the taste the diary already describes.

Status: **specification only**. Nothing here is built.

---

## 1. Why this rather than another list

Discover already answers "what is on my services". It sorts by popularity or by
score, which are facts about the title and say nothing about the reader. The
analytics page has spent this whole project accumulating the other half — that
this reader watches Kurosawa, rates Drama half a star above their own mean, and
has never finished a film over two hours since 2019.

Nothing joins the two. This screen is that join, and the swipe is what makes it
affordable: a ranked list invites scrutiny of the ranking, where a single card
asks one question at a time and gets an answer either way.

---

## 2. The data, and the gap that shapes everything

**Taste profile — free, already computed.** `readDiary` returns every viewing
with rating, rewatch flag, tags, likes and reviews, joined to whatever TMDB
details have resolved. Twelve lenses already rank the reader's directors,
writers, cast, genres, languages, countries, decades, studios, themes.

**Candidates — free, already cached.** `catalog_cache_entries` holds every title
on the reader's services for their scope.

**The gap.** The two halves do not describe titles the same way:

| Signal | In the diary | In the catalog |
|---|---|---|
| Genre | ✅ | ✅ |
| Language | ✅ | ✅ |
| Decade | ✅ | ✅ |
| Crowd rating | ✅ | ✅ |
| **Director, writer, cast** | ✅ | ❌ |
| **Keywords / themes** | ✅ | ❌ |
| **Studio, country** | ✅ | ❌ |

Crew and keywords live in `title_details_cache`, which is populated per title
by a lookup. Scoring a candidate on "directed by someone you rate highly"
therefore costs one TMDB call per candidate the first time.

This is the central design constraint. It is answered in §3.2, not by pretending
the columns exist.

---

## 3. The algorithm

### 3.1 Taste profile

Computed from the diary, cached with it, invalidated with it — reuse
`invalidateDiary`, do not add a second cache with its own staleness rules.

For each lens, an **affinity**: the mean rating the reader gives that value,
minus their overall mean, weighted by how many films support it.

```
affinity(value) = (meanRating(value) - overallMean) × confidence(value)
confidence(value) = min(1, films(value) / MIN_FILMS_FOR_CONFIDENCE)
```

The confidence term matters more than the delta. One five-star film by a
director is not a preference, and without damping it would outrank a director
with twenty films at a steady four. `MIN_FILMS_FOR_AFFINITY` already exists and
encodes this judgement; reuse the constant rather than inventing a second one.

Three signals beyond rating, all free and all currently unused for this:

- **Rewatches.** Watching something twice is a stronger endorsement than any
  score, and it is the only one the reader gave with their time.
- **Likes** (`is_liked`). The unscored yes. Counts toward affinity at a fixed
  weight without touching the rating mean.
- **Reviews** (`has_review`). Writing about a film means engagement, not
  approval — a scathing review is still engagement. Use it as a weight on
  confidence, never on direction.

### 3.2 Two-tier scoring — the answer to the gap

**Tier 1 — every candidate, no API calls.** Score on the four signals the
catalog already has: genre, language, decade, crowd rating. Cheap enough to run
over the whole catalog on every request.

**Tier 2 — the top N only, one call each, cached forever.** Take the top ~40
from tier 1 and enrich them through the existing `ensureAnalyticsDetails`, which
already caches into `title_details_cache` and is already shared across users.
Re-score those on crew, keywords and studio, and serve the queue from that.

Why this shape:

- The expensive signals are applied only where they can change the outcome. A
  title that ranks 900th on genre and language alone is not going to reach the
  reader's cards because its cinematographer is a good match.
- Enrichment is permanent and shared. The cost falls with use, and a popular
  title is fetched once for the whole service.
- It degrades honestly. If TMDB is unreachable — see the circuit breaker — tier
  1 still produces a queue, just a blunter one.

Tier 2 must run **behind** the queue, not in front of it: return tier-1 cards
immediately and enrich the tail while the reader swipes the head. A discovery
screen that opens on a spinner has already lost.

### 3.3 Cold start

A reader who has not imported a diary has no profile. Do not show an empty
screen or, worse, a random one dressed as a recommendation.

- **No diary:** fall back to crowd rating and popularity within their services,
  and say so on the card — "popular on your services" rather than an implied
  personal match. Prompt the import once, unobtrusively.
- **Thin diary (< ~30 rated films):** blend, weighting the profile by
  `films / 30`. Avoids a whole personality inferred from four films.
- **Unresolved diary:** genres and crew are absent until the lookup runs, so
  tier 1 works on language and decade only. Say what would improve it.

### 3.4 What a swipe teaches

Right and left are not symmetrical, and treating them as such is the most
common way these systems go wrong.

- **Right** is a positive signal: save to watchlist, feed its attributes back
  into the profile at a modest weight.
- **Left** is weak and ambiguous. "Not tonight", "seen the trailer, no thanks"
  and "never show me horror" are the same gesture. Treat it as a *suppression of
  this title*, not evidence against its attributes. Only when a value
  accumulates several passes and no rights should it start to count against.

Store swipes in their own table (`discovery_swipes`: user, item, direction,
timestamp). Two reasons beyond learning: a passed title must not reappear
tomorrow, and the queue has to be reproducible across devices.

### 3.5 Not a filter bubble

Scoring purely on affinity converges on a narrow queue that will feel stale
within a week. Reserve a fraction of every batch — start at ~20% — for titles
that score well on the crowd but poorly on the profile, labelled as such
("outside your usual"). This is a real trade of precision for range, and it
should be visible in the UI rather than silent.

---

## 4. API

```
GET /discovery?mediaType=all|movie|tv&hideWatched=true&limit=20&cursor=<token>
```

Response:

```jsonc
{
  "cards": [{
    "itemId": "movie-949",
    "title": "Heat",
    "year": 1995,
    "posterUrl": "…",
    "backdropUrl": "…",
    "overview": "…",
    "runtime": 170,
    "genres": ["Crime", "Drama"],
    "availableOn": ["netflix"],
    "ratings": { "imdb": "8.3", "rottenTomatoes": "87%" },
    // Why this card is here. Shown on the card — a recommendation the reader
    // cannot interrogate is one they cannot trust.
    "because": [
      { "kind": "director", "value": "Michael Mann", "detail": "you rate his films 4.4" },
      { "kind": "genre", "value": "Crime", "detail": "half a star above your mean" }
    ],
    "tier": 2,          // whether crew and keywords were used
    "exploration": false // true for the deliberate outside-your-usual slice
  }],
  "cursor": "…",
  "profile": { "basis": "diary", "ratedFilms": 412, "confidence": "high" }
}
```

```
POST /discovery/swipe   { "itemId": "movie-949", "direction": "right" }
```

Right also performs the existing watchlist add, so the client makes one call,
not two.

**Filters.** `mediaType` and `hideWatched` are required from day one — both were
asked for explicitly. `hideWatched` excludes `watched_items`, the imported diary
*and* anything already on the watchlist: all three mean "not a suggestion".

**Rate limiting.** Its own budget, like `/analytics`. Tier 2 makes this the
second-most expensive route in the app.

---

## 5. The screen

- Full-bleed poster, title, year, runtime, services, ratings strip.
- **The `because` line is not decoration.** It is the difference between a
  recommendation and a slot machine, and it is what makes a bad suggestion
  forgivable — the reader can see the reasoning was sound even when the answer
  was wrong.
- Swipe right saves, left passes; buttons underneath do the same, because swipe
  as the *only* affordance fails anyone who cannot make the gesture.
- Tapping the card opens the existing detail sheet.
- Undo the last swipe. A mis-swipe on a card that is gone forever is the most
  irritating possible failure here.
- Prefetch the next 3 posters; the card must never appear empty mid-gesture.
- Queue exhausted → say so and offer to widen (turn off `hideWatched`, add
  services, or import a diary), rather than an empty screen.

**Accessibility.** Swipe must not be the only route: the buttons carry it.
Cards need labels reading title, year and the because line. Respect Reduce
Motion — no card-throwing animation when it is on.

---

## 6. Cost

| | Calls | Notes |
|---|---|---|
| Tier 1 | 0 | Entirely from the catalog cache |
| Tier 2, cold | ≤40 TMDB per batch | Permanent, shared between users |
| Tier 2, warm | ~0 | The library converges quickly |
| Watchmode | 0 | Its lifetime quota rules it out here |

The steady state is close to free. The first few sessions for the first user on
a given service are not, and should be measured before this ships rather than
assumed.

---

## 7. Risks

1. **Tier 2 latency on a cold cache** — 40 sequential TMDB calls is far too slow
   to block on. Mitigated by serving tier 1 first and enriching behind, but the
   handover needs care: cards must not visibly reshuffle under the reader's
   thumb.
2. **Candidate pool is only what discover returned.** The catalog is built from
   TMDB discover pages sorted by popularity, so an obscure film on the reader's
   service may never be a candidate at all. This caps how surprising the queue
   can be, and no amount of scoring fixes it — widening the pool is separate
   work.
3. **`hideWatched` depends on the diary matching the catalog.** The two are
   joined on `film_key` (name + year); the same film under a different title
   will slip through and be suggested despite being watched.
4. **A profile built on a partly-resolved diary is skewed**, not merely thinner:
   the films that happen to have resolved are not a random sample. Weight
   confidence by coverage, and say so on the card.

---

## 8. Phasing

**Phase 1 — tier 1 only.** Genre, language, decade, crowd rating. Both filters,
swipe storage, the because line, undo. Ships a working screen with no new API
cost and establishes whether the interaction is worth the rest.

**Phase 2 — tier 2 enrichment.** Crew, keywords, studio. The measurable jump in
quality, and the first real cost.

**Phase 3 — learning from swipes.** Feed rights back into the profile;
suppression from repeated lefts. Needs phase 1 to have accumulated data before
it can be evaluated at all.

**Phase 4 — exploration slice.** Deliberate range once there is a baseline to
measure the trade against.

Each phase is independently shippable. Phase 1 is the one that answers whether
the other three are worth building.
