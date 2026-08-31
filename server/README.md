# Hockey Parent DJ — Spotify token server

A tiny backend whose only job is to end the "reauthorize Spotify every hour"
problem. The Spotify App Remote SDK can silently refresh its access token **only**
if a server holds your app's client secret and performs the OAuth exchanges.
This is that server: two endpoints, no database, no state.

```
POST /swap     body: code=<authorization code>   -> { access_token, refresh_token, expires_in, ... }
POST /refresh  body: refresh_token=<token>        -> { access_token, expires_in, ... }
GET  /         -> health check
```

The client secret lives here and is never shipped in the app.

## Deploy on Railway

1. Push this repo to GitHub (the `server/` folder is what we deploy).
2. In Railway: **New Project → Deploy from GitHub repo**, pick this repo.
3. **Settings → Root Directory**: set to `server` (so Railway builds only this folder).
   Railway auto-detects Node and runs `npm start`.
4. **Variables** — add:
   - `SPOTIFY_CLIENT_ID` = `b473151e683d4d0d88427c55c1248041`
   - `SPOTIFY_CLIENT_SECRET` = *(from the Spotify dashboard → your app → Settings)*
   - `SPOTIFY_REDIRECT_URI` = `hockeydj://callback`
   (Railway provides `PORT` automatically.)
5. **Settings → Networking → Generate Domain** to get a public URL, e.g.
   `https://hockey-dj-token-production.up.railway.app`.
6. Verify: open the domain in a browser — you should see
   "Hockey Parent DJ token server is running."

## Wire it into the app

In `app.json` → `expo.extra`, set (using YOUR Railway domain):

```json
"spotifyTokenSwapUrl": "https://YOUR-DOMAIN.up.railway.app/swap",
"spotifyTokenRefreshUrl": "https://YOUR-DOMAIN.up.railway.app/refresh"
```

Then rebuild the app. From then on the SDK refreshes tokens in the background —
no more hourly reauthorization.

> Tip: keep the Spotify **Client Secret** only in Railway's Variables. Never put
> it in `app.json` or anywhere the app bundle can read it.

## Run locally (optional)

```bash
cd server
cp .env.example .env      # fill in SPOTIFY_CLIENT_SECRET
npm install
npm start
```
