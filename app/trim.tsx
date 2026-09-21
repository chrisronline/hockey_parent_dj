import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { theme } from '../src/theme';
import { Button, Field } from '../src/components/ui';
import { formatMs } from '../src/utils';
import { playback } from '../src/playback/playbackEngine';
import { usePlayback } from '../src/playback/usePlayback';
import { suggestClip } from '../src/ai/clipAI';
import { AI_CONFIGURED } from '../src/config';
import { usePlaylistStore } from '../src/stores/playlistStore';
import { useRosterStore } from '../src/stores/rosterStore';
import { Song } from '../src/types';

// Editor works in seconds for humans; stored values are ms.
function toSec(ms?: number): string {
  return ms == null ? '' : (ms / 1000).toString();
}
function toMs(sec: string): number | undefined {
  const n = parseFloat(sec);
  return isNaN(n) ? undefined : Math.max(0, Math.round(n * 1000));
}
// mm:ss.d — the tenth matters when lining a clip up by ear.
function fmtPrecise(ms: number): string {
  return `${formatMs(ms)}.${Math.floor((ms % 1000) / 100)}`;
}

// Smallest allowed clip length, so start/stop can't cross or collapse.
const MIN_GAP_MS = 500;

// How close (px) a touch must land to a handle to grab it instead of scrubbing.
const GRAB_PX = 44;

type DragMode = 'start' | 'stop' | 'scrub';

/**
 * Big draggable clip timeline, like native video trimming. The whole track maps
 * to [0, durationMs]. A SINGLE gesture owns the bar: at touch-down we decide what
 * you grabbed — the start handle, the stop handle, or the body (to scrub the
 * playhead) — from where your finger landed, then that element follows your
 * finger. One responder means the handles and the scrubber never fight over the
 * touch. Handle drags commit start/stop; a body drag seeks on release so you
 * hear where you land.
 */
function TrimTimeline({
  durationMs,
  startMs,
  stopMs,
  playheadMs,
  onCommitStart,
  onCommitStop,
  onSeek,
}: {
  durationMs: number;
  startMs: number;
  stopMs: number;
  playheadMs: number | null;
  onCommitStart: (ms: number) => void;
  onCommitStop: (ms: number) => void;
  onSeek: (ms: number) => void;
}) {
  const [w, setW] = useState(0);
  // Live drag preview: which element is moving and to what ms. Null when idle.
  const [drag, setDrag] = useState<{ mode: DragMode; ms: number } | null>(null);

  // Latest geometry + callbacks, so the single PanResponder (created once) always
  // reads current values without being recreated on every render.
  const geo = useRef({
    w,
    durationMs,
    startMs,
    stopMs,
    mode: 'scrub' as DragMode,
    dragMs: 0,
    onCommitStart,
    onCommitStop,
    onSeek,
  });
  Object.assign(geo.current, {
    w,
    durationMs,
    startMs,
    stopMs,
    onCommitStart,
    onCommitStop,
    onSeek,
  });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // Hold the gesture: don't let the parent ScrollView take it over mid-drag
      // (that would terminate us and snap the handle back to its committed spot).
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      // Decide start/stop/scrub from where the finger landed, then move it.
      onPanResponderGrant: (e) => {
        const g = geo.current;
        if (g.w <= 0 || g.durationMs <= 0) return;
        const x = Math.max(0, Math.min(e.nativeEvent.locationX, g.w));
        const xStart = (g.startMs / g.durationMs) * g.w;
        const xStop = (g.stopMs / g.durationMs) * g.w;
        const dStart = Math.abs(x - xStart);
        const dStop = Math.abs(x - xStop);
        // Nearest handle within grab range wins; otherwise scrub the body.
        if (dStart <= GRAB_PX && dStart <= dStop) g.mode = 'start';
        else if (dStop <= GRAB_PX) g.mode = 'stop';
        else g.mode = 'scrub';
        moveTo(x);
      },
      onPanResponderMove: (e) => {
        const g = geo.current;
        if (g.w <= 0) return;
        moveTo(Math.max(0, Math.min(e.nativeEvent.locationX, g.w)));
      },
      // Commit on both release and any forced termination, so a drag is never
      // silently discarded.
      onPanResponderRelease: () => {
        commitDrag();
        setDrag(null);
      },
      onPanResponderTerminate: () => {
        commitDrag();
        setDrag(null);
      },
    })
  ).current;

  function commitDrag() {
    const g = geo.current;
    if (g.mode === 'start') g.onCommitStart(g.dragMs);
    else if (g.mode === 'stop') g.onCommitStop(g.dragMs);
    else g.onSeek(g.dragMs);
  }

  // Map a touch x to an ms for the active mode, clamped so the clip stays valid,
  // and push it into both the geo ref (for release) and state (for render).
  function moveTo(x: number) {
    const g = geo.current;
    const raw = (x / g.w) * g.durationMs;
    let ms: number;
    if (g.mode === 'start') ms = Math.max(0, Math.min(raw, g.stopMs - MIN_GAP_MS));
    else if (g.mode === 'stop') ms = Math.min(g.durationMs, Math.max(raw, g.startMs + MIN_GAP_MS));
    else ms = Math.max(0, Math.min(raw, g.durationMs));
    g.dragMs = ms;
    setDrag({ mode: g.mode, ms });
  }

  const msToX = (ms: number) => (durationMs > 0 && w > 0 ? (ms / durationMs) * w : 0);

  const effStart = drag?.mode === 'start' ? drag.ms : startMs;
  const effStop = drag?.mode === 'stop' ? drag.ms : stopMs;
  const headMs = drag?.mode === 'scrub' ? drag.ms : playheadMs;
  const xStart = msToX(effStart);
  const xStop = msToX(effStop);
  const xHead = headMs != null ? msToX(headMs) : null;

  return (
    <View style={styles.timelineOuter}>
      <View
        style={styles.timeline}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        {/* Dim the excluded regions (outside the clip), like a trim selection. */}
        <View style={[styles.dim, { left: 0, width: xStart }]} pointerEvents="none" />
        <View
          style={[styles.dim, { left: xStop, width: Math.max(0, w - xStop) }]}
          pointerEvents="none"
        />
        {/* Bright selected clip window. */}
        <View
          style={[styles.clipRegion, { left: xStart, width: Math.max(0, xStop - xStart) }]}
          pointerEvents="none"
        />
        {/* Playhead (live, or the drag preview while scrubbing). */}
        {xHead != null && (
          <View style={[styles.playheadLine, { left: xHead }]} pointerEvents="none">
            <View style={styles.playheadDot} />
          </View>
        )}
        {/* Handles (visual only — the single responder above drives them). */}
        <View
          style={[styles.handle, { left: xStart }, drag?.mode === 'start' && styles.handleActive]}
          pointerEvents="none"
        >
          <View style={styles.handleGrip} />
          <Text style={styles.handleTag}>start</Text>
        </View>
        <View
          style={[styles.handle, { left: xStop }, drag?.mode === 'stop' && styles.handleActive]}
          pointerEvents="none"
        >
          <View style={styles.handleGrip} />
          <Text style={styles.handleTag}>stop</Text>
        </View>
      </View>
      <View style={styles.timelineScale}>
        <Text style={styles.scaleText}>0:00</Text>
        <Text style={styles.scaleText}>{formatMs(durationMs)}</Text>
      </View>
    </View>
  );
}

/**
 * Full-screen clip trimmer. Opened from a playlist song or a player's goal song
 * (via query params). Owns its own transport so you can play the track and scrub
 * a big timeline at once; NowPlaying hides itself on this route so this is the
 * only surface. Every change persists straight to the source store.
 */
export default function TrimScreen() {
  const router = useRouter();
  const { kind, owner, song: songId } = useLocalSearchParams<{
    kind?: string;
    owner?: string;
    song?: string;
  }>();

  // Resolve the song reactively from whichever store owns it, so a drag that
  // persists immediately reflects back into the timeline.
  const playlistSong = usePlaylistStore((s) =>
    kind === 'playlist'
      ? s.playlists.find((p) => p.id === owner)?.songs.find((x) => x.id === songId)
      : undefined
  );
  const player = useRosterStore((s) =>
    kind === 'player' ? s.players.find((p) => p.id === owner) : undefined
  );
  const updateSong = usePlaylistStore((s) => s.updateSong);
  const assignSong = useRosterStore((s) => s.assignSong);

  const song: Song | undefined = kind === 'player' ? player?.song : playlistSong;

  // Persist a clip patch to the right store.
  const onChange = (patch: Partial<Song>) => {
    if (kind === 'playlist' && owner && songId) updateSong(owner, songId, patch);
    else if (kind === 'player' && owner && song) assignSong(owner, { ...song, ...patch });
  };

  // Fade text fields (start/stop are driven straight off the song).
  const [fadeIn, setFadeIn] = useState(toSec(song?.fadeInMs));
  const [fadeOut, setFadeOut] = useState(toSec(song?.fadeOutMs));

  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // Live playhead: poll the engine while *this* song is the one loaded.
  const status = usePlayback();
  const isLoaded = status.state !== 'idle' && !!song && status.song.uri === song.uri;
  const isPlaying = status.state === 'playing' && !!song && status.song.uri === song.uri;
  // Re-read the position on any seek (startPositionMs jumps) so the marker moves
  // even while paused, right after you scrub.
  const seekSeed = status.state === 'idle' ? 0 : status.startPositionMs;
  const [pos, setPos] = useState<number | null>(null);
  useEffect(() => {
    if (!isLoaded) {
      setPos(null);
      return;
    }
    setPos(playback.positionMs());
    if (!isPlaying) return; // paused: leave the last position shown
    const id = setInterval(() => setPos(playback.positionMs()), 120);
    return () => clearInterval(id);
  }, [isLoaded, isPlaying, seekSeed]);

  // Stop playback when leaving the trimmer so a scanned full track doesn't keep
  // going (and pop the NowPlaying takeover) once you're back in the list.
  useEffect(
    () => () => {
      playback.stop();
    },
    []
  );

  if (!song) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Trim' }} />
        <Text style={styles.muted}>Song not found.</Text>
      </View>
    );
  }

  const durationMs = song.durationMs ?? 0;
  const startMsVal = song.startMs ?? 0;
  const stopMsVal = song.stopMs ?? durationMs;

  const applyStart = (ms: number) => {
    let next = Math.max(0, Math.round(ms));
    next = Math.min(next, Math.max(0, stopMsVal - MIN_GAP_MS));
    onChange({ startMs: next });
  };
  const applyStop = (ms: number) => {
    let next = Math.round(ms);
    if (durationMs) next = Math.min(next, durationMs);
    next = Math.max(next, startMsVal + MIN_GAP_MS);
    onChange({ stopMs: next });
  };

  const commitFades = () => {
    onChange({ fadeInMs: toMs(fadeIn), fadeOutMs: toMs(fadeOut) });
  };

  // Play the clip exactly as it'll play (start→stop with fades).
  const previewClip = () => {
    commitFades();
    playback.playSong(
      {
        ...song,
        startMs: startMsVal,
        stopMs: stopMsVal,
        fadeInMs: toMs(fadeIn),
        fadeOutMs: toMs(fadeOut),
      },
      { compact: true }
    );
  };

  // Play the whole track (no clip window) so you can scrub freely and hear.
  const scanFull = () => {
    playback.playSong(
      { ...song, startMs: 0, stopMs: undefined, fadeInMs: 0, fadeOutMs: 0 },
      { compact: true }
    );
  };

  // Move the playhead by dragging the marker. If the full track is already
  // loaded, just seek. Otherwise (nothing loaded, or a clip preview whose window
  // would clamp the seek) restart the full track at that spot so the marker
  // jumps there and keeps playing — scrub always works, even before you hit play.
  const scrubTo = (ms: number) => {
    const loadedFull = isLoaded && status.song.stopMs == null;
    if (loadedFull) {
      playback.seekTo(ms);
    } else {
      playback.playSong(
        { ...song, startMs: 0, stopMs: undefined, fadeInMs: 0, fadeOutMs: 0 },
        { compact: true, startAtMs: ms }
      );
    }
  };

  const toggle = () => (isPlaying ? playback.pause() : isLoaded ? playback.resume() : scanFull());

  const suggest = async () => {
    setSuggesting(true);
    setSuggestError(null);
    setSuggestNote(null);
    try {
      const clip = await suggestClip(song);
      setFadeIn(toSec(clip.fadeInMs));
      setFadeOut(toSec(clip.fadeOutMs));
      onChange({
        startMs: clip.startMs,
        stopMs: clip.stopMs,
        fadeInMs: clip.fadeInMs,
        fadeOutMs: clip.fadeOutMs,
      });
      setSuggestNote(
        clip.reason
          ? `Suggested ${formatMs(clip.startMs)}–${formatMs(clip.stopMs)}: ${clip.reason}`
          : `Suggested ${formatMs(clip.startMs)}–${formatMs(clip.stopMs)}. Preview and tweak.`
      );
    } catch (e: any) {
      setSuggestError(e?.message ?? 'Could not suggest a clip.');
    } finally {
      setSuggesting(false);
    }
  };

  const Nudge = ({ onNudge }: { onNudge: (deltaMs: number) => void }) => (
    <View style={styles.nudgeRow}>
      {[
        { label: '−1s', d: -1000 },
        { label: '−.1', d: -100 },
        { label: '+.1', d: 100 },
        { label: '+1s', d: 1000 },
      ].map((b) => (
        <Pressable key={b.label} style={styles.nudgeBtn} onPress={() => onNudge(b.d)}>
          <Text style={styles.nudgeText}>{b.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: 'Trim clip',
          headerBackTitle: 'Back',
          // Off so an edge scrub near the left doesn't trigger swipe-to-go-back.
          gestureEnabled: false,
          headerRight: () => (
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          {song.albumImageUrl ? (
            <Image source={{ uri: song.albumImageUrl }} style={styles.art} />
          ) : (
            <View style={[styles.art, styles.artPlaceholder]}>
              <Text style={styles.artGlyph}>🎵</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={2}>
              {song.title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {song.artist || 'Apple Music'}
            </Text>
          </View>
        </View>

        <Text style={styles.playhead}>{pos != null ? fmtPrecise(pos) : '—:—'}</Text>

        {durationMs > 0 ? (
          <>
            <TrimTimeline
              durationMs={durationMs}
              startMs={startMsVal}
              stopMs={stopMsVal}
              playheadMs={pos}
              onCommitStart={applyStart}
              onCommitStop={applyStop}
              onSeek={scrubTo}
            />
            <Text style={styles.hint}>
              Drag the <Text style={styles.hintStrong}>start</Text>/
              <Text style={styles.hintStrong}>stop</Text> handles to set the clip. Drag
              anywhere else on the bar to scrub and hear that spot.
            </Text>
          </>
        ) : (
          <Text style={styles.hint}>
            Track length unknown — use the ± buttons to set the clip.
          </Text>
        )}

        {/* Transport */}
        <View style={styles.transport}>
          <Pressable style={styles.transportBtn} onPress={() => playback.stop()} hitSlop={8}>
            <Text style={styles.transportGlyph}>■</Text>
          </Pressable>
          <Pressable style={styles.playBtn} onPress={toggle} hitSlop={8}>
            <Text style={styles.playGlyph}>{isPlaying ? '❙❙' : '▶'}</Text>
          </Pressable>
          <Pressable style={styles.transportBtn} onPress={previewClip} hitSlop={8}>
            <Text style={styles.transportLabel}>Clip</Text>
          </Pressable>
          <Pressable style={styles.transportBtn} onPress={scanFull} hitSlop={8}>
            <Text style={styles.transportLabel}>Full</Text>
          </Pressable>
        </View>

        {/* Fine tune */}
        <View style={styles.boundRow}>
          <Text style={styles.boundLabel}>Start</Text>
          <Text style={styles.boundValue}>{fmtPrecise(startMsVal)}</Text>
          <Nudge onNudge={(d) => applyStart(startMsVal + d)} />
        </View>
        <View style={styles.boundRow}>
          <Text style={styles.boundLabel}>Stop</Text>
          <Text style={styles.boundValue}>
            {song.stopMs != null ? fmtPrecise(stopMsVal) : durationMs ? formatMs(durationMs) : 'end'}
          </Text>
          <Nudge onNudge={(d) => applyStop(stopMsVal + d)} />
        </View>

        <View style={styles.row}>
          <View style={styles.col}>
            <Field
              label="Fade in (s)"
              value={fadeIn}
              onChangeText={setFadeIn}
              onBlur={commitFades}
              keyboardType="decimal-pad"
              placeholder="0"
            />
          </View>
          <View style={styles.col}>
            <Field
              label="Fade out (s)"
              value={fadeOut}
              onChangeText={setFadeOut}
              onBlur={commitFades}
              keyboardType="decimal-pad"
              placeholder="0"
            />
          </View>
        </View>

        {AI_CONFIGURED && (
          <>
            <Button
              title="✨ Suggest clip with AI"
              onPress={suggest}
              variant="secondary"
              loading={suggesting}
            />
            {suggestNote ? <Text style={styles.note}>{suggestNote}</Text> : null}
            {suggestError ? <Text style={styles.error}>{suggestError}</Text> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.spacing(2), paddingBottom: theme.spacing(6), gap: theme.spacing(1.5) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: theme.colors.textMuted, fontSize: 14 },
  doneText: { color: theme.colors.primary, fontSize: 16, fontWeight: '800' },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1.5) },
  art: { width: 64, height: 64, borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardAlt },
  artPlaceholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  artGlyph: { fontSize: 28 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  artist: { color: theme.colors.textMuted, fontSize: 15, marginTop: 2 },

  playhead: {
    color: theme.colors.text,
    fontSize: 40,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },

  // Timeline
  // Horizontal padding keeps the draggable track away from the screen edges so
  // an edge grab lands on the scrubber, not iOS's back-swipe zone.
  timelineOuter: { paddingHorizontal: theme.spacing(2) },
  timeline: {
    height: 84,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.cardAlt,
    justifyContent: 'center',
    overflow: 'visible',
  },
  dim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: theme.radius.md,
  },
  clipRegion: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: theme.colors.primary,
    opacity: 0.22,
    borderTopWidth: 3,
    borderBottomWidth: 3,
    borderColor: theme.colors.primary,
  },
  playheadLine: {
    position: 'absolute',
    top: -6,
    bottom: -6,
    width: 3,
    marginLeft: -1.5,
    backgroundColor: theme.colors.text,
    alignItems: 'center',
  },
  playheadDot: {
    position: 'absolute',
    top: -8,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: theme.colors.text,
  },
  handle: {
    position: 'absolute',
    top: -8,
    bottom: -8,
    width: 44,
    marginLeft: -22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleActive: { transform: [{ scale: 1.12 }] },
  handleGrip: {
    width: 16,
    height: '100%',
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: theme.colors.bg,
  },
  handleTag: {
    position: 'absolute',
    bottom: -20,
    color: theme.colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timelineScale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing(2),
  },
  scaleText: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  hint: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  hintStrong: { color: theme.colors.primary, fontWeight: '800' },

  // Transport
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(2),
    marginTop: theme.spacing(1),
  },
  playBtn: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: { color: theme.colors.primaryText, fontSize: 34, fontWeight: '900' },
  transportBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.cardAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transportGlyph: { color: theme.colors.text, fontSize: 22, fontWeight: '900' },
  transportLabel: { color: theme.colors.text, fontSize: 14, fontWeight: '800' },

  boundRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1) },
  boundLabel: { color: theme.colors.text, fontSize: 15, fontWeight: '800', width: 44 },
  boundValue: { color: theme.colors.textMuted, fontSize: 16, fontVariant: ['tabular-nums'], width: 72 },
  nudgeRow: { flexDirection: 'row', gap: theme.spacing(0.75), flex: 1, justifyContent: 'flex-end' },
  nudgeBtn: {
    minWidth: 44,
    paddingVertical: theme.spacing(1),
    paddingHorizontal: theme.spacing(1),
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.cardAlt,
    alignItems: 'center',
  },
  nudgeText: { color: theme.colors.text, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: theme.spacing(1.5) },
  col: { flex: 1 },
  note: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  error: { color: theme.colors.danger, fontSize: 13 },
});
