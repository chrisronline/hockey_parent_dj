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

// We use the Spotify SDK's own authorize() for login: it's the only thing that
// wakes the Spotify app and lets the App Remote connect for playback. Without a
// token-swap backend there's no refresh token, so the access token dies after
// ~1h; when that happens the App Remote disconnects and we transparently
// re-authorize (Spotify remembers consent, so it's a quick app-switch, not a
// fresh login). A persisted "enabled" flag lets us reconnect automatically on
// launch so the user never has to tap Connect twice.
const ENABLED_KEY = 'spotify.enabled.v1';

// Don't retry reconnects faster than this, so a persistently failing connection
// can't spin in a tight loop.
const RECONNECT_MIN_GAP_MS = 4000;

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
  // Access token from the last authorize(), reused for Web API search.
  private accessToken: string | null = null;
  private listenersAttached = false;
  private reconnecting = false;
  private disabling = false;
  private lastReconnectAt = 0;
  // Subscribers (the connection store) notified whenever we connect or drop, so
  // the UI stays accurate through background auto-reconnects.
  private subscribers = new Set<(connected: boolean) => void>();

  isConnected() {
    return this.connected;
  }

  /** Observe connection changes. Returns an unsubscribe fn. */
  subscribe(fn: (connected: boolean) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private setConnected(value: boolean) {
    if (this.connected === value) return;
    this.connected = value;
    this.subscribers.forEach((fn) => fn(value));
  }

  /** Authorize (opens/wakes the Spotify app) and connect the App Remote. */
  async connect(): Promise<void> {
    // authorize() launches the Spotify app for login/consent (silent if already
    // granted) and returns a session with an access token for the App Remote.
    const session = await SpotifyAuth.authorize(config);
    this.accessToken = session.accessToken;
    await SpotifyRemote.connect(session.accessToken);
    this.setConnected(await SpotifyRemote.isConnectedAsync());
    await AsyncStorage.setItem(ENABLED_KEY, '1');
    this.attachListeners();
  }

  /**
   * Reconnect the App Remote WITHOUT foregrounding Spotify, by reusing the
   * SDK's existing session token. When a token-refresh backend is configured
   * (tokenRefreshURL), the SDK keeps that token fresh automatically, so this
   * path recovers from a ~1h expiry with no app-switch flicker. Returns false
   * if there's no usable session yet (caller falls back to full connect()).
   */
  private async reconnectSilently(): Promise<boolean> {
    const session = await SpotifyAuth.getSession();
    if (!session?.accessToken) return false;
    this.accessToken = session.accessToken;
    await SpotifyRemote.connect(session.accessToken);
    const ok = await SpotifyRemote.isConnectedAsync();
    this.setConnected(ok);
    if (ok) this.attachListeners();
    return ok;
  }

  async disconnect(): Promise<void> {
    // Mark intent first so the disconnect event doesn't trigger auto-reconnect.
    this.disabling = true;
    await AsyncStorage.removeItem(ENABLED_KEY);
    try {
      await SpotifyRemote.disconnect();
    } finally {
      await SpotifyAuth.endSession().catch(() => {});
      this.setConnected(false);
      this.accessToken = null;
      this.disabling = false;
    }
  }

  /**
   * Re-attach on app launch. Only auto-connects if the user connected before,
   * so a first-time user isn't yanked into the Spotify app unprompted.
   */
  async restore(): Promise<boolean> {
    const enabled = await AsyncStorage.getItem(ENABLED_KEY);
    if (enabled !== '1') return false;
    try {
      await this.connect();
      return this.connected;
    } catch {
      this.setConnected(false);
      return false;
    }
  }

  /** Reflect App Remote drops and reconnect through them. Idempotent. */
  private attachListeners() {
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    SpotifyRemote.addListener('remoteDisconnected', () => {
      this.setConnected(false);
      void this.autoReconnect();
    });
    SpotifyRemote.addListener('remoteConnected', () => {
      this.setConnected(true);
    });
  }

  /**
   * Transparently re-authorize + reconnect after a drop (usually a ~1h token
   * expiry). Guarded so an intentional disconnect or a failing connection can't
   * loop.
   */
  private async autoReconnect(): Promise<void> {
    if (this.disabling || this.reconnecting) return;
    const enabled = await AsyncStorage.getItem(ENABLED_KEY);
    if (enabled !== '1') return;

    const now = Date.now();
    if (now - this.lastReconnectAt < RECONNECT_MIN_GAP_MS) return;
    this.lastReconnectAt = now;

    this.reconnecting = true;
    try {
      // Prefer the silent path: reuse the SDK session (auto-refreshed by the
      // token backend) so we recover from a token expiry without yanking the
      // user into the Spotify app. Fall back to a full authorize() only if
      // there's no usable session (e.g. first launch, or backend not set up).
      const ok = await this.reconnectSilently().catch(() => false);
      if (!ok) await this.connect();
    } catch {
      // Leave disconnected; the UI shows Connect and the user can retry.
    } finally {
      this.reconnecting = false;
    }
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

  // --- Catalog search (Web API, not the App Remote SDK) ---

  /**
   * Search the Spotify catalog for tracks. The App Remote SDK can't search, so
   * we hit the Web API directly with the access token from the auth session.
   * Throws a friendly message if we're not connected or the token has expired
   * (the auto-reconnect above refreshes it shortly after).
   */
  async searchTracks(query: string, limit = 20): Promise<SpotifyTrack[]> {
    const q = query.trim();
    if (!q) return [];
    if (!this.accessToken) throw new Error('Connect to Spotify first.');

    const url =
      'https://api.spotify.com/v1/search?type=track&limit=' +
      limit +
      '&q=' +
      encodeURIComponent(q);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (res.status === 401) {
      // Token expired; nudge a reconnect so it refreshes, then ask to retry.
      void this.autoReconnect();
      throw new Error('Spotify session refreshing — try the search again.');
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
