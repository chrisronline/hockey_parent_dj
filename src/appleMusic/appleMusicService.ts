import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Auth,
  MusicKit,
  Player,
  AuthStatus,
  CatalogSearchType,
  MusicItem,
} from '@lomray/react-native-apple-music';

// The library's MusicKit.catalogSearch swallows native errors and returns empty
// results, which is indistinguishable from "no matches". We call the underlying
// native module directly so a real failure (e.g. a MusicKit developer-token
// problem) rejects and reaches the UI instead of vanishing.
const { MusicModule } = NativeModules;

// Apple Music (MusicKit) replaces Spotify as our audio source. The big win: the
// app itself streams the audio, so *we* own the iOS now-playing session (lock
// screen / Dynamic Island / Control Center) instead of handing it to Spotify.
// Auth is also persistent — MusicKit remembers the grant across launches, so
// there's no ~1h token expiry and no token backend to run. A persisted "enabled"
// flag lets us reconnect automatically on launch without re-prompting.
//
// Requirements: a paid Apple Developer account with the MusicKit App Service
// enabled on this bundle ID (for catalog search), an Apple Music subscription
// on the device, and iOS 16+.
const ENABLED_KEY = 'appleMusic.enabled.v1';

/**
 * Thin wrapper around @lomray/react-native-apple-music that owns authorization
 * and playback. The playback engine talks to this, never to the library
 * directly, so all the "am I connected?" bookkeeping lives in one place. Method
 * names/shape mirror the old Spotify service so the engine barely changed.
 */
class AppleMusicService {
  private connected = false;
  // Subscribers (the connection store) notified whenever auth state changes so
  // the UI stays accurate.
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

  /**
   * Prompt for Apple Music access (silent if already granted) and verify the
   * account can actually play catalog content. Throws a friendly message if the
   * user declines or has no active subscription.
   */
  async connect(): Promise<void> {
    const status = await Auth.authorize();
    if (status !== AuthStatus.AUTHORIZED) {
      this.setConnected(false);
      throw new Error(
        status === AuthStatus.DENIED
          ? 'Apple Music access was denied. Enable it in Settings → Hockey Parent DJ → Media & Apple Music.'
          : `Apple Music access is ${status}. Please allow access to continue.`
      );
    }

    // Authorized to the library, but playing catalog songs needs an active
    // subscription. checkSubscription throws (MusicSubscriptionError) if the
    // capabilities can't be read; treat that as "not confirmed" and continue —
    // playback will surface the real error if it can't play.
    try {
      const sub = await Auth.checkSubscription();
      if (!sub.canPlayCatalogContent) {
        this.setConnected(false);
        throw new Error(
          'This Apple ID has no active Apple Music subscription, so catalog songs can’t play.'
        );
      }
    } catch (e: any) {
      // Re-throw our own subscription error; swallow the library's capability
      // read failure (rare) so a transient check doesn't block a valid account.
      if (e?.message?.includes('subscription')) throw e;
    }

    this.setConnected(true);
    await AsyncStorage.setItem(ENABLED_KEY, '1');
  }

  /**
   * There's no MusicKit API to revoke authorization from inside the app (the
   * user does that in iOS Settings). We just forget the "enabled" flag so we
   * stop auto-connecting and flip the UI back to disconnected.
   */
  async disconnect(): Promise<void> {
    await AsyncStorage.removeItem(ENABLED_KEY);
    this.setConnected(false);
  }

  /**
   * Re-attach on app launch. Only auto-connects if the user connected before,
   * so a first-time user isn't prompted unprompted. Since MusicKit auth is
   * persistent, authorize() returns immediately without a dialog here.
   */
  async restore(): Promise<boolean> {
    const enabled = await AsyncStorage.getItem(ENABLED_KEY);
    if (enabled !== '1') return false;
    try {
      const status = await Auth.authorize();
      this.setConnected(status === AuthStatus.AUTHORIZED);
      return this.connected;
    } catch {
      this.setConnected(false);
      return false;
    }
  }

  // --- Playback primitives the engine composes into songs/effects ---

  /** Queue a catalog song by its Apple Music ID and start playing it. */
  async play(catalogId: string): Promise<void> {
    await MusicKit.setPlaybackQueue(catalogId, MusicItem.SONG);
    Player.play();
  }

  /** Seek within the current track. Engine works in ms; MusicKit wants seconds. */
  async seek(positionMs: number): Promise<void> {
    Player.seekToTime(positionMs / 1000);
  }

  async resume(): Promise<void> {
    Player.play();
  }

  async pause(): Promise<void> {
    Player.pause();
  }

  getPlayerState() {
    return Player.getCurrentState();
  }

  // --- Catalog search ---

  /**
   * Search the Apple Music catalog for songs. Requires the MusicKit App Service
   * enabled on this bundle ID (paid developer account). The library swallows
   * native errors and returns empty results, so we guard on connection here to
   * give the user a clear reason when nothing comes back.
   */
  async searchTracks(query: string): Promise<AppleTrack[]> {
    const q = query.trim();
    if (!q) return [];
    if (!this.connected) throw new Error('Connect to Apple Music first.');

    // Direct native call (not MusicKit.catalogSearch) so errors reject instead
    // of being swallowed into an empty result.
    const res = await MusicModule.catalogSearch(q, [CatalogSearchType.SONGS], {});
    const songs = res?.songs ?? [];
    return songs.map((s) => {
      // Native returns duration as a string of seconds (e.g. "215.324").
      const durationSec = parseFloat(String(s.duration));
      return {
        uri: s.id,
        title: s.title || 'Untitled track',
        artist: s.artistName || '',
        albumImageUrl: s.artworkUrl ? s.artworkUrl : undefined,
        durationMs: Number.isFinite(durationSec)
          ? Math.round(durationSec * 1000)
          : undefined,
      };
    });
  }
}

export type AppleTrack = {
  uri: string; // Apple Music catalog song ID
  title: string;
  artist: string;
  albumImageUrl?: string;
  durationMs?: number;
};

export const appleMusic = new AppleMusicService();
