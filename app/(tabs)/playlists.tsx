import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { theme, CATEGORY_COLORS } from '../../src/theme';
import { usePlaylistStore } from '../../src/stores/playlistStore';
import {
  PLAYLIST_CATEGORIES,
  PlaylistCategory,
} from '../../src/types';
import { Button, Card, Field, BottomSheet } from '../../src/components/ui';

export default function PlaylistsScreen() {
  const router = useRouter();
  const playlists = usePlaylistStore((s) => s.playlists);
  const addPlaylist = usePlaylistStore((s) => s.addPlaylist);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<PlaylistCategory>('Warmups');

  const create = () => {
    if (!name.trim()) return;
    const pl = addPlaylist(name.trim(), category);
    setName('');
    setCreating(false);
    router.push(`/playlist/${pl.id}`);
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
                    <Text style={styles.chevron}>›</Text>
                  </Card>
                </Pressable>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.fabWrap}>
        <Button title="+ New Playlist" onPress={() => setCreating(true)} />
      </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.spacing(1.5), paddingBottom: theme.spacing(12) },
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
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyText: { color: theme.colors.textMuted, fontSize: 14 },
  fabWrap: {
    position: 'absolute',
    left: theme.spacing(2),
    right: theme.spacing(2),
    bottom: theme.spacing(2),
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
});
