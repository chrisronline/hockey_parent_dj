import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { usePlayback } from '../playback/usePlayback';
import { playback } from '../playback/playbackEngine';

/** Persistent transport shown above the tab bar whenever something is loaded. */
export function NowPlayingBar() {
  const status = usePlayback();
  if (status.state === 'idle') return null;

  const { song } = status;
  const playing = status.state === 'playing';

  return (
    <View style={styles.bar}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>
          {song.title || 'Unknown track'}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {song.artist || 'Now playing'}
        </Text>
      </View>
      <Pressable
        style={styles.control}
        onPress={() => (playing ? playback.pause() : playback.resume())}
      >
        <Text style={styles.controlText}>{playing ? '❙❙' : '▶'}</Text>
      </Pressable>
      <Pressable style={styles.control} onPress={() => playback.stop()}>
        <Text style={styles.controlText}>■</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.cardAlt,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing(2),
    paddingVertical: theme.spacing(1),
    gap: theme.spacing(1),
  },
  title: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  artist: { color: theme.colors.textMuted, fontSize: 12 },
  control: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlText: { color: theme.colors.primaryText, fontSize: 16, fontWeight: '900' },
});
