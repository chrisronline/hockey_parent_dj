import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { theme } from '../../src/theme';
import { usePlaylistStore } from '../../src/stores/playlistStore';
import { Button, Card, Empty, BottomSheet } from '../../src/components/ui';
import { SongEditor } from '../../src/components/SongEditor';
import { TrackSearch } from '../../src/components/TrackSearch';
import { playback } from '../../src/playback/playbackEngine';
import { formatMs } from '../../src/utils';

export default function PlaylistDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const playlist = usePlaylistStore((s) =>
    s.playlists.find((p) => p.id === id)
  );
  const { updatePlaylist, removePlaylist, addSong, updateSong, removeSong, reorderSongs } =
    usePlaylistStore();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (!playlist) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Playlist not found.</Text>
      </View>
    );
  }

  const closeAdd = () => {
    setAdding(false);
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = [...playlist.songs];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorderSongs(playlist.id, next);
  };

  const confirmDelete = () => {
    Alert.alert('Delete playlist?', `"${playlist.name}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removePlaylist(playlist.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: playlist.name,
          headerBackTitle: 'Playlists',
          headerRight: () => (
            <Pressable onPress={confirmDelete} hitSlop={12}>
              <Text style={{ color: theme.colors.danger, fontWeight: '700' }}>
                Delete
              </Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.controlsCard}>
          <View style={styles.shuffleRow}>
            <View>
              <Text style={styles.controlLabel}>Shuffle order</Text>
              <Text style={styles.muted}>
                Randomize play order each time you hit play
              </Text>
            </View>
            <Switch
              value={playlist.shuffle}
              onValueChange={(v) => updatePlaylist(playlist.id, { shuffle: v })}
              trackColor={{ true: theme.colors.primary }}
            />
          </View>
          <Button
            title={`▶ Play ${playlist.shuffle ? '(shuffled)' : 'in order'}`}
            onPress={() => playback.playPlaylist(playlist.songs, playlist.shuffle)}
            disabled={playlist.songs.length === 0}
            style={{ marginTop: theme.spacing(1.5) }}
          />
        </Card>

        {playlist.songs.length === 0 ? (
          <Empty text="No songs yet. Search Apple Music below to add one." />
        ) : (
          playlist.songs.map((song, i) => (
            <Card key={song.id} style={{ marginBottom: theme.spacing(1) }}>
              <View style={styles.songRow}>
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() =>
                    setExpanded(expanded === song.id ? null : song.id)
                  }
                >
                  <Text style={styles.songTitle} numberOfLines={1}>
                    {song.title}
                  </Text>
                  <Text style={styles.muted} numberOfLines={1}>
                    {song.artist || 'Tap to edit clip & fades'}
                    {song.startMs || song.stopMs
                      ? `  ·  ${formatMs(song.startMs ?? 0)}–${
                          song.stopMs ? formatMs(song.stopMs) : 'end'
                        }`
                      : ''}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.iconBtn}
                  onPress={() =>
                    playback.playSong(song, { queue: [song], index: 0 })
                  }
                >
                  <Text style={styles.iconText}>▶</Text>
                </Pressable>
              </View>

              {expanded === song.id && (
                <View style={styles.editorArea}>
                  <SongEditor
                    song={song}
                    onChange={(patch) => updateSong(playlist.id, song.id, patch)}
                  />
                  <View style={styles.reorderRow}>
                    <Button
                      title="↑"
                      variant="ghost"
                      onPress={() => move(i, -1)}
                      style={{ flex: 1 }}
                    />
                    <Button
                      title="↓"
                      variant="ghost"
                      onPress={() => move(i, 1)}
                      style={{ flex: 1 }}
                    />
                    <Button
                      title="Remove"
                      variant="danger"
                      onPress={() => {
                        removeSong(playlist.id, song.id);
                        setExpanded(null);
                      }}
                      style={{ flex: 2 }}
                    />
                  </View>
                </View>
              )}
            </Card>
          ))
        )}

        <Button
          title="+ Add Song"
          variant="secondary"
          onPress={() => setAdding(true)}
          style={{ marginTop: theme.spacing(1) }}
        />
      </ScrollView>

      <BottomSheet visible={adding} onClose={closeAdd} title="Add Song">
        <TrackSearch
          autoFocus
          onPick={(t) => {
            addSong(playlist.id, {
              uri: t.uri,
              title: t.title,
              artist: t.artist,
              albumImageUrl: t.albumImageUrl,
              durationMs: t.durationMs,
            });
            closeAdd();
          }}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.spacing(1.5), paddingBottom: theme.spacing(6) },
  controlsCard: { marginBottom: theme.spacing(2) },
  shuffleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  controlLabel: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1) },
  songTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  muted: { color: theme.colors.textMuted, fontSize: 13 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { color: theme.colors.primaryText, fontSize: 16, fontWeight: '900' },
  editorArea: {
    marginTop: theme.spacing(1.5),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing(1.5),
  },
  reorderRow: {
    flexDirection: 'row',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
