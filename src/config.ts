import Constants from 'expo-constants';

// Spotify credentials come from app.json > expo.extra. Fill in your Client ID
// from https://developer.spotify.com/dashboard and register the redirect URI
// (hockeydj://spotify-auth-callback) in that dashboard.
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

export const SPOTIFY_CLIENT_ID = extra.spotifyClientId ?? '';
export const SPOTIFY_REDIRECT_URI =
  extra.spotifyRedirectUri ?? 'hockeydj://spotify-auth-callback';
// Optional backend endpoints for the token-swap flow. Leaving them blank uses
// the SDK's implicit/PKCE session, which is fine for a personal app.
export const SPOTIFY_TOKEN_SWAP_URL = extra.spotifyTokenSwapUrl ?? '';
export const SPOTIFY_TOKEN_REFRESH_URL = extra.spotifyTokenRefreshUrl ?? '';

export const SPOTIFY_CONFIGURED = SPOTIFY_CLIENT_ID.length > 0;
