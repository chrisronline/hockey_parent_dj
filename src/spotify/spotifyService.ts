import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  auth as SpotifyAuth,
  remote as SpotifyRemote,
  ApiScope,
  ApiConfig,
} from 'react-native-spotify-remote';
import {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_TOKEN_REFRESH_URL,
  SPOTIFY_TOKEN_SWAP_URL,
} from '../config';

// The native SDK keeps the session in memory only — it's gone on every cold
// start (including every rebuild/reinstall), and getSession() returns null
// without a refresh token. So we persist the access token ourselves and
// reconnect the App Remote directly with it on launch.
const SESSION_KEY = 'spotify.session.v1';

type StoredSession = { accessToken: string; expiresAt: number };

const config: ApiConfig = {
  clientID: SPOTIFY_CLIENT_ID,
  redirectURL: SPOTIFY_REDIRECT_URI,
  tokenRefreshURL: SPOTIFY_TOKEN_REFRESH_URL || undefined,
  tokenSwapURL: SPOTIFY_TOKEN_SWAP_URL || undefined,
  scopes: [
    ApiScope.AppRemoteControlScope,
    ApiScope.UserModifyPlaybackStateScope,
    ApiScope.UserReadPlaybackStateScope,
    ApiScope.PlaylistReadPrivateScope,
  ],
};

/**
 * Thin wrapper around react-native-spotify-remote that owns the auth session
 * and the App Remote connection. The playback engine talks to this, never to
 * the SDK directly, so all the "am I connected?" bookkeeping lives in one place.
 */
class SpotifyService {
  private connected = false;
  // In-memory copy of the current access token, mirrored to AsyncStorage. Used
  // for Web API search and for reconnecting on cold start.
  private accessToken: string | null = null;
  private expiresAt = 0;
  private listenersAttached = false;

  isConnected() {
    return this.connected;
  }

  /** Authorize (opens the Spotify app) and connect the App Remote. */
  async connect(): Promise<void> {
    // authorize() launches the Spotify app for login/consent and returns a
    // session with an access token we hand to the App Remote.
    const session = await SpotifyAuth.authorize(config);
    await SpotifyRemote.connect(session.accessToken);
    this.connected = await SpotifyRemote.isConnectedAsync();
    await this.storeToken(session.accessToken, session.expirationDate);
    this.attachListeners();
  }

  async disconnect(): Promise<void> {
    try {
      await SpotifyRemote.disconnect();
    } finally {
      await SpotifyAuth.endSession().catch(() => {});
      this.connected = false;
      this.accessToken = null;
      this.expiresAt = 0;
      await AsyncStorage.removeItem(SESSION_KEY);
    }
  }

  /** Re-attach to an existing session on app launch, if one is still valid. */
  async restore(): Promise<boolean> {
    const stored = await this.loadStoredToken();
    if (!stored) return false;
    try {
      await SpotifyRemote.connect(stored.accessToken);
      this.connected = await SpotifyRemote.isConnectedAsync();
      if (this.connected) {
        this.accessToken = stored.accessToken;
        this.expiresAt = stored.expiresAt;
        this.attachListeners();
      }
      return this.connected;
    } catch {
      this.connected = false;
      return false;
    }
  }

  /** Persist the access token with its expiry so we can reconnect after a cold start. */
  private async storeToken(token: string, expirationDate?: string) {
    // The SDK gives expirationDate as an ISO string; fall back to ~55 min if
    // it's missing, staying under Spotify's typical 60-min token lifetime.
    const parsed = expirationDate ? Date.parse(expirationDate) : NaN;
    const expiresAt = Number.isNaN(parsed)
      ? Date.now() + 55 * 60 * 1000
      : parsed;
    this.accessToken = token;
    this.expiresAt = expiresAt;
    const payload: StoredSession = { accessToken: token, expiresAt };
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  }

  /** Read the persisted token, discarding it if expired. */
  private async loadStoredToken(): Promise<StoredSession | null> {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredSession;
      if (!parsed?.accessToken || parsed.expiresAt <= Date.now()) {
        await AsyncStorage.removeItem(SESSION_KEY);
        return null;
      }
      return parsed;
    } catch {
      await AsyncStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  /** Reflect App Remote drops (Spotify app killed, network blip). Idempotent. */
  private attachListeners() {
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    SpotifyRemote.addListener('remoteDisconnected', () => {
      this.connected = false;
    });
    SpotifyRemote.addListener('remoteConnected', () => {
      this.connected = true;
    });
  }

  // --- Playback primitives the engine composes into songs/effects ---

  playUri(uri: string) {
    return SpotifyRemote.playUri(uri);
  }

  seek(positionMs: number) {
    return SpotifyRemote.seek(positionMs);
  }

  resume() {
    return SpotifyRemote.resume();
  }

  pause() {
    return SpotifyRemote.pause();
  }

  getPlayerState() {
    return SpotifyRemote.getPlayerState();
  }

  /** Current, non-expired access token (memory first, then persisted). */
  private async getAccessToken(): Promise<string | null> {
    if (this.accessToken && this.expiresAt > Date.now()) return this.accessToken;
    const stored = await this.loadStoredToken();
    if (stored) {
      this.accessToken = stored.accessToken;
      this.expiresAt = stored.expiresAt;
      return stored.accessToken;
    }
    return null;
  }

  // --- Catalog search (Web API, not the App Remote SDK) ---

  /**
   * Search the Spotify catalog for tracks. The App Remote SDK can't search, so
   * we hit the Web API directly with the access token from the auth session.
   * Returns [] when not logged in; throws only on unexpected network/API errors.
   */
  async searchTracks(query: string, limit = 20): Promise<SpotifyTrack[]> {
    const q = query.trim();
    if (!q) return [];

    const token = await this.getAccessToken();
    if (!token) throw new Error('Not connected to Spotify.');

    const url =
      'https://api.spotify.com/v1/search?type=track&limit=' +
      limit +
      '&q=' +
      encodeURIComponent(q);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      throw new Error('Spotify session expired — reconnect to search.');
    }
    if (!res.ok) {
      throw new Error(`Spotify search failed (${res.status}).`);
    }

    const json = await res.json();
    const items: any[] = json?.tracks?.items ?? [];
    return items.map((t) => ({
      uri: t.uri as string,
      title: (t.name as string) ?? 'Untitled track',
      artist: (t.artists ?? []).map((a: any) => a.name).join(', '),
      albumImageUrl: t.album?.images?.[t.album.images.length - 1]?.url as
        | string
        | undefined,
      durationMs: t.duration_ms as number | undefined,
    }));
  }
}

export type SpotifyTrack = {
  uri: string;
  title: string;
  artist: string;
  albumImageUrl?: string;
  durationMs?: number;
};

export const spotify = new SpotifyService();
