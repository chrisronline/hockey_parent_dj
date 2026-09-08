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
import { appleMusic, ApplePlaylist } from '../appleMusic/appleMusicService';

/**
 * Lists the user's Apple Music library playlists so one can be imported. Loads
 * on mount, and surfaces the "not connected" / empty cases as inline text
 * rather than throwing (mirrors TrackSearch). Tapping a playlist hands it back
 * to the caller, which fetches its songs and creates a local playlist.
 *
 * `busy` disables the list while the caller is importing a pick.
 */
export function PlaylistImport({
  onPick,
  busy,
}: {
  onPick: (playlist: ApplePlaylist) => void;
  busy?: boolean;
}) {
  const [playlists, setPlaylists] = useState<ApplePlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ignore a resolved load if the component unmounted in the meantime.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        const result = await appleMusic.getUserPlaylists();
        if (!alive.current) return;
        setPlaylists(result);
        setError(null);
      } catch (e: any) {
        if (!alive.current) return;
        setError(e?.message ?? 'Could not load your playlists.');
      } finally {
        if (alive.current) setLoading(false);
      }
    })();
    return () => {
      alive.current = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.status}>
        <ActivityIndicator color={theme.colors.textMuted} />
      </View>
    );
  }

  if (error) return <Text style={styles.error}>{error}</Text>;

  if (playlists.length === 0) {
    return <Text style={styles.muted}>No playlists found in your library.</Text>;
  }

  return (
    <View>
      {playlists.map((p) => (
        <Pressable
          key={p.id}
          disabled={busy}
          style={({ pressed }) => [
            styles.row,
            pressed && styles.rowPressed,
            busy && styles.rowDisabled,
          ]}
          onPress={() => onPick(p)}
        >
          {p.artworkUrl ? (
            <Image source={{ uri: p.artworkUrl }} style={styles.art} />
          ) : (
            <View style={[styles.art, styles.artPlaceholder]} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {p.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {p.trackCount} song{p.trackCount === 1 ? '' : 's'}
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
  rowDisabled: { opacity: 0.4 },
  art: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardAlt,
  },
  artPlaceholder: { borderWidth: 1, borderColor: theme.colors.border },
  name: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  meta: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
});
