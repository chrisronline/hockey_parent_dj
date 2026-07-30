import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../src/theme';
import { useRosterStore } from '../../src/stores/rosterStore';
import { useConnectionStore } from '../../src/stores/connectionStore';
import { playback } from '../../src/playback/playbackEngine';
import { usePlayback } from '../../src/playback/usePlayback';
import { Button, Empty } from '../../src/components/ui';

/**
 * The game-day screen: a big grid of players. Tap a name and their goal song
 * fires immediately (respecting its clip window + fades). One-tap, no menus —
 * you're watching the ice, not the phone.
 */
export default function GoalBoard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const players = useRosterStore((s) => s.players);
  const connected = useConnectionStore((s) => s.connected);
  const status = usePlayback();

  const withSong = players.filter((p) => p.song);
  const activeId =
    status.state !== 'idle'
      ? players.find((p) => p.song?.uri === status.song.uri)?.id
      : undefined;

  if (!connected) {
    return (
      <View style={styles.center}>
        <Text style={styles.bigEmoji}>🥅</Text>
        <Text style={styles.centerTitle}>Connect Spotify to play</Text>
        <Text style={styles.centerText}>
          The goal board needs a live Spotify connection to fire songs.
        </Text>
        <Button
          title="Go to Settings"
          onPress={() => router.push('/settings')}
          style={{ marginTop: theme.spacing(2) }}
        />
      </View>
    );
  }

  if (withSong.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.bigEmoji}>🥅</Text>
        <Text style={styles.centerTitle}>No goal songs yet</Text>
        <Empty text="Assign a song to each player on the Roster tab, then tap their name here when they score." />
        <Button
          title="Set up roster"
          onPress={() => router.push('/roster')}
          variant="secondary"
          style={{ marginTop: theme.spacing(2) }}
        />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.grid,
        { paddingBottom: insets.bottom + theme.spacing(3) },
      ]}
    >
      {withSong.map((p) => {
        const active = p.id === activeId;
        return (
          <Pressable
            key={p.id}
            style={({ pressed }) => [
              styles.tile,
              active && styles.tileActive,
              pressed && { opacity: 0.85 },
            ]}
            onPress={() =>
              p.song && playback.playSong(p.song, { queue: [p.song], index: 0 })
            }
          >
            {p.number ? <Text style={styles.number}>#{p.number}</Text> : null}
            <Text style={styles.name} numberOfLines={2}>
              {p.name}
            </Text>
            <Text style={styles.song} numberOfLines={1}>
              {active ? '▶ playing' : p.song?.title || 'goal song'}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: theme.spacing(1.5),
    gap: theme.spacing(1.5),
  },
  tile: {
    width: '47%',
    minHeight: 120,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: 2,
    borderColor: theme.colors.border,
    padding: theme.spacing(2),
    justifyContent: 'space-between',
  },
  tileActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.cardAlt,
  },
  number: { color: theme.colors.accent, fontSize: 15, fontWeight: '800' },
  name: { color: theme.colors.text, fontSize: 22, fontWeight: '800' },
  song: { color: theme.colors.textMuted, fontSize: 13 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(3),
  },
  bigEmoji: { fontSize: 56, marginBottom: theme.spacing(2) },
  centerTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: theme.spacing(1),
  },
  centerText: {
    color: theme.colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
  },
});
