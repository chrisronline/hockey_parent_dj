import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { theme } from '../theme';
import { usePlayback } from '../playback/usePlayback';
import { playback } from '../playback/playbackEngine';
import { formatMs } from '../utils';

/**
 * The now-playing surface. When a clip starts it takes over the whole screen
 * (big art + big controls, easy to hit from the bench). A minimize button drops
 * it to a compact bar so you can still navigate — tapping the bar brings the
 * full view back. Mounted once at the root so it floats over every screen.
 */
export function NowPlaying() {
  const status = usePlayback();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();

  // Jump to the goal board mid-playlist (e.g. a goal is scored). Minimizing to
  // the bar first keeps the song going and hands the screen back to the board.
  const goToGoalBoard = () => {
    setExpanded(false);
    router.navigate('/');
  };

  // Full-screen by default; minimizing drops to the compact bar.
  const [expanded, setExpanded] = useState(true);

  // Track elapsed time within the current clip. We accumulate wall-clock deltas
  // only while playing, so pausing freezes the clock and resuming continues it.
  const [elapsed, setElapsed] = useState(0);
  const accRef = useRef(0);
  const segStartRef = useRef<number | null>(null);

  const idle = status.state === 'idle';
  const song = idle ? undefined : status.song;
  const index = idle ? 0 : status.index;
  // Where the audio actually began (a clip start, or a resume point partway in).
  const startPositionMs = idle ? 0 : status.startPositionMs;
  const playing = status.state === 'playing';
  // Goal songs (goal board / roster) play "compact": they stay in the bar rather
  // than taking over the screen.
  const compact = status.state === 'idle' ? false : status.compact;
  const songKey = song ? `${song.uri}:${index}` : 'idle';

  // Take over the full screen whenever a new track starts — a fresh play, a
  // queue advance, or a manual skip. Keying on the song (not just idle->active)
  // means skipping while minimized still pops back to the big view, which is the
  // whole point: whatever's playing should be big and in front. Minimize still
  // works within the current track.
  const lastKey = useRef('idle');
  useEffect(() => {
    // Compact (goal) songs drop straight to the bar; everything else takes over.
    if (songKey !== 'idle' && songKey !== lastKey.current) setExpanded(!compact);
    lastKey.current = songKey;
  }, [songKey, compact]);

  // Reset the clock whenever the track (or queue position) changes, or we seek
  // to a new position (startPositionMs jumps) — so a scrub reseeds cleanly.
  useEffect(() => {
    accRef.current = 0;
    segStartRef.current = null;
    setElapsed(0);
  }, [songKey, startPositionMs]);

  // Run the ticking clock while playing; bank the segment on pause/change.
  useEffect(() => {
    if (!playing) return;
    segStartRef.current = Date.now();
    const id = setInterval(() => {
      const seg =
        segStartRef.current != null ? Date.now() - segStartRef.current : 0;
      setElapsed(accRef.current + seg);
    }, 250);
    return () => {
      if (segStartRef.current != null) {
        accRef.current += Date.now() - segStartRef.current;
        segStartRef.current = null;
      }
      clearInterval(id);
      setElapsed(accRef.current);
    };
  }, [playing, songKey, startPositionMs]);

  // --- Scrubbing (full-screen progress bar) ---
  // While dragging, seekFrac (0..1) previews the target; on release we commit a
  // seek. Geometry lives in a ref updated each render so the PanResponder below
  // can be created once and still read current values.
  const [seekFrac, setSeekFrac] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const seekMeta = useRef({
    width: 0,
    clipStart: 0,
    total: undefined as number | undefined,
  });

  const updateSeek = useCallback((x: number) => {
    const { width } = seekMeta.current;
    if (width > 0) setSeekFrac(Math.max(0, Math.min(1, x / width)));
  }, []);
  const commitSeek = useCallback((x: number) => {
    const { width, clipStart, total } = seekMeta.current;
    if (width > 0 && total != null) {
      const frac = Math.max(0, Math.min(1, x / width));
      playback.seekTo(clipStart + frac * total);
    }
    setSeekFrac(null);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => updateSeek(e.nativeEvent.locationX),
      onPanResponderMove: (e) => updateSeek(e.nativeEvent.locationX),
      onPanResponderRelease: (e) => commitSeek(e.nativeEvent.locationX),
      onPanResponderTerminate: () => setSeekFrac(null),
    })
  ).current;

  if (idle || !song) return null;

  const start = song.startMs ?? 0;
  const end = song.stopMs ?? song.durationMs;
  const clipLength = end != null && end > start ? end - start : undefined;
  // On a resume we seek partway into the clip, so seed the clock with how far
  // in we started; `elapsed` (from 0) then ticks on top of it.
  const offset = Math.max(0, startPositionMs - start);
  const played = offset + elapsed;
  const shownElapsed =
    clipLength != null ? Math.min(played, clipLength) : played;
  const progress = clipLength ? Math.min(1, played / clipLength) : 0;

  // Feed current geometry to the scrub handlers, and derive what the big bar
  // shows (the drag preview while scrubbing, otherwise live playback).
  seekMeta.current = {
    width: trackWidth,
    clipStart: start,
    total: clipLength ?? song.durationMs,
  };
  const scrubbing = seekFrac != null;
  const scrubProgress = scrubbing ? (seekFrac as number) : progress;
  const scrubElapsedMs =
    scrubbing && clipLength != null ? (seekFrac as number) * clipLength : shownElapsed;

  const queue = status.queue;
  const hasQueue = queue.length > 1;
  const positionLabel = hasQueue ? `  ·  ${index + 1} of ${queue.length}` : '';

  const toggle = () => (playing ? playback.pause() : playback.resume());
  const canSkip = index + 1 < queue.length;

  // Progress bar shared by both layouts.
  const ProgressBar = (
    <View style={styles.progressRow}>
      <Text style={styles.time}>{formatMs(shownElapsed)}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.time}>
        {clipLength != null ? formatMs(clipLength) : '--:--'}
      </Text>
    </View>
  );

  // --- Compact bar (minimized) ---
  if (!expanded) {
    return (
      <Pressable style={styles.barWrap} onPress={() => setExpanded(true)}>
        <View style={styles.barRow}>
          {song.albumImageUrl ? (
            <Image source={{ uri: song.albumImageUrl }} style={styles.barArt} />
          ) : (
            <View style={[styles.barArt, styles.artPlaceholder]}>
              <Text style={styles.artGlyph}>🎵</Text>
            </View>
          )}
          <View style={styles.barMeta}>
            <View style={styles.labelRow}>
              <View style={[styles.dot, playing && styles.dotLive]} />
              <Text style={styles.label}>
                {playing ? 'NOW PLAYING' : 'PAUSED'}
                {positionLabel}
              </Text>
            </View>
            <Text style={styles.barTitle} numberOfLines={1}>
              {song.title || 'Unknown track'}
            </Text>
            <Text style={styles.barArtist} numberOfLines={1}>
              {song.artist || 'Apple Music'}
            </Text>
          </View>
          <Pressable style={styles.barPlayBtn} onPress={toggle} hitSlop={8}>
            <Text style={styles.barPlayText}>{playing ? '❙❙' : '▶'}</Text>
          </Pressable>
          <Pressable
            style={[styles.barStopBtn, !canSkip && styles.disabled]}
            onPress={() => playback.next()}
            disabled={!canSkip}
            hitSlop={8}
          >
            <Text style={styles.barSkipText}>▶▶</Text>
          </Pressable>
          <Pressable
            style={styles.barStopBtn}
            onPress={() => playback.stop()}
            hitSlop={8}
          >
            <Text style={styles.barStopText}>■</Text>
          </Pressable>
        </View>
        {ProgressBar}
      </Pressable>
    );
  }

  // --- Full-screen takeover (expanded) ---
  const artSize = Math.min(width - theme.spacing(6), 360);

  return (
    <View
      style={[
        styles.fullWrap,
        { paddingTop: insets.top + theme.spacing(1), paddingBottom: insets.bottom + theme.spacing(3) },
      ]}
    >
      <View style={styles.fullHeader}>
        <Pressable
          style={styles.minimizeBtn}
          onPress={() => setExpanded(false)}
          hitSlop={12}
        >
          <Text style={styles.minimizeGlyph}>⌄</Text>
        </Pressable>
        <View style={styles.labelRow}>
          <View style={[styles.dot, playing && styles.dotLive]} />
          <Text style={styles.label}>
            {playing ? 'NOW PLAYING' : 'PAUSED'}
            {positionLabel}
          </Text>
        </View>
        <Pressable style={styles.goalBoardBtn} onPress={goToGoalBoard} hitSlop={8}>
          <Text style={styles.goalBoardText}>🥅 Board</Text>
        </Pressable>
      </View>

      <View style={styles.fullBody}>
        {song.albumImageUrl ? (
          <Image
            source={{ uri: song.albumImageUrl }}
            style={[styles.fullArt, { width: artSize, height: artSize }]}
          />
        ) : (
          <View
            style={[
              styles.fullArt,
              styles.artPlaceholder,
              { width: artSize, height: artSize },
            ]}
          >
            <Text style={styles.fullArtGlyph}>🎵</Text>
          </View>
        )}

        <Text style={styles.fullTitle} numberOfLines={2}>
          {song.title || 'Unknown track'}
        </Text>
        <Text style={styles.fullArtist} numberOfLines={1}>
          {song.artist || 'Apple Music'}
        </Text>

        <View style={styles.fullProgressWrap}>
          <View style={styles.progressRow}>
            <Text style={styles.time}>{formatMs(scrubElapsedMs)}</Text>
            <View
              style={styles.seekTouch}
              onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
              {...panResponder.panHandlers}
            >
              <View style={styles.seekTrack}>
                <View
                  style={[styles.seekFill, { width: `${scrubProgress * 100}%` }]}
                />
                <View
                  style={[styles.seekKnob, { left: `${scrubProgress * 100}%` }]}
                />
              </View>
            </View>
            <Text style={styles.time}>
              {clipLength != null ? formatMs(clipLength) : '--:--'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.fullControls}>
        <Pressable
          style={styles.stopBtnLg}
          onPress={() => playback.stop()}
          hitSlop={8}
        >
          <Text style={styles.stopTextLg}>■</Text>
        </Pressable>
        <Pressable style={styles.playBtnLg} onPress={toggle} hitSlop={8}>
          <Text style={styles.playTextLg}>{playing ? '❙❙' : '▶'}</Text>
        </Pressable>
        <Pressable
          style={[styles.stopBtnLg, !canSkip && styles.disabled]}
          onPress={() => playback.next()}
          disabled={!canSkip}
          hitSlop={8}
        >
          <Text style={styles.skipTextLg}>▶▶</Text>
        </Pressable>
      </View>
    </View>
  );
}

const ART = 64;

const styles = StyleSheet.create({
  // Shared bits
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    marginBottom: 2,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.colors.textMuted,
  },
  dotLive: { backgroundColor: theme.colors.primary },
  label: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  artPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  artGlyph: { fontSize: 26 },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.cardAlt,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: theme.colors.primary,
  },
  time: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 38,
    textAlign: 'center',
  },

  // Compact bar
  barWrap: {
    backgroundColor: theme.colors.card,
    borderTopWidth: 2,
    borderTopColor: theme.colors.primary,
    paddingHorizontal: theme.spacing(2),
    paddingTop: theme.spacing(1.5),
    paddingBottom: theme.spacing(1.5),
    gap: theme.spacing(1.25),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 12,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1.5),
  },
  barArt: {
    width: ART,
    height: ART,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardAlt,
  },
  barMeta: { flex: 1, justifyContent: 'center' },
  barTitle: { color: theme.colors.text, fontSize: 19, fontWeight: '800' },
  barArtist: { color: theme.colors.textMuted, fontSize: 14, marginTop: 1 },
  barPlayBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barPlayText: {
    color: theme.colors.primaryText,
    fontSize: 20,
    fontWeight: '900',
  },
  barStopBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.cardAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barStopText: { color: theme.colors.text, fontSize: 18, fontWeight: '900' },
  // Two play triangles = "next". Shrunk + negative tracking so they read as one
  // skip glyph rather than two spaced arrows.
  barSkipText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: -2,
    paddingLeft: 1,
  },

  // Full-screen takeover
  fullWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.bg,
    paddingHorizontal: theme.spacing(3),
    zIndex: 50,
    elevation: 50,
  },
  fullHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  minimizeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minimizeGlyph: {
    color: theme.colors.text,
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 34,
  },
  goalBoardBtn: {
    height: 44,
    paddingHorizontal: theme.spacing(1.5),
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalBoardText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  fullBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
  },
  fullArt: {
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.cardAlt,
    marginBottom: theme.spacing(3),
  },
  fullArtGlyph: { fontSize: 72 },
  fullTitle: {
    color: theme.colors.text,
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
  },
  fullArtist: {
    color: theme.colors.textMuted,
    fontSize: 18,
    textAlign: 'center',
    marginTop: 2,
  },
  fullProgressWrap: {
    alignSelf: 'stretch',
    marginTop: theme.spacing(3),
  },
  // Tall, transparent touch area so the thin visual bar is easy to grab/drag.
  seekTouch: {
    flex: 1,
    height: 40,
    justifyContent: 'center',
  },
  seekTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.cardAlt,
    justifyContent: 'center',
  },
  seekFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 5,
    backgroundColor: theme.colors.primary,
  },
  seekKnob: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    marginLeft: -12,
    top: -7,
    backgroundColor: theme.colors.primary,
    borderWidth: 3,
    borderColor: theme.colors.bg,
  },
  fullControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing(2),
  },
  playBtnLg: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playTextLg: {
    color: theme.colors.primaryText,
    fontSize: 56,
    fontWeight: '900',
  },
  stopBtnLg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.cardAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopTextLg: { color: theme.colors.text, fontSize: 26, fontWeight: '900' },
  skipTextLg: {
    color: theme.colors.text,
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: -3,
    paddingLeft: 2,
  },
  disabled: { opacity: 0.3 },
});
