// Spotify token swap/refresh backend for Hockey Parent DJ.
//
// The Spotify iOS App Remote SDK can only refresh an access token (and thus
// avoid re-authorizing every ~hour) if a backend holds the client SECRET and
// performs the OAuth code<->token exchanges. This is that backend: two tiny
// endpoints the SDK calls automatically when `tokenSwapURL`/`tokenRefreshURL`
// are configured in the app.
//
//   POST /swap     body: code=<authorization code>   -> full token JSON
//   POST /refresh  body: refresh_token=<token>        -> refreshed token JSON
//
// The secret never leaves the server. Configure via env vars (see .env.example).

import express from 'express';

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI,
  PORT = 3000,
} = process.env;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REDIRECT_URI) {
  console.error(
    'Missing required env vars. Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI.'
  );
  process.exit(1);
}

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const basicAuth =
  'Basic ' +
  Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString(
    'base64'
  );

const app = express();
// The SDK posts application/x-www-form-urlencoded; accept JSON too for testing.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/** Forward a form body to Spotify's token endpoint and relay the response. */
async function requestSpotifyToken(params, res) {
  try {
    const spotifyRes = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    });

    const text = await spotifyRes.text();
    // Relay Spotify's status + JSON verbatim so the SDK sees exactly what it
    // expects (access_token, expires_in, refresh_token, ...).
    res
      .status(spotifyRes.status)
      .type('application/json')
      .send(text);
  } catch (err) {
    console.error('Token request failed:', err);
    res.status(502).json({ error: 'token_request_failed' });
  }
}

// Health check so you (and Railway) can confirm the service is up.
app.get('/', (_req, res) => {
  res.type('text/plain').send('Hockey Parent DJ token server is running.');
});

// Exchange an authorization code for the initial access + refresh tokens.
app.post('/swap', (req, res) => {
  const code = req.body?.code;
  if (!code) return res.status(400).json({ error: 'missing_code' });

  requestSpotifyToken(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
    },
    res
  );
});

// Exchange a refresh token for a fresh access token (this is what kills the
// hourly reauth — the SDK calls this silently in the background).
app.post('/refresh', (req, res) => {
  const refreshToken = req.body?.refresh_token;
  if (!refreshToken)
    return res.status(400).json({ error: 'missing_refresh_token' });

  requestSpotifyToken(
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
    res
  );
});

app.listen(PORT, () => {
  console.log(`Token server listening on port ${PORT}`);
});
