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

    // If the remote drops (Spotify app killed, network blip), reflect it.
    SpotifyRemote.addListener('remoteDisconnected', () => {
      this.connected = false;
    });
    SpotifyRemote.addListener('remoteConnected', () => {
      this.connected = true;
    });
  }

  async disconnect(): Promise<void> {
    try {
      await SpotifyRemote.disconnect();
    } finally {
      await SpotifyAuth.endSession();
      this.connected = false;
    }
  }

  /** Re-attach to an existing session on app launch, if one is still valid. */
  async restore(): Promise<boolean> {
    const session = await SpotifyAuth.getSession();
    if (!session?.accessToken) return false;
    try {
      await SpotifyRemote.connect(session.accessToken);
      this.connected = await SpotifyRemote.isConnectedAsync();
      return this.connected;
    } catch {
      this.connected = false;
      return false;
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
}

export const spotify = new SpotifyService();
