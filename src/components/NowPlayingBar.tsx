import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { usePlayback } from '../playback/usePlayback';
import { playback } from '../playback/playbackEngine';
import { formatMs } from '../utils';

/** Persistent transport shown above the tab bar whenever something is loaded. */
export function NowPlayingBar() {
  const status = usePlayback();

  // Track elapsed time within the current clip. We accumulate wall-clock deltas
  // only while playing, so pausing freezes the bar and resuming continues it.
  const [elapsed, setElapsed] = useState(0);
  const accRef = useRef(0);
  const segStartRef = useRef<number | null>(null);

  const idle = status.state === 'idle';
  const song = idle ? undefined : status.song;
  const index = idle ? 0 : status.index;
  const playing = status.state === 'playing';
  const songKey = song ? `${song.uri}:${index}` : 'idle';

  // Reset the clock whenever the track (or queue position) changes.
  useEffect(() => {
    accRef.current = 0;
    segStartRef.current = null;
    setElapsed(0);
  }, [songKey]);

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
  }, [playing, songKey]);

  if (idle || !song) return null;

  const start = song.startMs ?? 0;
  const end = song.stopMs ?? song.durationMs;
  const clipLength = end != null && end > start ? end - start : undefined;
  const shownElapsed =
    clipLength != null ? Math.min(elapsed, clipLength) : elapsed;
  const progress = clipLength ? Math.min(1, elapsed / clipLength) : 0;

  const queue = status.queue;
  const hasQueue = queue.length > 1;

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        {song.albumImageUrl ? (
          <Image source={{ uri: song.albumImageUrl }} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artPlaceholder]}>
            <Text style={styles.artGlyph}>🎵</Text>
          </View>
        )}

        <View style={styles.meta}>
          <View style={styles.labelRow}>
            <View style={[styles.dot, playing && styles.dotLive]} />
            <Text style={styles.label}>
              {playing ? 'NOW PLAYING' : 'PAUSED'}
              {hasQueue ? `  ·  ${index + 1} of ${queue.length}` : ''}
            </Text>
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {song.title || 'Unknown track'}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {song.artist || 'Apple Music'}
          </Text>
        </View>

        <Pressable
          style={styles.playBtn}
          onPress={() => (playing ? playback.pause() : playback.resume())}
          hitSlop={8}
        >
          <Text style={styles.playText}>{playing ? '❙❙' : '▶'}</Text>
        </Pressable>
        <Pressable style={styles.stopBtn} onPress={() => playback.stop()} hitSlop={8}>
          <Text style={styles.stopText}>■</Text>
        </Pressable>
      </View>

      <View style={styles.progressRow}>
        <Text style={styles.time}>{formatMs(shownElapsed)}</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.time}>
          {clipLength != null ? formatMs(clipLength) : '--:--'}
        </Text>
      </View>
    </View>
  );
}

const ART = 64;

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.colors.card,
    borderTopWidth: 2,
    borderTopColor: theme.colors.primary,
    paddingHorizontal: theme.spacing(2),
    paddingTop: theme.spacing(1.5),
    paddingBottom: theme.spacing(1.5),
    gap: theme.spacing(1.25),
    // Lift it off the content above so it reads as a distinct layer.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1.5),
  },
  art: {
    width: ART,
    height: ART,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardAlt,
  },
  artPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  artGlyph: { fontSize: 26 },
  meta: { flex: 1, justifyContent: 'center' },
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
  title: { color: theme.colors.text, fontSize: 19, fontWeight: '800' },
  artist: { color: theme.colors.textMuted, fontSize: 14, marginTop: 1 },
  playBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playText: { color: theme.colors.primaryText, fontSize: 20, fontWeight: '900' },
  stopBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.cardAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopText: { color: theme.colors.text, fontSize: 18, fontWeight: '900' },
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
});
