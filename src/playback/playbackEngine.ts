import { Alert } from 'react-native';
import { VolumeManager } from 'react-native-volume-manager';
import { Song } from '../types';
import { shuffle } from '../utils';
import { appleMusic } from '../appleMusic/appleMusicService';

// Fades ramp the *device output volume*. Apple Music's player has no per-app
// volume control, and for a rink the phone drives the PA anyway — device volume
// is exactly what reaches the speakers, so this is the right lever.
const FADE_TICK_MS = 50; // volume-step cadence during a ramp

export type PlaybackStatus =
  | { state: 'idle' }
  | { state: 'playing'; song: Song; queue: Song[]; index: number }
  | { state: 'paused'; song: Song; queue: Song[]; index: number };

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

  /**
   * Play a single song, honoring its start/stop window and fades.
   * `queue`/`index` are carried through so the UI can show playlist context and
   * so onStopReached can advance to the next track.
   */
  async playSong(
    song: Song,
    opts?: { queue?: Song[]; index?: number; onEnded?: () => void }
  ): Promise<void> {
    this.clearTimers();
    const token = ++this.playToken;

    const queue = opts?.queue ?? [song];
    const index = opts?.index ?? 0;

    // Remember the user's volume once so repeated clips don't drift downward.
    if (this.baseVolume == null) this.baseVolume = await this.getVolume();
    const targetVolume = this.baseVolume ?? 1;

    const start = song.startMs ?? 0;

    // Pre-set volume before audio starts to avoid a blast on fade-in.
    if (song.fadeInMs && song.fadeInMs > 0) this.setVolume(0);
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

    this.emit({ state: 'playing', song, queue, index });

    if (song.fadeInMs && song.fadeInMs > 0) {
      this.ramp(0, targetVolume, song.fadeInMs);
    }

    // Schedule the stop + fade-out if a stop point is defined.
    if (song.stopMs != null && song.stopMs > start) {
      const playDuration = song.stopMs - start;
      const fadeOut = song.fadeOutMs ?? 0;

      if (fadeOut > 0 && fadeOut < playDuration) {
        // Kick off the fade-out so it *ends* exactly at stopMs.
        this.stopTimer = setTimeout(() => {
          if (token !== this.playToken) return;
          this.ramp(targetVolume, 0, fadeOut).then(() => {
            if (token !== this.playToken) return;
            this.finishClip(token, targetVolume, queue, index, opts?.onEnded);
          });
        }, playDuration - fadeOut);
      } else {
        this.stopTimer = setTimeout(() => {
          if (token !== this.playToken) return;
          this.finishClip(token, targetVolume, queue, index, opts?.onEnded);
        }, playDuration);
      }
    }
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

  /** Play a whole playlist, optionally shuffled, auto-advancing on each stop. */
  async playPlaylist(songs: Song[], shuffleOrder: boolean): Promise<void> {
    const queue = shuffleOrder ? shuffle(songs) : [...songs];
    if (queue.length === 0) return;
    await this.playFromQueue(queue, 0);
  }

  /**
   * Play `queue[i]`, wiring its onEnded to advance to the next track. Both
   * automatic advance (clip stop reached) and a manual next() route through
   * here, so skipping keeps the rest of the queue auto-advancing.
   */
  private async playFromQueue(queue: Song[], i: number): Promise<void> {
    if (i >= queue.length) {
      await this.stop();
      return;
    }
    await this.playSong(queue[i], {
      queue,
      index: i,
      onEnded: () => this.playFromQueue(queue, i + 1),
    });
  }

  /**
   * Skip to the next track in the current queue. No-op when idle; stops (with
   * volume restore) if we're already on the last track.
   */
  async next(): Promise<void> {
    const s = this.status;
    if (s.state === 'idle') return;
    await this.playFromQueue(s.queue, s.index + 1);
  }

  /** True when there's a track after the current one to skip to. */
  hasNext(): boolean {
    const s = this.status;
    return s.state !== 'idle' && s.index + 1 < s.queue.length;
  }

  async pause(): Promise<void> {
    this.clearTimers();
    await appleMusic.pause();
    if (this.status.state === 'playing') {
      this.emit({ ...this.status, state: 'paused' });
    }
  }

  async resume(): Promise<void> {
    await appleMusic.resume();
    if (this.status.state === 'paused') {
      this.emit({ ...this.status, state: 'playing' });
    }
  }

  /** Hard stop: cancel everything, pause playback, restore volume. */
  async stop(): Promise<void> {
    this.clearTimers();
    this.playToken++; // invalidate any in-flight ramps/timers
    await appleMusic.pause().catch(() => {});
    if (this.baseVolume != null) this.setVolume(this.baseVolume);
    this.emit({ state: 'idle' });
  }

  getStatus() {
    return this.status;
  }
}

export const playback = new PlaybackEngine();
