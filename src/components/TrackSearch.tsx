import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '../theme';
import { appleMusic, AppleTrack } from '../appleMusic/appleMusicService';
import { Button, Field } from './ui';

/**
 * Catalog search backed by Apple Music (MusicKit). Search runs only when you
 * tap Search (or hit the keyboard's search key) — no per-keystroke requests —
 * and surfaces the "not connected" case as inline text rather than throwing.
 * Tapping a result hands the full track (id, title, artist, art) back.
 */
export function TrackSearch({
  onPick,
  autoFocus,
}: {
  onPick: (track: AppleTrack) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AppleTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The query the current results belong to, so the "no matches" line only
  // shows after an actual search (not while typing a fresh query).
  const [searched, setSearched] = useState('');

  // Drop stale responses: only the latest search's results should win.
  const seq = useRef(0);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setSearched(q);
    const mine = ++seq.current;
    try {
      const tracks = await appleMusic.searchTracks(q);
      if (mine !== seq.current) return; // superseded
      setResults(tracks);
    } catch (e: any) {
      if (mine !== seq.current) return;
      setResults([]);
      setError(e?.message ?? 'Search failed.');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  };

  return (
    <View>
      <Field
        label="Search Apple Music"
        value={query}
        onChangeText={setQuery}
        placeholder="Song or artist name"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        returnKeyType="search"
        onSubmitEditing={runSearch}
      />
      <Button
        title="Search"
        onPress={runSearch}
        disabled={!query.trim() || loading}
        style={{ marginBottom: theme.spacing(1.5) }}
      />

      {loading && (
        <View style={styles.status}>
          <ActivityIndicator color={theme.colors.textMuted} />
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {!loading && !error && searched.length > 0 && results.length === 0 && (
        <Text style={styles.muted}>No matches for “{searched}”.</Text>
      )}

      {results.map((t) => (
        <Pressable
          key={t.uri}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={() => onPick(t)}
        >
          {t.albumImageUrl ? (
            <Image source={{ uri: t.albumImageUrl }} style={styles.art} />
          ) : (
            <View style={[styles.art, styles.artPlaceholder]} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {t.title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {t.artist}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  status: { paddingVertical: theme.spacing(1.5), alignItems: 'center' },
  error: {
    color: theme.colors.danger,
    fontSize: 13,
    marginBottom: theme.spacing(1),
  },
  muted: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginBottom: theme.spacing(1),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    paddingVertical: theme.spacing(1),
  },
  rowPressed: { opacity: 0.6 },
  art: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardAlt,
  },
  artPlaceholder: { borderWidth: 1, borderColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  artist: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
});
