# 🎬 WhatsOn

A full-stack streaming catalog app that lets you pick your streaming services and browse movies & TV shows with aggregated ratings from IMDb, Rotten Tomatoes, Metacritic, and TMDb — all in one place.

---

## 🚀 Deploy

Backend runs on **Railway** (no sleep, persistent disk). Frontend is hosted on **Netlify**.

### Step 1 — Deploy the backend on Railway

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select this repo
2. Set **Root Directory** to `backend` in the service settings
3. Add a **Volume** (Storage tab) mounted at `/data`
4. Set these environment variables:
   - `TMDB_API_KEY` → free key at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
   - `OMDB_API_KEY` → free key at [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx)
   - `JWT_SECRET` → any long random string
   - `DB_PATH` → `/data/db.sqlite`
   - `NODE_ENV` → `production`
   - `FRONTEND_URL` → leave blank for now; update after Step 2
5. Railway will deploy automatically. Copy your Railway URL (e.g. `https://your-app.up.railway.app`).

### Step 2 — Deploy the frontend on Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/diondavid1998/StreamScout)

1. Click the button above and sign in / create a free [Netlify](https://netlify.com) account.
2. Netlify will detect `netlify.toml` and use `web-frontend/` as the build root automatically.
3. After the deploy finishes, go to **Site configuration → Environment variables** and add:
   - Key: `REACT_APP_API_BASE` → Value: your Railway URL from Step 1
4. Go to **Deploys → Trigger deploy → Deploy site** to rebuild with the new variable.
5. Copy your Netlify site URL (e.g. `https://your-site.netlify.app`).

### Step 3 — Connect frontend ↔ backend

1. Back on the Railway dashboard, open your service → **Variables**
2. Set `FRONTEND_URL` to your Netlify URL from Step 2
3. Railway will redeploy automatically.

> ✅ Both services are now live and talking to each other.

---

## Features

- **Streaming service picker** — 31 services, from Netflix, Hulu, Prime Video, Disney+, Max and Paramount+ through to Criterion Channel, MUBI, Shudder and HiDive
- **Movies & TV Shows** — browse a live catalog pulled from TMDB and enriched with OMDB ratings
- **Multi-source ratings** — IMDb, Rotten Tomatoes, Metacritic, and TMDb scores shown per title
- **Genre filter** — multi-select genre filtering including Anime
- **Language filter** — filter catalog by original language
- **Search** — live TMDB search across every title, not just the cached catalog
- **Watchlist** — save titles from the catalog, search, or a Letterboxd import; view the whole list or just what's streaming on your services
- **Sort & filter** — sort by rating, release date, recently added, or alphabetically; filter by media type
- **Pagination** — smooth page-based browsing with a background sync indicator
- **Progressive Web App (PWA)** — installable on iPhone via Safari, works offline via service worker
- **User accounts** — JWT-based auth with register/login; preferences saved per user
- **iOS app** — native Swift/SwiftUI companion app (Xcode project included)

---

## 📱 Install on iPhone (PWA)

WhatsOn is a Progressive Web App — you can add it to your iPhone Home Screen and it will run like a native app (full screen, no browser chrome).

**Requirements:** iPhone running iOS 16.4 or later, Safari browser.

**Steps:**

1. Open **Safari** on your iPhone (must be Safari — Chrome/Firefox won't show the install option)
2. Navigate to your WhatsOn Netlify URL — e.g. **`https://your-site-name.netlify.app`** (replace with the URL you got after deploying above)
3. Tap the **Share** button (the box with an arrow pointing up) in the bottom toolbar
4. Scroll down in the share sheet and tap **"Add to Home Screen"**
5. Edit the name if you like (it defaults to "WhatsOn"), then tap **Add**
6. The WhatsOn icon will appear on your Home Screen — tap it to launch

> ℹ️ The app runs in standalone mode (no Safari address bar), caches content for offline use, and behaves like a native app.

---

## A note on names

Three names appear in this repository, and all three are load-bearing:

| Name | Where it appears | Why |
|---|---|---|
| **WhatsOn** | The product — app title, PWA manifest, iOS bundle, `WhatsOn/` sources | The current, user-facing brand |
| **StreamScout** | The GitHub repository and the root `package.json` | The original project name; renaming the repo would break existing clones and the Netlify/Railway links |
| **streamscore** | The Railway hostname in `netlify.toml` | The deployed backend's actual URL — changing it means re-pointing the service |

New user-facing strings should say **WhatsOn**. The other two are infrastructure
identifiers; leave them alone unless you are also updating the service they name.

## Tech Stack

### Frontend (`web-frontend/`)
| Layer | Tech |
|---|---|
| Framework | React 18 (Create React App) |
| Styling | Inline styles + CSS-in-JS |
| State | `useState`, `useReducer`, `useCallback`, `useMemo` |
| PWA | Service Worker via CRA's `serviceWorkerRegistration` |
| Build | `npm run build` → static files in `build/` |

### Backend (`backend/`)
| Layer | Tech |
|---|---|
| Runtime | Node.js + Express |
| Database | SQLite (via `sqlite3`) |
| Auth | JWT (`jsonwebtoken`) + bcrypt |
| External APIs | [TMDB](https://www.themoviedb.org/documentation/api) + [OMDB](https://www.omdbapi.com/) |
| Rate limiting | `express-rate-limit` (20 req / 15 min on auth) |
| Caching | Daily catalog cache in SQLite with background hydration |

### iOS (`WhatsOn/`)
- Swift / SwiftUI
- Native companion app — same backend, same account

---

## Project Structure

```
WhatsOn/
├── backend/              # Node/Express API server
│   ├── index.js          # Express app, routes, auth
│   ├── catalogCache.js   # SQLite catalog caching & rating hydration
│   ├── movieService.js   # TMDB + OMDB API calls
│   └── package.json
├── web-frontend/         # React PWA
│   ├── src/
│   │   ├── App.js        # Main single-file React app
│   │   └── logos/        # Rating & platform logo assets
│   └── package.json
├── logo/                 # Source logo assets
├── WhatsOn/          # iOS Swift app
├── WhatsOn.xcodeproj/
└── README.md
```

---

## Icon Asset Regeneration

The icon source of truth is `/design/whatson-icon.svg`.

Rebuild native iOS and web/PWA icons from that file with:

```bash
npm run icons
```

This regenerates:
- `WhatsOn/Assets.xcassets/AppIcon.appiconset/*.png`
- `web-frontend/public/apple-touch-icon.png`
- `web-frontend/public/logo192.png`
- `web-frontend/public/logo512.png`
- `web-frontend/public/whatson-logo.png`
- `web-frontend/public/favicon.ico`

---

## Getting Started

### Prerequisites
- Node.js 18+
- TMDB API key → [themoviedb.org](https://www.themoviedb.org/settings/api)
- OMDB API key → [omdbapi.com](https://www.omdbapi.com/apikey.aspx)

### Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in `backend/`:

```env
PORT=4000
FRONTEND_URL=http://localhost:3000
JWT_SECRET=your_jwt_secret_here
TMDB_API_KEY=your_tmdb_key_here
OMDB_API_KEY=your_omdb_key_here
```

Start the server:

```bash
npm start
# or for development with auto-reload:
npx nodemon index.js
```

### Frontend Setup

```bash
cd web-frontend
npm install
npm start        # dev server at http://localhost:3000
npm run build    # production build
```

---

## How It Works

1. **Register / Log in** — creates a user account with hashed password; JWT returned and stored in `localStorage`
2. **Pick streaming platforms** — saved to your account; sent as query params to the catalog endpoint
3. **Catalog fetch** — backend checks SQLite cache; if stale (> 24h), fetches fresh data from TMDB
4. **Rating hydration** — a background job enriches entries with IMDb/RT/Metacritic scores from OMDB. Titles you have saved go first: watchlist entries before watched ones, both before merely popular ones. Saved titles that never made the popular snapshot are hydrated separately, so an obscure film on your watchlist still gets scores. Everything lands in `title_ratings`, keyed by IMDb ID and shared across every user and platform combination, so each title costs one OMDB call ever
5. **Daily refresh** — scheduled refresh at midnight recalculates catalog for all active scopes

---

## API Endpoints

All paths except the auth ones below require an `Authorization: Bearer <jwt>` header.

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/register` | Create an account; returns a JWT |
| `POST` | `/login` | Sign in; returns a JWT |
| `POST` | `/auth/forgot-password` | Email a 6-digit reset code |
| `POST` | `/auth/reset-password` | Consume the code and set a new password |

### Account & preferences

| Method | Path | Description |
|---|---|---|
| `GET` | `/account` | Username, email, profile picture |
| `PUT` | `/account` | Update username, email, password, or profile picture |
| `GET` | `/platforms` | Saved streaming services **and** languages |
| `PUT` | `/platforms` | Save streaming services and languages |

> There is no separate `/languages` endpoint — language preferences are read and
> written alongside platforms on `/platforms`.

### Catalog

| Method | Path | Description |
|---|---|---|
| `GET` | `/movies` | Paged catalog. See the query parameters below |
| `GET` | `/catalog-status` | When the cache last synced, and how many titles it holds |
| `POST` | `/catalog/refresh` | Force a full rebuild from TMDB (runs in the background) |
| `GET` | `/search?q=` | Live TMDB search across all titles, annotated with availability |
| `GET` | `/titles/:mediaType/:tmdbId/details` | Cast, crew, runtime, seasons |
| `GET` | `/titles/person/:personId` | A person's filmography, filtered to your services |

`GET /movies` accepts: `mediaType` (`all` \| `movie` \| `tv` \| `documentary`),
`sortBy` (`popularity`, `recently_added`, `release_date`, `release_date_asc`,
`tmdb`, `imdb`, `rotten_tomatoes`, `metacritic`, `title`), `page`, `limit`,
`region`, `serviceFilters`, `languageFilters`, `genreFilters`, `yearMin`,
`yearMax`, `hideWatched`, `watchlistOnly`, and `streamingOnly`.

`watchlistOnly=true` returns your whole watchlist; adding `streamingOnly=true`
narrows it to titles currently streaming on your services.

### Watched & watchlist

| Method | Path | Description |
|---|---|---|
| `GET` | `/watched` | Titles marked watched |
| `POST` | `/watched` | Mark a title watched |
| `DELETE` | `/watched/:itemId` | Unmark a title |
| `DELETE` | `/watched` | Clear the whole watched list |
| `GET` | `/watchlist` | Saved-for-later titles |
| `POST` | `/watchlist` | Add a title to the watchlist |
| `DELETE` | `/watchlist/:itemId` | Remove a title from the watchlist |
| `DELETE` | `/watchlist` | Clear the whole watchlist |

### Letterboxd import

| Method | Path | Description |
|---|---|---|
| `POST` | `/import/letterboxd/preview` | Parse a CSV and report what it contains |
| `POST` | `/import/letterboxd` | Import up to 50 items per call |

The two lists import with different semantics, matching what each one means:

- **Watchlist** is a snapshot of what you still intend to watch, so an upload
  **replaces** it — titles you removed on Letterboxd do not linger. The client
  sets `replaceExisting: true` on the first batch only; later batches append.
- **Watched** is a history, which only grows, so an upload **merges** into the
  existing list and leaves rows already present alone.

---

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Backend server port (default: `4000`) |
| `FRONTEND_URL` | Allowed CORS origin |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `TMDB_API_KEY` | TMDB API key or Bearer token |
| `OMDB_API_KEY` | OMDB API key |

> ⚠️ Never commit your `.env` file — it is listed in `.gitignore`

---

## Logos & Attributions

- Streaming platform logos are property of their respective companies
- Rating logos: [IMDb](https://www.imdb.com), [Rotten Tomatoes](https://www.rottentomatoes.com), [Metacritic](https://www.metacritic.com), [TMDb](https://www.themoviedb.org)
- This product uses the TMDB API but is not endorsed or certified by TMDB
