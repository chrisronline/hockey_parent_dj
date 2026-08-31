# Hockey Parent DJ — Claude backend

A tiny backend whose only job is to proxy AI requests to Claude so the
**`ANTHROPIC_API_KEY` stays server-side** and never ships in the app bundle. No
database, no state — two endpoints:

```
POST /generate-playlist  body: { prompt, count? }              -> { name, category, songs: [{ title, artist }] }
POST /suggest-clip        body: { title, artist?, durationMs? } -> { startMs, stopMs, fadeInMs, fadeOutMs, reason }
GET  /                    -> health check
```

Both force structured output (Claude must call a tool), so responses come back
as clean JSON with no prose to parse. The app resolves each `{ title, artist }`
to a real Apple Music catalog track via its own search — Claude picks the music,
Apple Music makes it playable. `/suggest-clip` uses Claude's knowledge of song
structure to recommend a high-energy start/stop window (this is **not** audio
analysis — Apple Music's DRM streams give no access to raw samples).

## Deploy on Railway

1. Push this repo to GitHub (Railway auto-deploys on push).
2. In Railway: **New Project → Deploy from GitHub repo**, pick this repo.
3. **Settings → Root Directory**: set to `server` (so Railway builds only this
   folder). Railway auto-detects Node and runs `npm start`.
4. **Variables** — add:
   - `ANTHROPIC_API_KEY` = *(your Anthropic API key)*
   - `ANTHROPIC_MODEL` = `claude-sonnet-5` *(optional; this is the default)*
   (Railway provides `PORT` automatically.)
5. **Settings → Networking → Generate Domain** to get a public URL, e.g.
   `https://hockeyparentdj-production.up.railway.app`.
6. Verify: `curl` the domain — you should get a health-check response.

## Wire it into the app

In `app.json` → `expo.extra`, set (using YOUR Railway domain):

```json
"aiBackendUrl": "https://YOUR-DOMAIN.up.railway.app"
```

Then rebuild the app. The AI buttons appear only when this is set.

> Keep the **`ANTHROPIC_API_KEY`** only in Railway's Variables. Never put it in
> `app.json` or anywhere the app bundle can read it.

## Run locally (optional)

```bash
cd server
export ANTHROPIC_API_KEY=sk-ant-...
npm install
npm start
```
</content>
