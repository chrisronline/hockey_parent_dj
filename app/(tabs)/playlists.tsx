import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { theme, CATEGORY_COLORS } from '../../src/theme';
import { usePlaylistStore } from '../../src/stores/playlistStore';
import { useConnectionStore } from '../../src/stores/connectionStore';
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
import { Playlist } from '../../src/types';

export default function PlaylistsScreen() {
  const router = useRouter();
  const playlists = usePlaylistStore((s) => s.playlists);
  const addPlaylist = usePlaylistStore((s) => s.addPlaylist);
  const addSong = usePlaylistStore((s) => s.addSong);
  const connected = useConnectionStore((s) => s.connected);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<PlaylistCategory>('Warmups');

  // AI generation sheet state.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiCategory, setAiCategory] = useState<PlaylistCategory>('Warmups');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Apple Music import sheet state.
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  // The "+" FAB opens this little menu of add actions, keeping the game-day
  // list uncluttered instead of a stack of full-width buttons at the bottom.
  const [menuOpen, setMenuOpen] = useState(false);

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
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await generatePlaylist(prompt, 30, aiCategory);
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
      // Imported songs land Uncategorized — the user can recategorize and set
      // clip/fade per song from the playlist detail screen.
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
  // play something from this list" moments. Plays the whole list shuffled in
  // the mini-bar, so the first song is random and Next keeps pulling another,
  // all without leaving the playlists view.
  const playRandom = (p: Playlist) => {
    if (p.songs.length === 0) return;
    playback.playPlaylist(p.songs, true, {
      compact: true,
      // Intermission lists remember their spot no matter how they were started,
      // so the "Resume last played" button works after a random start too.
      intermissionPlaylistId: p.category === 'Intermission' ? p.id : undefined,
    });
  };

  // Group playlists under their category headers, preserving category order.
  const grouped = PLAYLIST_CATEGORIES.map((cat) => ({
    category: cat,
    items: playlists.filter((p) => p.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content}>
        {grouped.length === 0 ? (
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
              {g.items.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => router.push(`/playlist/${p.id}`)}
                >
                  <Card style={styles.plCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.plName}>{p.name}</Text>
                      <Text style={styles.plMeta}>
                        {p.songs.length} song{p.songs.length === 1 ? '' : 's'}
                        {p.shuffle ? ' · shuffle' : ''}
                      </Text>
                    </View>
                    {p.songs.length > 0 && (
                      <Pressable
                        style={styles.diceBtn}
                        onPress={() => playRandom(p)}
                        hitSlop={8}
                      >
                        <Text style={styles.diceText}>🎲</Text>
                      </Pressable>
                    )}
                    <Text style={styles.chevron}>›</Text>
                  </Card>
                </Pressable>
              ))}
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
              Pick one of your Apple Music playlists to copy its songs in. Set
              clip start/stop and fades per song afterward.
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
  plCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing(1),
  },
  plName: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  plMeta: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  chevron: { color: theme.colors.textMuted, fontSize: 28, fontWeight: '300' },
  diceBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.cardAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing(1),
  },
  diceText: { fontSize: 20 },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyText: { color: theme.colors.textMuted, fontSize: 14 },
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
