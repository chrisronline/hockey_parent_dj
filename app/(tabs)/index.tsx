import React, { useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
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

const GAP = theme.spacing(1);
const PAD = theme.spacing(1);

/**
 * Pick the column/row split that makes the tiles as large as possible while
 * fitting all `n` players inside `w`×`h` with no scrolling. We try every column
 * count and keep whichever maximizes the smaller tile dimension, so a full
 * roster stays one tap away on a phone screen.
 */
function bestGrid(n: number, w: number, h: number) {
  let best = { cols: 1, tileW: w, tileH: h, size: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    // Floor to whole pixels so rounding can't push a row's total past the width
    // and wrap a tile onto an extra (scrolling) row.
    const tileW = Math.floor((w - GAP * (cols - 1)) / cols);
    const tileH = Math.floor((h - GAP * (rows - 1)) / rows);
    const size = Math.min(tileW, tileH);
    if (size > best.size) best = { cols, tileW, tileH, size };
  }
  return best;
}

/**
 * The game-day screen: a grid of players sized to fit the whole roster on one
 * screen. Tap a name and their goal song fires immediately (respecting its clip
 * window + fades). One-tap, no menus — you're watching the ice, not the phone.
 */
export default function GoalBoard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const players = useRosterStore((s) => s.players);
  const connected = useConnectionStore((s) => s.connected);
  const status = usePlayback();

  // Measured size of the grid area, so we can size tiles to fit without scroll.
  const [area, setArea] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) =>
    setArea({
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    });

  // Sorted by jersey number ascending; players with no number sort to the end.
  const withSong = players
    .filter((p) => p.song)
    .sort((a, b) => {
      const na = a.number ? parseInt(a.number, 10) : NaN;
      const nb = b.number ? parseInt(b.number, 10) : NaN;
      if (isNaN(na) && isNaN(nb)) return a.name.localeCompare(b.name);
      if (isNaN(na)) return 1;
      if (isNaN(nb)) return -1;
      return na - nb;
    });
  const activeId =
    status.state !== 'idle'
      ? players.find((p) => p.song?.uri === status.song.uri)?.id
      : undefined;

  if (!connected) {
    return (
      <View style={styles.center}>
        <Text style={styles.bigEmoji}>🥅</Text>
        <Text style={styles.centerTitle}>Connect Apple Music to play</Text>
        <Text style={styles.centerText}>
          The goal board needs a live Apple Music connection to fire songs.
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

  // area is the container's box (includes its padding), so subtract it to get
  // the space actually available to the tiles. The bottom uses an extra
  // safe-area inset, matching the container style below.
  const grid =
    area.width > 0
      ? bestGrid(
          withSong.length,
          area.width - PAD * 2,
          area.height - PAD * 2 - insets.bottom
        )
      : null;

  return (
    <View
      style={[styles.grid, { paddingBottom: insets.bottom + PAD }]}
      onLayout={onLayout}
    >
      {grid &&
        withSong.map((p) => {
          const active = p.id === activeId;
          // Scale the label to the tile so names stay readable whether there are
          // 6 players or 30.
          const nameSize = Math.max(14, Math.min(24, grid.tileH * 0.2));
          const showSong = grid.tileH >= 92;
          return (
            <Pressable
              key={p.id}
              style={({ pressed }) => [
                styles.tile,
                { width: grid.tileW, height: grid.tileH },
                active && styles.tileActive,
                pressed && { opacity: 0.85 },
              ]}
              onPress={() =>
                p.song &&
                playback.playSong(p.song, { queue: [p.song], index: 0, compact: true })
              }
            >
              {p.number ? <Text style={styles.number}>#{p.number}</Text> : null}
              <Text style={[styles.name, { fontSize: nameSize }]} numberOfLines={2}>
                {p.name}
              </Text>
              {showSong && (
                <Text style={styles.song} numberOfLines={1}>
                  {active ? '▶ playing' : p.song?.title || 'goal song'}
                </Text>
              )}
            </Pressable>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: theme.spacing(1),
    gap: GAP,
  },
  tile: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: 2,
    borderColor: theme.colors.border,
    padding: theme.spacing(1.25),
    justifyContent: 'center',
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
