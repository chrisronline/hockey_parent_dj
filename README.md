# Hockey Parent DJ 🏒🎵

An iOS app (React Native / Expo) for running music during a hockey game off a
Spotify account. Built for the bench: big tap targets, dark UI, one-tap goal songs.

## Features

- **Playlists** grouped by category (Warmups, In Game, Intermission, End of Game).
- **Shuffle** — randomize a playlist's play order each time you hit play.
- **Clip window** — set a start/stop time per song so you only play the good part.
- **Fade in / out** — ramp volume up at the start and down at the stop point.
- **Roster + goal songs** — import your roster, assign each kid a song, then tap
  their name on the **Goal Board** when they score and it fires instantly.

## How it plays music

The app **remote-controls the Spotify app** via the App Remote SDK — it does not
stream audio itself. That has a few consequences worth knowing:

- Requires **Spotify Premium** and the **Spotify app installed & logged in** on
  the device. Keep Spotify running in the background during games.
- Start/stop and seeking are exact. **Fades ramp the phone's output volume**
  (Spotify exposes no in-app volume control) — which is exactly what reaches the
  PA when the phone is plugged in. Set the phone volume to your desired peak.

## First-time setup

### 1. Create a Spotify app
1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Create an app. Copy the **Client ID**.
3. Under the app's settings, add this **Redirect URI**:
   ```
   hockeydj://spotify-auth-callback
   ```
4. Add your own Spotify account under **User Management** (apps start in
   development mode and only allow-listed users can log in).

### 2. Configure the app
In `app.json`, set your Client ID:
```json
"extra": {
  "spotifyClientId": "PASTE_YOUR_CLIENT_ID_HERE",
  "spotifyRedirectUri": "hockeydj://spotify-auth-callback"
}
```

### 3. Build & run on a device
The native Spotify SDK means Expo Go won't work — you need a custom dev build.

```bash
npm install
npx expo prebuild --platform ios   # regenerates ios/ (already done once)
npx expo run:ios --device           # pick your connected iPhone
```

> **Simulator note:** the Spotify SDK ships as an old-style fat framework
> (device arm64 + simulator x86_64). On an Apple Silicon Mac the arm64 iOS
> **Simulator** slice is missing, so builds may fail there. Run on a **real
> device** — which is what you want for testing rink audio anyway.

Open the app → **Settings → Connect Spotify** → approve in the Spotify app.

## Project structure

```
app/                         expo-router screens
  (tabs)/
    index.tsx                Goal Board (tap kid → goal song)
    playlists.tsx            Playlist list, grouped by category
    roster.tsx               Roster management + song assignment
    settings.tsx             Spotify connection + help
  playlist/[id].tsx          Playlist detail: songs, clip/fade editor, shuffle
src/
  types.ts                   Song / Playlist / Player models
  playback/playbackEngine.ts Play/seek/fade/start-stop + shuffle queue
  spotify/spotifyService.ts  Auth session + App Remote wrapper
  stores/                    Zustand stores (persisted to AsyncStorage)
  components/                Reusable UI, NowPlayingBar, SongEditor
```

## Adding songs

The App Remote SDK can't search the catalog, so you add a track by pasting its
Spotify link: in Spotify, tap **⋯ → Share → Copy Song Link**, then paste it into
the app (a `spotify:track:...` URI or bare ID also works).
