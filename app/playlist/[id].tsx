import React, { useState } from 'react';
import {
  Alert,
  Image,
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
import { useSessionStore } from '../../src/stores/sessionStore';
import { useIntermissionStore } from '../../src/stores/intermissionStore';
import { Button, Card, Empty, BottomSheet } from '../../src/components/ui';
import { SongEditor } from '../../src/components/SongEditor';
import { TrackSearch } from '../../src/components/TrackSearch';
import { playback } from '../../src/playback/playbackEngine';
import { formatMs, mapPool, retry } from '../../src/utils';
import { suggestClip } from '../../src/ai/clipAI';
import { AI_CONFIGURED } from '../../src/config';

export default function PlaylistDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const playlist = usePlaylistStore((s) =>
    s.playlists.find((p) => p.id === id)
  );
  const { updatePlaylist, removePlaylist, addSong, updateSong, removeSong, reorderSongs } =
    usePlaylistStore();

  // Which songs have already been played this game (keyed by track uri).
  const played = useSessionStore((s) => s.played);
  const resetPlayed = useSessionStore((s) => s.resetPlayed);

  // Saved "pick up where we left off" spot for this (intermission) playlist.
  const resume = useIntermissionStore((s) => (id ? s.resumes[id] : undefined));

  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Batch AI clip generation across every song in the playlist.
  const [clipping, setClipping] = useState(false);
  const [clipDone, setClipDone] = useState(0);

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

  // How many songs in this playlist have already been played this game.
  const playedCount = playlist.songs.filter((s) => played[s.uri]).length;

  // Does any song carry a clip window or fade? Gates the "clear clips" action.
  const clippedCount = playlist.songs.filter(
    (s) =>
      s.startMs != null ||
      s.stopMs != null ||
      s.fadeInMs != null ||
      s.fadeOutMs != null
  ).length;

  // Wipe every song's clip window + fades so each plays start-to-finish. Handy
  // for warmup-style lists where the full track is wanted, or to redo clips.
  const clearAllClips = () => {
    Alert.alert(
      'Remove all clips?',
      `Every song in "${playlist.name}" will play full-length (clip start/stop and fades cleared).`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove clips',
          style: 'destructive',
          onPress: () =>
            playlist.songs.forEach((s) =>
              updateSong(playlist.id, s.id, {
                startMs: undefined,
                stopMs: undefined,
                fadeInMs: undefined,
                fadeOutMs: undefined,
              })
            ),
        },
      ]
    );
  };

  const newGame = () => {
    Alert.alert(
      'Start a new game?',
      'This clears the "played" markers across all playlists so you start fresh.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: resetPlayed },
      ]
    );
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

  const generateAllClips = async () => {
    const songs = playlist.songs;
    if (songs.length === 0) return;
    setClipping(true);
    setClipDone(0);
    let failed = 0;
    // Run a few at a time with retries. Firing all N requests at once (a large
    // playlist can be 90+) blows past the backend's rate limit, so most get
    // throttled and dropped — the reason a big batch only completed ~25 of 92.
    await mapPool(
      songs,
      4,
      async (s) => {
        try {
          const clip = await retry(() => suggestClip(s));
          updateSong(playlist.id, s.id, {
            startMs: clip.startMs,
            stopMs: clip.stopMs,
            fadeInMs: clip.fadeInMs,
            fadeOutMs: clip.fadeOutMs,
          });
        } catch {
          failed += 1;
        }
      },
      (done) => setClipDone(done)
    );
    setClipping(false);
    if (failed > 0) {
      Alert.alert(
        'Clips generated',
        `Set clips for ${songs.length - failed} of ${songs.length} songs. ${failed} couldn't be suggested — open those songs and tap the clip button to retry.`
      );
    }
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
            onPress={() =>
              playback.playPlaylist(
                playlist.songs,
                playlist.shuffle,
                // Intermission lists remember where they left off so you can
                // resume next intermission (see the Resume button below).
                playlist.category === 'Intermission'
                  ? { intermissionPlaylistId: playlist.id }
                  : undefined
              )
            }
            disabled={playlist.songs.length === 0}
            style={{ marginTop: theme.spacing(1.5) }}
          />
          {playlist.category === 'Intermission' && (
            // Always shown on intermission lists so the feature is discoverable;
            // disabled until there's a saved spot to pick up from.
            <Button
              title={
                resume
                  ? `▶ Resume — ${resume.songTitle} (${formatMs(
                      resume.positionMs
                    )})`
                  : '▶ Resume last played (nothing saved yet)'
              }
              variant="secondary"
              onPress={() => resume && playback.resumeIntermission(resume)}
              disabled={!resume}
              style={{ marginTop: theme.spacing(1) }}
            />
          )}
          {AI_CONFIGURED && playlist.songs.length > 0 && (
            <Button
              title={
                clipping
                  ? `Generating clips ${clipDone}/${playlist.songs.length}…`
                  : '✨ Generate clips for all songs'
              }
              variant="secondary"
              onPress={generateAllClips}
              disabled={clipping}
              style={{ marginTop: theme.spacing(1) }}
            />
          )}
          {clippedCount > 0 && (
            <Button
              title="Remove all clips"
              variant="ghost"
              onPress={clearAllClips}
              style={{ marginTop: theme.spacing(1) }}
            />
          )}
          {playedCount > 0 && (
            <View style={styles.playedRow}>
              <Text style={styles.muted}>
                {playedCount} of {playlist.songs.length} played this game
              </Text>
              <Pressable onPress={newGame} hitSlop={8}>
                <Text style={styles.newGameText}>New game</Text>
              </Pressable>
            </View>
          )}
        </Card>

        {playlist.songs.length === 0 ? (
          <Empty text="No songs yet. Search Apple Music below to add one." />
        ) : (
          playlist.songs.map((song, i) => {
            const isPlayed = !!played[song.uri];
            return (
            <Card
              key={song.id}
              style={{
                marginBottom: theme.spacing(1),
                opacity: isPlayed ? 0.55 : 1,
              }}
            >
              <View style={styles.songRow}>
                {song.albumImageUrl ? (
                  <Image
                    source={{ uri: song.albumImageUrl }}
                    style={styles.art}
                  />
                ) : (
                  <View style={[styles.art, styles.artPlaceholder]}>
                    <Text style={styles.artPlaceholderText}>🎵</Text>
                  </View>
                )}
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() =>
                    setExpanded(expanded === song.id ? null : song.id)
                  }
                >
                  <View style={styles.titleRow}>
                    <Text style={styles.songTitle} numberOfLines={1}>
                      {song.title}
                    </Text>
                    {isPlayed && <Text style={styles.playedPill}>✓ Played</Text>}
                  </View>
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
            );
          })
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
  art: { width: 44, height: 44, borderRadius: 6, backgroundColor: theme.colors.border },
  artPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  artPlaceholderText: { fontSize: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1) },
  songTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  playedPill: {
    color: theme.colors.primary,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  playedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.spacing(1.5),
  },
  newGameText: { color: theme.colors.primary, fontSize: 14, fontWeight: '700' },
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
