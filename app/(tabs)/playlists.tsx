import React, { useLayoutEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { theme, CATEGORY_COLORS } from '../../src/theme';
import { usePlaylistStore } from '../../src/stores/playlistStore';
import { useConnectionStore } from '../../src/stores/connectionStore';
import { useSessionStore } from '../../src/stores/sessionStore';
import {
  PLAYLIST_CATEGORIES,
  PlaylistCategory,
} from '../../src/types';
import { Button, Card, Field, BottomSheet } from '../../src/components/ui';
import { PlaylistImport } from '../../src/components/PlaylistImport';
import { generatePlaylist } from '../../src/ai/playlistAI';
import { AI_CONFIGURED } from '../../src/config';
import { appleMusic, ApplePlaylist } from '../../src/appleMusic/appleMusicService';
import { playback } from '../../src/playback/playbackEngine';
import { Playlist, Song } from '../../src/types';

export default function PlaylistsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const playlists = usePlaylistStore((s) => s.playlists);
  const addPlaylist = usePlaylistStore((s) => s.addPlaylist);
  const addSong = usePlaylistStore((s) => s.addSong);
  const connected = useConnectionStore((s) => s.connected);

  // Per-game "already played" markers (keyed by song uri, shared across every
  // playlist). Random play skips these; "New game" clears them.
  const played = useSessionStore((s) => s.played);
  const resetPlayed = useSessionStore((s) => s.resetPlayed);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<PlaylistCategory>('Warmups');

  // AI generation sheet state.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiCategory, setAiCategory] = useState<PlaylistCategory>('Warmups');
  const [aiCount, setAiCount] = useState('30');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Apple Music import sheet state.
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  // The "+" FAB opens this little menu of add actions, keeping the game-day
  // list uncluttered instead of a stack of full-width buttons at the bottom.
  const [menuOpen, setMenuOpen] = useState(false);

  // "Is this song already in one of my playlists?" — a local search across every
  // playlist's songs, opened from the header. While there's a query we swap the
  // category list for a flat list of matching songs, each showing which
  // playlist(s) it lives in.
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const toggleSearch = () =>
    setSearchOpen((open) => {
      if (open) setSearch(''); // closing clears the query so the list returns
      return !open;
    });
  const q = search.trim().toLowerCase();
  const matches: { song: Song; inPlaylists: Playlist[] }[] = (() => {
    if (!q) return [];
    // Collapse the same track (by Apple Music uri) appearing in multiple
    // playlists into a single row that lists all of them.
    const byUri = new Map<string, { song: Song; inPlaylists: Playlist[] }>();
    for (const p of playlists) {
      for (const s of p.songs) {
        if (
          !s.title.toLowerCase().includes(q) &&
          !(s.artist ?? '').toLowerCase().includes(q)
        )
          continue;
        const hit = byUri.get(s.uri);
        if (hit) {
          if (!hit.inPlaylists.some((pl) => pl.id === p.id))
            hit.inPlaylists.push(p);
        } else {
          byUri.set(s.uri, { song: s, inPlaylists: [p] });
        }
      }
    }
    return Array.from(byUri.values());
  })();

  const create = () => {
    if (!name.trim()) return;
    const pl = addPlaylist(name.trim(), category);
    setName('');
    setCreating(false);
    router.push(`/playlist/${pl.id}`);
  };

  const generate = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) return;
    // Clamp to a sane range so a blank/garbage field can't ask for 0 or 500.
    const count = Math.max(1, Math.min(100, parseInt(aiCount, 10) || 30));
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await generatePlaylist(prompt, count, aiCategory);
      if (result.songs.length === 0) {
        setAiError(
          'No songs could be found on Apple Music for that request. Try rephrasing.'
        );
        return;
      }
      const pl = addPlaylist(result.name, aiCategory);
      result.songs.forEach((song) => addSong(pl.id, song));

      // Reset + close before navigating away.
      setAiPrompt('');
      setAiOpen(false);

      if (result.unmatched.length > 0) {
        Alert.alert(
          'Playlist created',
          `Added ${result.songs.length} songs. Couldn't find ${
            result.unmatched.length
          } on Apple Music:\n\n${result.unmatched.join('\n')}`
        );
      }
      router.push(`/playlist/${pl.id}`);
    } catch (e: any) {
      setAiError(e?.message ?? 'Could not generate a playlist.');
    } finally {
      setAiLoading(false);
    }
  };

  const importPlaylist = async (source: ApplePlaylist) => {
    setImporting(true);
    try {
      const tracks = await appleMusic.getPlaylistSongs(source.id);
      if (tracks.length === 0) {
        Alert.alert('Nothing to import', `"${source.name}" has no songs.`);
        return;
      }
      // Imported playlists land Uncategorized; move them into a section and
      // tune song clips/fades from the playlist detail screen afterward.
      const pl = addPlaylist(source.name, 'Uncategorized');
      tracks.forEach((t) =>
        addSong(pl.id, {
          uri: t.uri,
          title: t.title,
          artist: t.artist,
          albumImageUrl: t.albumImageUrl,
          durationMs: t.durationMs,
        })
      );
      setImportOpen(false);
      router.push(`/playlist/${pl.id}`);
    } catch (e: any) {
      Alert.alert('Import failed', e?.message ?? 'Could not import that playlist.');
    } finally {
      setImporting(false);
    }
  };

  // Fire a random song from a playlist without opening it — for mid-game "just
  // play something from this list" moments. Plays the not-yet-played songs
  // shuffled in the mini-bar, so the first song is random and Next keeps pulling
  // another, all without repeating a song already played this game.
  const playRandom = (p: Playlist) => {
    if (p.songs.length === 0) return;
    const fresh = p.songs.filter((s) => !played[s.uri]);
    if (fresh.length === 0) {
      Alert.alert(
        'All songs played',
        `Every song in "${p.name}" has already been played this game. Start a new game to play them again.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'New game', style: 'destructive', onPress: resetPlayed },
        ]
      );
      return;
    }
    playback.playPlaylist(fresh, true, {
      compact: true,
      // Intermission lists remember their spot no matter how they were started,
      // so the "Resume last played" button works after a random start too.
      intermissionPlaylistId: p.category === 'Intermission' ? p.id : undefined,
    });
  };

  // Clear the per-game played markers across every playlist. Not playlist-
  // specific — it resets the whole game.
  const confirmNewGame = () => {
    Alert.alert(
      'Start a new game?',
      'This clears the "played" markers across all playlists so every song is fresh again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: resetPlayed },
      ]
    );
  };

  // How many distinct songs (that still live in a playlist) have been played.
  const playedCount = new Set(
    playlists.flatMap((p) => p.songs.map((s) => s.uri)).filter((u) => played[u])
  ).size;

  // Surface the two screen-level actions in the nav header rather than stacking
  // controls above the list: a search toggle, and "New game" (only once there's
  // something to reset).
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable onPress={toggleSearch} hitSlop={10}>
            <Text style={styles.headerIcon}>{searchOpen ? '✕' : '🔍'}</Text>
          </Pressable>
          {playedCount > 0 && (
            <Pressable onPress={confirmNewGame} hitSlop={10}>
              <Text style={styles.headerAction}>New game</Text>
            </Pressable>
          )}
        </View>
      ),
    });
  }, [navigation, searchOpen, playedCount]);

  // Group playlists under their category headers, preserving category order.
  const grouped = PLAYLIST_CATEGORIES.map((cat) => ({
    category: cat,
    items: playlists.filter((p) => p.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {searchOpen && (
          <Field
            label="Find a song in your playlists"
            value={search}
            onChangeText={setSearch}
            placeholder="Song or artist name"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            autoFocus
          />
        )}

        {q ? (
          matches.length === 0 ? (
            <Card style={{ marginTop: theme.spacing(1) }}>
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptyText}>
                No song in any playlist matches “{search.trim()}”.
              </Text>
            </Card>
          ) : (
            <View style={{ marginTop: theme.spacing(1) }}>
              <Text style={styles.resultCount}>
                {matches.length} song{matches.length === 1 ? '' : 's'} found
              </Text>
              {matches.map(({ song, inPlaylists }) => (
                <Card key={song.uri} style={styles.resultCard}>
                  <View style={styles.resultRow}>
                    {song.albumImageUrl ? (
                      <Image
                        source={{ uri: song.albumImageUrl }}
                        style={styles.resultArt}
                      />
                    ) : (
                      <View style={[styles.resultArt, styles.artPlaceholder]}>
                        <Text style={styles.artGlyph}>🎵</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultTitle} numberOfLines={1}>
                        {song.title}
                      </Text>
                      <Text style={styles.resultArtist} numberOfLines={1}>
                        {song.artist || 'Apple Music'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.chipRow}>
                    {inPlaylists.map((p) => (
                      <Pressable
                        key={p.id}
                        onPress={() => router.push(`/playlist/${p.id}`)}
                        style={[
                          styles.plChip,
                          { borderColor: CATEGORY_COLORS[p.category] },
                        ]}
                      >
                        <View
                          style={[
                            styles.dot,
                            { backgroundColor: CATEGORY_COLORS[p.category] },
                          ]}
                        />
                        <Text style={styles.plChipText} numberOfLines={1}>
                          {p.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </Card>
              ))}
            </View>
          )
        ) : grouped.length === 0 ? (
          <Card style={{ marginTop: theme.spacing(2) }}>
            <Text style={styles.emptyTitle}>No playlists yet</Text>
            <Text style={styles.emptyText}>
              Make one for warmups, in-game hype, intermission, or the win song.
            </Text>
          </Card>
        ) : (
          grouped.map((g) => (
            <View key={g.category} style={{ marginBottom: theme.spacing(2) }}>
              <View style={styles.sectionHeader}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: CATEGORY_COLORS[g.category] },
                  ]}
                />
                <Text style={styles.sectionTitle}>{g.category}</Text>
              </View>
              <View style={styles.grid}>
                {g.items.map((p) => {
                  // How many of this playlist's songs have been played this game.
                  const plPlayed = p.songs.filter((s) => played[s.uri]).length;
                  return (
                    <Pressable
                      key={p.id}
                      style={styles.tile}
                      onPress={() => router.push(`/playlist/${p.id}`)}
                    >
                      <Card style={styles.tileCard}>
                        <Text style={styles.plName} numberOfLines={2}>
                          {p.name}
                        </Text>
                        <View style={styles.tileFooter}>
                          <Text style={styles.plMeta} numberOfLines={2}>
                            {p.songs.length} song
                            {p.songs.length === 1 ? '' : 's'}
                            {p.shuffle ? ' · shuffle' : ''}
                            {plPlayed > 0 ? ` · ${plPlayed} played` : ''}
                          </Text>
                          {p.songs.length > 0 && (
                            <Pressable
                              style={styles.diceBtn}
                              onPress={() => playRandom(p)}
                              hitSlop={8}
                            >
                              <Text style={styles.diceText}>🎲</Text>
                            </Pressable>
                          )}
                        </View>
                      </Card>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Pressable
        style={styles.fab}
        onPress={() => setMenuOpen(true)}
        hitSlop={8}
      >
        <Text style={styles.fabGlyph}>＋</Text>
      </Pressable>

      <BottomSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Add a playlist"
      >
        <Button
          title="+ New Playlist"
          onPress={() => {
            setMenuOpen(false);
            setCreating(true);
          }}
        />
        <Button
          title="⬇ Import from Apple Music"
          variant="secondary"
          onPress={() => {
            setMenuOpen(false);
            setImportOpen(true);
          }}
          style={{ marginTop: theme.spacing(1) }}
        />
        {AI_CONFIGURED && (
          <Button
            title="✨ Generate with AI"
            variant="secondary"
            onPress={() => {
              setMenuOpen(false);
              setAiError(null);
              setAiOpen(true);
            }}
            style={{ marginTop: theme.spacing(1) }}
          />
        )}
      </BottomSheet>

      <BottomSheet
        visible={creating}
        onClose={() => setCreating(false)}
        title="New Playlist"
      >
        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Pre-game Hype"
          autoFocus
        />
        <Text style={styles.label}>Category</Text>
        <View style={styles.catRow}>
          {PLAYLIST_CATEGORIES.map((c) => (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              style={[
                styles.catChip,
                category === c && {
                  backgroundColor: CATEGORY_COLORS[c],
                  borderColor: CATEGORY_COLORS[c],
                },
              ]}
            >
              <Text
                style={[
                  styles.catChipText,
                  category === c && { color: theme.colors.bg },
                ]}
              >
                {c}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.modalActions}>
          <View style={{ flex: 1 }}>
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => setCreating(false)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Create" onPress={create} />
          </View>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={aiOpen}
        onClose={() => (aiLoading ? null : setAiOpen(false))}
        title="Generate with AI"
      >
        {connected ? (
          <>
            <Text style={styles.aiHint}>
              Describe the vibe and Claude will pick songs, find them on Apple
              Music, and suggest a hype-clip start/stop for each. Give it a few
              seconds.
            </Text>
            <Field
              label="What do you want?"
              value={aiPrompt}
              onChangeText={setAiPrompt}
              placeholder="e.g. high-energy warmup songs for a 10U team, clean lyrics"
              multiline
              editable={!aiLoading}
              style={{ minHeight: 88, textAlignVertical: 'top' }}
              autoFocus
            />
            <Field
              label="How many songs?"
              value={aiCount}
              onChangeText={setAiCount}
              placeholder="30"
              keyboardType="number-pad"
              editable={!aiLoading}
            />
            <Text style={styles.label}>Category</Text>
            <View style={styles.catRow}>
              {PLAYLIST_CATEGORIES.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setAiCategory(c)}
                  disabled={aiLoading}
                  style={[
                    styles.catChip,
                    aiCategory === c && {
                      backgroundColor: CATEGORY_COLORS[c],
                      borderColor: CATEGORY_COLORS[c],
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.catChipText,
                      aiCategory === c && { color: theme.colors.bg },
                    ]}
                  >
                    {c}
                  </Text>
                </Pressable>
              ))}
            </View>
            {aiError ? <Text style={styles.aiError}>{aiError}</Text> : null}
            <View style={styles.modalActions}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Cancel"
                  variant="ghost"
                  onPress={() => setAiOpen(false)}
                  disabled={aiLoading}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Generate"
                  onPress={generate}
                  loading={aiLoading}
                  disabled={!aiPrompt.trim()}
                />
              </View>
            </View>
          </>
        ) : (
          <Text style={styles.aiHint}>
            Connect to Apple Music in Settings first — the generator needs it to
            find the songs it picks.
          </Text>
        )}
      </BottomSheet>

      <BottomSheet
        visible={importOpen}
        onClose={() => (importing ? null : setImportOpen(false))}
        title="Import from Apple Music"
      >
        {connected ? (
          <>
            <Text style={styles.aiHint}>
              Pick one of your Apple Music playlists to copy its songs in. It
              lands Uncategorized — open it to move it into a section and set
              clip start/stop and fades per song.
            </Text>
            <PlaylistImport onPick={importPlaylist} busy={importing} />
          </>
        ) : (
          <Text style={styles.aiHint}>
            Connect to Apple Music in Settings first — importing reads the
            playlists in your library.
          </Text>
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.spacing(1.5), paddingBottom: theme.spacing(10) },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing(1),
    gap: theme.spacing(1),
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  // Three-column grid of playlist tiles: less vertical scrolling with many
  // lists. `gap` spaces both axes so trailing rows stay left-aligned.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
  },
  tile: { width: '31%' },
  tileCard: {
    minHeight: 104,
    padding: theme.spacing(1.25),
  },
  tileFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    marginTop: 'auto',
  },
  plName: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  plMeta: { color: theme.colors.textMuted, fontSize: 11, flex: 1 },
  diceBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.cardAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diceText: { fontSize: 18 },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyText: { color: theme.colors.textMuted, fontSize: 14 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
    paddingRight: theme.spacing(0.5),
  },
  headerIcon: { fontSize: 18 },
  headerAction: {
    color: theme.colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  resultCount: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: theme.spacing(1),
  },
  resultCard: { marginBottom: theme.spacing(1), gap: theme.spacing(1.25) },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1.5),
  },
  resultArt: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardAlt,
  },
  artPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  artGlyph: { fontSize: 20 },
  resultTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  resultArtist: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(1) },
  plChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    maxWidth: '100%',
    paddingHorizontal: theme.spacing(1.25),
    paddingVertical: theme.spacing(0.75),
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    backgroundColor: theme.colors.cardAlt,
  },
  plChipText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  fab: {
    position: 'absolute',
    right: theme.spacing(2),
    bottom: theme.spacing(2),
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
  },
  fabGlyph: {
    color: theme.colors.primaryText,
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 32,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  catRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
  },
  catChip: {
    paddingHorizontal: theme.spacing(1.5),
    paddingVertical: theme.spacing(1),
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.cardAlt,
  },
  catChipText: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: theme.spacing(1.5) },
  aiHint: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: theme.spacing(1.5),
  },
  aiError: {
    color: theme.colors.danger,
    fontSize: 13,
    marginBottom: theme.spacing(1),
  },
});
