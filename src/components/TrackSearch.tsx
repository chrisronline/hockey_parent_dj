import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '../theme';
import { spotify, SpotifyTrack } from '../spotify/spotifyService';
import { Field } from './ui';

/**
 * Live catalog search backed by the Spotify Web API. Debounces keystrokes so we
 * don't fire a request per character, and surfaces the "not connected / session
 * expired" cases as inline text rather than throwing. Tapping a result hands the
 * full track (uri, title, artist, art) back to the caller.
 */
export function TrackSearch({
  onPick,
  autoFocus,
}: {
  onPick: (track: SpotifyTrack) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cancel stale responses: only the latest query's results should win.
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const mine = ++seq.current;
    const handle = setTimeout(async () => {
      try {
        const tracks = await spotify.searchTracks(q);
        if (mine !== seq.current) return; // superseded
        setResults(tracks);
        setError(null);
      } catch (e: any) {
        if (mine !== seq.current) return;
        setResults([]);
        setError(e?.message ?? 'Search failed.');
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 350);

    return () => clearTimeout(handle);
  }, [query]);

  return (
    <View>
      <Field
        label="Search Spotify"
        value={query}
        onChangeText={setQuery}
        placeholder="Song or artist name"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        returnKeyType="search"
      />

      {loading && (
        <View style={styles.status}>
          <ActivityIndicator color={theme.colors.textMuted} />
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {!loading && !error && query.trim().length > 0 && results.length === 0 && (
        <Text style={styles.muted}>No matches.</Text>
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
