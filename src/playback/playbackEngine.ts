import { Alert } from 'react-native';
import { VolumeManager } from 'react-native-volume-manager';
import { Song } from '../types';
import { shuffle } from '../utils';
import { appleMusic } from '../appleMusic/appleMusicService';
import { useSessionStore } from '../stores/sessionStore';
import {
  useIntermissionStore,
  IntermissionResume,
} from '../stores/intermissionStore';

// Fades ramp the *device output volume*. Apple Music's player has no per-app
// volume control, and for a rink the phone drives the PA anyway — device volume
// is exactly what reaches the speakers, so this is the right lever.
const FADE_TICK_MS = 50; // volume-step cadence during a ramp

export type PlaybackStatus =
  | { state: 'idle' }
  | {
      state: 'playing';
      song: Song;
      queue: Song[];
      index: number;
      compact: boolean;
      // Absolute ms into the track that audio actually started at (a clip start,
      // or a resume point). Lets the now-playing clock/progress reflect a resume.
      startPositionMs: number;
    }
  | {
      state: 'paused';
      song: Song;
      queue: Song[];
      index: number;
      compact: boolean;
      startPositionMs: number;
    };

type Listener = (status: PlaybackStatus) => void;

/**
 * Owns all timers/ramps for a single "now playing" clip. Every new play() call
 * cancels the previous one first, so we never leak a stray stop-timer that would
 * pause the next song mid-play.
 */
class PlaybackEngine {
  private status: PlaybackStatus = { state: 'idle' };
  private listeners = new Set<Listener>();

  private stopTimer?: ReturnType<typeof setTimeout>;
  private fadeTimer?: ReturnType<typeof setInterval>;
  // Volume to restore to after a clip finishes fading; captured on first fade.
  private baseVolume?: number;
  // Monotonic token; a play() started after an await can check it's still current.
  private playToken = 0;

  // --- Position tracking (drives intermission resume) ---
  // We bank wall-clock deltas only while playing, so we can compute how far into
  // the current song we are at any moment, even across pause/resume. Mirrors the
  // clock the now-playing UI runs, but kept here so the engine can snapshot a
  // resume point when an intermission song is interrupted.
  private trackStart = 0; // absolute ms the current song's audio began at
  private elapsedAcc = 0; // played ms banked so far for the current song
  private segStart?: number; // wall-clock (ms) the current playing segment began
  // What's loaded right now, tracked independently of `status` so we can still
  // snapshot after status flips to idle (e.g. mid queue-advance).
  private activeSong?: Song;
  private activeQueue: Song[] = [];
  private activeIndex = 0;
  // Set only when the current playback came from an intermission playlist; gates
  // whether interrupting/stopping it persists a resume point.
  private activeIntermissionId?: string;
  // Kept so a mid-song scrub can re-arm the auto-stop and advance correctly.
  private targetVolume = 1;
  private activeOnEnded?: () => void;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private emit(next: PlaybackStatus) {
    this.status = next;
    this.listeners.forEach((l) => l(next));
  }

  private clearTimers() {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    this.stopTimer = undefined;
    this.fadeTimer = undefined;
  }

  private async getVolume(): Promise<number> {
    try {
      const { volume } = await VolumeManager.getVolume();
      return typeof volume === 'number' ? volume : 1;
    } catch {
      return 1;
    }
  }

  private setVolume(v: number) {
    // Clamp; VolumeManager expects 0..1.
    const clamped = Math.max(0, Math.min(1, v));
    VolumeManager.setVolume(clamped, { showUI: false }).catch(() => {});
  }

  /**
   * Linear volume ramp from `from` to `to` over `durationMs`. Resolves when the
   * ramp finishes or is superseded. Shares the single fadeTimer slot.
   */
  private ramp(from: number, to: number, durationMs: number): Promise<void> {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    if (durationMs <= 0) {
      this.setVolume(to);
      return Promise.resolve();
    }
    const steps = Math.max(1, Math.floor(durationMs / FADE_TICK_MS));
    let step = 0;
    this.setVolume(from);
    return new Promise((resolve) => {
      this.fadeTimer = setInterval(() => {
        step += 1;
        const v = from + (to - from) * (step / steps);
        this.setVolume(v);
        if (step >= steps) {
          if (this.fadeTimer) clearInterval(this.fadeTimer);
          this.fadeTimer = undefined;
          resolve();
        }
      }, FADE_TICK_MS);
    });
  }

  /** Absolute position (ms) within the current song, right now. */
  private currentPositionMs(): number {
    const seg = this.segStart != null ? Date.now() - this.segStart : 0;
    return this.trackStart + this.elapsedAcc + seg;
  }

  /** Bank the in-progress segment into the accumulator and stop the clock. */
  private bankSegment() {
    if (this.segStart != null) {
      this.elapsedAcc += Date.now() - this.segStart;
      this.segStart = undefined;
    }
  }

  /**
   * If the currently-loaded playback came from an intermission playlist, persist
   * where it is so it can be resumed later. Called whenever that playback is
   * about to be superseded, paused, or stopped — so playing goal songs or other
   * lists in between doesn't lose your intermission spot. Call bankSegment()
   * first so the saved position includes time played since the last segment.
   */
  private snapshotIntermission() {
    if (!this.activeIntermissionId || !this.activeSong) return;
    const positionMs = Math.max(0, Math.round(this.currentPositionMs()));
    useIntermissionStore.getState().saveResume({
      playlistId: this.activeIntermissionId,
      queue: this.activeQueue,
      index: this.activeIndex,
      positionMs,
      songTitle: this.activeSong.title,
      savedAt: Date.now(),
    });
  }

  /**
   * Play a single song, honoring its start/stop window and fades.
   * `queue`/`index` are carried through so the UI can show playlist context and
   * so onStopReached can advance to the next track.
   */
  async playSong(
    song: Song,
    opts?: {
      queue?: Song[];
      index?: number;
      onEnded?: () => void;
      // Goal songs fire from the goal board / roster and should stay in the
      // compact bar rather than taking over the whole screen. Defaults to the
      // full-screen takeover used for playlist playback.
      compact?: boolean;
      // Seek here instead of the song's own startMs — used to resume an
      // intermission song partway through where it left off.
      startAtMs?: number;
      // When set, this playback belongs to an intermission playlist and its
      // spot is remembered (per playlist) if interrupted. See snapshotIntermission.
      intermissionPlaylistId?: string;
    }
  ): Promise<void> {
    // Before tearing down the previous clip, remember its spot if it was an
    // intermission song — this is what lets a goal song play mid-intermission
    // without losing your place.
    this.bankSegment();
    this.snapshotIntermission();

    this.clearTimers();
    const token = ++this.playToken;

    const queue = opts?.queue ?? [song];
    const index = opts?.index ?? 0;
    const compact = opts?.compact ?? false;
    // Resuming mid-song: seek to the saved spot and skip the fade-in (you're
    // already partway through, a fade from silence would be wrong).
    const isResume = opts?.startAtMs != null;
    const fadeIn = isResume ? 0 : song.fadeInMs ?? 0;

    // Remember the user's volume once so repeated clips don't drift downward.
    if (this.baseVolume == null) this.baseVolume = await this.getVolume();
    const targetVolume = this.baseVolume ?? 1;

    const start = opts?.startAtMs ?? song.startMs ?? 0;

    // Pre-set volume before audio starts to avoid a blast on fade-in.
    if (fadeIn > 0) this.setVolume(0);
    else this.setVolume(targetVolume);

    try {
      if (!appleMusic.isConnected()) {
        throw new Error('Not connected to Apple Music. Tap Connect in Settings.');
      }
      // Pass the clip start so the seek happens before audio begins (one
      // buffer at the right spot, no 0:00 blip + re-buffer).
      await appleMusic.play(song.uri, start);
      if (token !== this.playToken) return; // superseded while awaiting
    } catch (e: any) {
      if (token !== this.playToken) return;
      this.setVolume(targetVolume); // undo the fade-in pre-mute
      this.emit({ state: 'idle' });
      Alert.alert('Playback failed', e?.message ?? String(e));
      return;
    }

    this.emit({ state: 'playing', song, queue, index, compact, startPositionMs: start });

    // Begin position tracking for this song and record its source, so we can
    // snapshot a resume point if it's an intermission song that gets interrupted.
    this.trackStart = start;
    this.elapsedAcc = 0;
    this.segStart = Date.now();
    this.activeSong = song;
    this.activeQueue = queue;
    this.activeIndex = index;
    this.activeIntermissionId = opts?.intermissionPlaylistId;
    this.targetVolume = targetVolume;
    this.activeOnEnded = opts?.onEnded;

    // Mark this track as played this game so the UI can flag repeats. Keyed by
    // uri (the actual track), set here — only once audio has actually started.
    useSessionStore.getState().markPlayed(song.uri);

    if (fadeIn > 0) {
      this.ramp(0, targetVolume, fadeIn);
    }

    // Schedule the stop + fade-out if a stop point is defined.
    this.scheduleStop(song, start);
  }

  /**
   * (Re)arm the auto-stop + fade-out for the current song, ending at stopMs,
   * measured from `start` (the play/seek position). Called on play and re-called
   * after a scrub so the stop point stays correct wherever you seek to.
   */
  private scheduleStop(song: Song, start: number) {
    if (song.stopMs == null || song.stopMs <= start) return;
    const token = this.playToken;
    const targetVolume = this.targetVolume;
    const playDuration = song.stopMs - start;
    const fadeOut = song.fadeOutMs ?? 0;

    if (fadeOut > 0 && fadeOut < playDuration) {
      // Kick off the fade-out so it *ends* exactly at stopMs.
      this.stopTimer = setTimeout(() => {
        if (token !== this.playToken) return;
        this.ramp(targetVolume, 0, fadeOut).then(() => {
          if (token !== this.playToken) return;
          this.finishClip(
            token,
            targetVolume,
            this.activeQueue,
            this.activeIndex,
            this.activeOnEnded
          );
        });
      }, playDuration - fadeOut);
    } else {
      this.stopTimer = setTimeout(() => {
        if (token !== this.playToken) return;
        this.finishClip(
          token,
          targetVolume,
          this.activeQueue,
          this.activeIndex,
          this.activeOnEnded
        );
      }, playDuration);
    }
  }

  /**
   * Scrub within the current song to an absolute track position (ms), keeping
   * the auto-stop, position tracking, and now-playing clock all in sync. Clamped
   * to the clip window [startMs, stopMs] when one is set.
   */
  async seekTo(absoluteMs: number): Promise<void> {
    const s = this.status;
    if (s.state === 'idle') return;
    const song = s.song;
    const floor = song.startMs ?? 0;
    const ceil = song.stopMs ?? song.durationMs ?? absoluteMs;
    const clamped = Math.max(floor, Math.min(absoluteMs, ceil));

    await appleMusic.seek(clamped);

    // Cancel any in-flight fade/stop, then re-track and re-arm from the new spot.
    this.clearTimers();
    this.setVolume(this.targetVolume);
    this.trackStart = clamped;
    this.elapsedAcc = 0;
    this.segStart = s.state === 'playing' ? Date.now() : undefined;
    if (s.state === 'playing') this.scheduleStop(song, clamped);

    // Re-emit so the now-playing clock reseeds to the new position.
    this.emit({ ...s, startPositionMs: clamped });
  }

  private async finishClip(
    token: number,
    restoreVolume: number,
    queue: Song[],
    index: number,
    onEnded?: () => void
  ) {
    if (token !== this.playToken) return;
    await appleMusic.pause();
    this.setVolume(restoreVolume); // restore for the next clip
    this.emit({ state: 'idle' });
    onEnded?.();
  }

  /**
   * Play a whole playlist, optionally shuffled, auto-advancing on each stop.
   * `compact` keeps it in the mini-bar (e.g. a shuffled in-game queue you fire
   * from the playlists list) rather than the full-screen takeover.
   */
  async playPlaylist(
    songs: Song[],
    shuffleOrder: boolean,
    opts?: { compact?: boolean; intermissionPlaylistId?: string }
  ): Promise<void> {
    const queue = shuffleOrder ? shuffle(songs) : [...songs];
    if (queue.length === 0) return;
    await this.playFromQueue(
      queue,
      0,
      opts?.compact ?? false,
      undefined,
      opts?.intermissionPlaylistId
    );
  }

  /** Resume an intermission playlist from its saved spot, continuing the queue. */
  async resumeIntermission(point: IntermissionResume): Promise<void> {
    if (point.queue.length === 0) return;
    const i = Math.min(point.index, point.queue.length - 1);
    // Stay in the compact bar; seek the first song to where it left off.
    await this.playFromQueue(point.queue, i, true, point.positionMs, point.playlistId);
  }

  /**
   * Play `queue[i]`, wiring its onEnded to advance to the next track. Both
   * automatic advance (clip stop reached) and a manual next() route through
   * here, so skipping keeps the rest of the queue auto-advancing. `compact`
   * rides along so a skip stays in whichever surface the queue started in;
   * `intermissionPlaylistId` rides along so resume-point tracking survives
   * skips and auto-advances. `startAtMs` only seeks the *first* song (a resume).
   */
  private async playFromQueue(
    queue: Song[],
    i: number,
    compact = false,
    startAtMs?: number,
    intermissionPlaylistId?: string
  ): Promise<void> {
    if (i >= queue.length) {
      // Whole queue finished — there's nothing left to resume, so drop the
      // saved point (and detach the source so stop() below doesn't re-save it).
      if (intermissionPlaylistId) {
        useIntermissionStore.getState().clearResume(intermissionPlaylistId);
        this.activeIntermissionId = undefined;
        this.activeSong = undefined;
      }
      await this.stop();
      return;
    }
    await this.playSong(queue[i], {
      queue,
      index: i,
      compact,
      startAtMs,
      intermissionPlaylistId,
      onEnded: () =>
        this.playFromQueue(queue, i + 1, compact, undefined, intermissionPlaylistId),
    });
  }

  /**
   * Skip to the next track in the current queue. No-op when idle; stops (with
   * volume restore) if we're already on the last track. Preserves the current
   * compact/full-screen surface and intermission source across the skip.
   */
  async next(): Promise<void> {
    const s = this.status;
    if (s.state === 'idle') return;
    await this.playFromQueue(
      s.queue,
      s.index + 1,
      s.compact,
      undefined,
      this.activeIntermissionId
    );
  }

  /** True when there's a track after the current one to skip to. */
  hasNext(): boolean {
    const s = this.status;
    return s.state !== 'idle' && s.index + 1 < s.queue.length;
  }

  async pause(): Promise<void> {
    this.clearTimers();
    // Bank the segment and remember the spot (intermission songs) before the
    // clock stops, so a pause + navigate away is still resumable.
    this.bankSegment();
    this.snapshotIntermission();
    await appleMusic.pause();
    if (this.status.state === 'playing') {
      this.emit({ ...this.status, state: 'paused' });
    }
  }

  async resume(): Promise<void> {
    await appleMusic.resume();
    if (this.status.state === 'paused') {
      this.segStart = Date.now(); // restart the clock from here
      this.emit({ ...this.status, state: 'playing' });
    }
  }

  /** Hard stop: cancel everything, pause playback, restore volume. */
  async stop(): Promise<void> {
    // Remember the spot (intermission songs) before we drop the active track.
    this.bankSegment();
    this.snapshotIntermission();
    this.clearTimers();
    this.playToken++; // invalidate any in-flight ramps/timers
    await appleMusic.pause().catch(() => {});
    if (this.baseVolume != null) this.setVolume(this.baseVolume);
    this.activeSong = undefined;
    this.activeIntermissionId = undefined;
    this.segStart = undefined;
    this.emit({ state: 'idle' });
  }

  getStatus() {
    return this.status;
  }
}

export const playback = new PlaybackEngine();
