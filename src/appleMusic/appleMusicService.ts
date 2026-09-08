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

  /**
   * Queue a catalog song by its Apple Music ID and start playing it, seeking to
   * `startMs` if a clip start is given.
   *
   * We call the native MusicModule.setPlaybackQueue directly instead of
   * MusicKit.setPlaybackQueue: the library wrapper catches native errors, logs
   * them, and *resolves anyway*. So if a track fails to prepare, the queue is
   * left empty/unprepared, the failure is invisible, and the subsequent
   * Player.play() throws `MPMusicPlayerControllerErrorDomain Code=1` with no
   * audio. The direct call rejects, so the engine surfaces the real reason.
   *
   * Seek order: set playbackTime on the prepared (not-yet-playing) queue and
   * *then* play — the order MusicKit documents. Seeking after play() races the
   * async play() and can itself trigger the Code=1 failure above.
   */
  async play(catalogId: string, startMs = 0): Promise<void> {
    await MusicModule.setPlaybackQueue(catalogId, MusicItem.SONG);
    if (startMs > 0) Player.seekToTime(startMs / 1000);
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
    const songs: NativeSong[] = res?.songs ?? [];
    return songs.map((s) => this.toTrack(s));
  }

  // --- Library playlist import ---

  /**
   * List the user's Apple Music library playlists. Like searchTracks, we call
   * the native module directly (not MusicKit.getUserPlaylists) because the
   * library swallows native errors into an empty list — indistinguishable from
   * "you have no playlists". A direct call rejects so the UI can say why.
   */
  async getUserPlaylists(): Promise<ApplePlaylist[]> {
    if (!this.connected) throw new Error('Connect to Apple Music first.');

    // The native side loads each playlist's tracks to report an accurate count,
    // so keep the limit reasonable — most users have well under 100.
    const res = await MusicModule.getUserPlaylists({ limit: 100 });
    const playlists: NativePlaylist[] = res?.playlists ?? [];
    return playlists.map((p) => ({
      id: p.id,
      name: p.name || 'Untitled playlist',
      trackCount: typeof p.trackCount === 'number' ? p.trackCount : 0,
      artworkUrl: p.artworkUrl ? p.artworkUrl : undefined,
    }));
  }

  /**
   * Fetch the songs of one library playlist as AppleTracks, using each song's
   * real catalog ID for playback.
   *
   * A library song's own `id` is a *library* identifier the player can't fetch
   * (MusicCatalogResourceRequest throws "MusicDataRequest.Error error 1" → no
   * audio). But the native mapper also gives us `catalogId`: the catalog ID of
   * the exact same track, which plays reliably (the same path manual "Add Song"
   * uses). So we play that directly — no title/artist re-matching, no wrong
   * versions. We only fall back to a catalog search when a song has no catalog
   * counterpart (e.g. a personal upload / iTunes Match with no match), and keep
   * the original ID if even that finds nothing so the song is still imported.
   */
  async getPlaylistSongs(playlistId: string): Promise<AppleTrack[]> {
    if (!this.connected) throw new Error('Connect to Apple Music first.');

    const res = await MusicModule.getPlaylistSongs(playlistId, {});
    const songs: NativeSong[] = res?.songs ?? [];

    const tracks = await Promise.all(
      songs.map(async (s) => {
        const track = this.toTrack(s);
        if (s.catalogId) return { ...track, uri: s.catalogId };
        try {
          const matches = await this.searchTracks(
            `${track.title} ${track.artist}`.trim()
          );
          if (matches[0]) return matches[0];
        } catch {
          // Keep the original ID as a last-resort fallback (see note above).
        }
        return track;
      })
    );

    // A library song's own artwork usually has no https URL, so imported tracks
    // come back with no album art. Now that each track carries its real catalog
    // ID, fetch the catalog songs (one batched request) and borrow their proper
    // https artwork. Best-effort: if the fetch fails, keep whatever we had.
    return this.fillCatalogArtwork(tracks);
  }

  /**
   * Fill in missing album art from the Apple Music catalog, keyed by catalog ID.
   * Only touches tracks that currently have no artwork, so search/AI matches
   * (which already carry good art) are left untouched.
   */
  private async fillCatalogArtwork(tracks: AppleTrack[]): Promise<AppleTrack[]> {
    const idsNeedingArt = Array.from(
      new Set(tracks.filter((t) => !t.albumImageUrl && t.uri).map((t) => t.uri))
    );
    if (idsNeedingArt.length === 0) return tracks;

    const artById = new Map<string, string>();
    // Catalog resource requests cap how many IDs they'll take at once, so fetch
    // in chunks. Failures are non-fatal — we just leave those tracks art-less.
    const CHUNK = 25;
    for (let i = 0; i < idsNeedingArt.length; i += CHUNK) {
      const chunk = idsNeedingArt.slice(i, i + CHUNK);
      try {
        const res = await MusicModule.getCatalogSongs(chunk);
        for (const s of (res?.songs ?? []) as NativeSong[]) {
          if (s.artworkUrl) artById.set(s.id, s.artworkUrl);
        }
      } catch {
        // Leave this chunk without artwork.
      }
    }

    if (artById.size === 0) return tracks;
    return tracks.map((t) =>
      !t.albumImageUrl && artById.has(t.uri)
        ? { ...t, albumImageUrl: artById.get(t.uri) }
        : t
    );
  }

  /** Map a native song dict to our AppleTrack shape (shared by search + import). */
  private toTrack(s: NativeSong): AppleTrack {
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
  }
}

// Shape of a song dict as returned by the native MusicModule (see
// ios/MusicItemMapper.swift). Duration is a stringified seconds value.
type NativeSong = {
  id: string;
  // Catalog ID of the corresponding Apple Music catalog track. For a library
  // song this differs from `id` (a library identifier) and is the real, playable
  // ID. Empty string when the song has no catalog counterpart.
  catalogId?: string;
  title: string;
  artistName: string;
  artworkUrl: string;
  duration: string;
};

// Shape of a playlist dict as returned by the native MusicModule (see
// ios/MusicItemMapper.swift → map(_ playlist:)).
type NativePlaylist = {
  id: string;
  name: string;
  description: string;
  artworkUrl: string;
  trackCount: number;
};

export type AppleTrack = {
  uri: string; // Apple Music catalog song ID
  title: string;
  artist: string;
  albumImageUrl?: string;
  durationMs?: number;
};

export type ApplePlaylist = {
  id: string; // Apple Music library playlist ID
  name: string;
  trackCount: number;
  artworkUrl?: string;
};

export const appleMusic = new AppleMusicService();
