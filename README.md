# 🎬 StreamScore

A full-stack streaming catalog app that lets you pick your streaming services and browse movies & TV shows with aggregated ratings from IMDb, Rotten Tomatoes, Metacritic, and TMDb — all in one place.

---

## 🚀 One-Click Deploy (Free Hosting)

Deploy the backend to Render and the frontend to Netlify — both are free tiers, no credit card required.

### Step 1 — Deploy the backend on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/diondavid1998/MovieKnight)

1. Click the button above and sign in / create a free [Render](https://render.com) account.
2. Render will detect `render.yaml` and pre-fill the service settings.
3. Fill in the required environment variables when prompted:
   - `TMDB_API_KEY` → get a free key at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
   - `OMDB_API_KEY` → get a free key at [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx)
   - `FRONTEND_URL` → leave blank for now; update it after Step 2
   - `JWT_SECRET` → auto-generated for you ✅
4. Click **Apply** — Render builds and starts the backend. Copy the URL it gives you (e.g. `https://streamscore-backend.onrender.com`).

### Step 2 — Deploy the frontend on Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/diondavid1998/MovieKnight)

1. Click the button above and sign in / create a free [Netlify](https://netlify.com) account.
2. Netlify will detect `netlify.toml` and use `web-frontend/` as the build root automatically.
3. After the deploy finishes, go to **Site configuration → Environment variables** and add:
   - Key: `REACT_APP_API_BASE` → Value: the Render backend URL from Step 1 (e.g. `https://streamscore-backend.onrender.com`)
4. Go to **Deploys → Trigger deploy → Deploy site** to rebuild with the new variable.
5. Copy your Netlify site URL (e.g. `https://streamscore-xyz.netlify.app`).

### Step 3 — Connect frontend ↔ backend

1. Back on the Render dashboard, open the `streamscore-backend` service → **Environment**.
2. Set `FRONTEND_URL` to your Netlify URL from Step 2 (e.g. `https://streamscore-xyz.netlify.app`).
3. Render will redeploy automatically.

> ✅ Both services are now live and talking to each other. Use your Netlify URL to open the app in Safari and install it as a PWA (see section below).

---

## Features

- **Streaming service picker** — select from Netflix, Hulu, Prime Video, Disney+, Paramount+, Peacock, Max, and Crunchyroll
- **Movies & TV Shows** — browse a live catalog pulled from TMDB and enriched with OMDB ratings
- **Multi-source ratings** — IMDb, Rotten Tomatoes, Metacritic, and TMDb scores shown per title
- **Genre filter** — multi-select genre filtering including Anime
- **Language filter** — filter catalog by original language
- **Sort & filter** — sort by rating, release date, or alphabetically; filter by media type
- **Pagination** — smooth page-based browsing with a background sync indicator
- **Progressive Web App (PWA)** — installable on iPhone via Safari, works offline via service worker
- **User accounts** — JWT-based auth with register/login; preferences saved per user
- **iOS app** — native Swift/SwiftUI companion app (Xcode project included)

---

## 📱 Install on iPhone (PWA)

StreamScore is a Progressive Web App — you can add it to your iPhone Home Screen and it will run like a native app (full screen, no browser chrome).

**Requirements:** iPhone running iOS 16.4 or later, Safari browser.

**Steps:**

1. Open **Safari** on your iPhone (must be Safari — Chrome/Firefox won't show the install option)
2. Navigate to your StreamScore Netlify URL — e.g. **`https://your-site-name.netlify.app`** (replace with the URL you got after deploying above)
3. Tap the **Share** button (the box with an arrow pointing up) in the bottom toolbar
4. Scroll down in the share sheet and tap **"Add to Home Screen"**
5. Edit the name if you like (it defaults to "StreamScore"), then tap **Add**
6. The StreamScore icon will appear on your Home Screen — tap it to launch

> ℹ️ The app runs in standalone mode (no Safari address bar), caches content for offline use, and behaves like a native app.

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
- Native companion app — same backend, same account

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
├── MovieKnight/          # iOS Swift app (displays as "StreamScore")
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
