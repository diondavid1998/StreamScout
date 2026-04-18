# 🎬 MovieKnight

A full-stack streaming catalog app that lets you pick your streaming services and browse movies & TV shows with aggregated ratings from IMDb, Rotten Tomatoes, Metacritic, and TMDb — all in one place.

---

## Features

- **Streaming service picker** — select from Netflix, Hulu, Prime Video, Disney+, Paramount+, Peacock, Max, and Crunchyroll
- **Movies & TV Shows** — browse a live catalog pulled from TMDB and enriched with OMDB ratings
- **Multi-source ratings** — IMDb, Rotten Tomatoes, Metacritic, and TMDb scores shown per title
- **Language filter** — filter catalog by original language (English, Spanish, French, Japanese, and more)
- **Sort & filter** — sort by rating, release date, or alphabetically; filter by media type
- **Pagination** — smooth page-based browsing with a background sync indicator
- **Progressive Web App (PWA)** — installable on mobile, works offline via service worker
- **User accounts** — JWT-based auth with register/login; preferences saved per user
- **iOS app** — native Swift/SwiftUI companion app (Xcode project included)

---

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

### iOS (`MovieKnight/`)
- Swift / SwiftUI
- Core Data
- Companion to the web app

---

## Project Structure

```
MovieKnight/
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
├── MovieKnight/          # iOS Swift app
├── MovieKnight.xcodeproj/
└── README.md
```

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
4. **Rating hydration** — background job enriches catalog entries with IMDb/RT/Metacritic scores via OMDB API
5. **Daily refresh** — scheduled refresh at midnight recalculates catalog for all active scopes

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/register` | Create account |
| `POST` | `/login` | Login, returns JWT |
| `GET` | `/movies` | Fetch catalog (auth required) |
| `GET` | `/platforms` | Get saved platform preferences |
| `POST` | `/platforms` | Save platform preferences |
| `GET` | `/languages` | Get saved language preferences |
| `POST` | `/languages` | Save language preferences |

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
