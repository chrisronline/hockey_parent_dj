import React, { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '../../src/theme';
import { useRosterStore } from '../../src/stores/rosterStore';
import { Player } from '../../src/types';
import { Button, Card, Field, Empty } from '../../src/components/ui';
import { SongEditor } from '../../src/components/SongEditor';
import { parseTrackUri } from '../../src/spotify/uri';
import { playback } from '../../src/playback/playbackEngine';

export default function RosterScreen() {
  const { players, addPlayer, updatePlayer, removePlayer, assignSong, importRoster } =
    useRosterStore();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [importText, setImportText] = useState('');

  // Per-player song-assignment inputs, keyed by player id.
  const [songUri, setSongUri] = useState('');
  const [songTitle, setSongTitle] = useState('');

  const addOne = () => {
    if (!name.trim()) return;
    addPlayer(name.trim(), number.trim() || undefined);
    setName('');
    setNumber('');
    setAdding(false);
  };

  const doImport = () => {
    const count = importRoster(importText);
    setImportText('');
    setImporting(false);
    Alert.alert('Roster imported', `Added ${count} player${count === 1 ? '' : 's'}.`);
  };

  const openAssign = (p: Player) => {
    setExpanded(expanded === p.id ? null : p.id);
    setSongUri('');
    setSongTitle(p.song?.title ?? '');
  };

  const assign = (p: Player) => {
    const uri = parseTrackUri(songUri);
    if (!uri) {
      Alert.alert('Invalid track', 'Paste a Spotify track link or URI.');
      return;
    }
    assignSong(p.id, {
      id: p.song?.id ?? p.id,
      uri,
      title: songTitle.trim() || 'Goal song',
      artist: '',
    });
    setSongUri('');
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content}>
        {players.length === 0 ? (
          <Empty text="No players yet. Add them one by one, or import a whole roster." />
        ) : (
          players.map((p) => (
            <Card key={p.id} style={{ marginBottom: theme.spacing(1) }}>
              <Pressable style={styles.row} onPress={() => openAssign(p)}>
                <View style={styles.numBadge}>
                  <Text style={styles.numText}>{p.number || '–'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{p.name}</Text>
                  <Text style={styles.muted}>
                    {p.song ? `🎵 ${p.song.title}` : 'No goal song — tap to add'}
                  </Text>
                </View>
                {p.song && (
                  <Pressable
                    style={styles.playBtn}
                    onPress={() =>
                      p.song &&
                      playback.playSong(p.song, { queue: [p.song], index: 0 })
                    }
                  >
                    <Text style={styles.playText}>▶</Text>
                  </Pressable>
                )}
              </Pressable>

              {expanded === p.id && (
                <View style={styles.assignArea}>
                  <Field
                    label="Goal song — Spotify link or URI"
                    value={songUri}
                    onChangeText={setSongUri}
                    placeholder="https://open.spotify.com/track/..."
                    autoCapitalize="none"
                  />
                  <Field
                    label="Song title"
                    value={songTitle}
                    onChangeText={setSongTitle}
                    placeholder="Song name"
                  />
                  <Button title="Save goal song" onPress={() => assign(p)} />

                  {p.song && (
                    <View style={{ marginTop: theme.spacing(1.5) }}>
                      <SongEditor
                        song={p.song}
                        onChange={(patch) =>
                          p.song && assignSong(p.id, { ...p.song, ...patch })
                        }
                      />
                    </View>
                  )}

                  <View style={styles.rowBtns}>
                    {p.song && (
                      <Button
                        title="Clear song"
                        variant="ghost"
                        onPress={() => assignSong(p.id, undefined)}
                        style={{ flex: 1 }}
                      />
                    )}
                    <Button
                      title="Remove player"
                      variant="danger"
                      onPress={() => {
                        removePlayer(p.id);
                        setExpanded(null);
                      }}
                      style={{ flex: 1 }}
                    />
                  </View>
                </View>
              )}
            </Card>
          ))
        )}

        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button
              title="+ Add Player"
              variant="secondary"
              onPress={() => setAdding(true)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Import Roster"
              variant="ghost"
              onPress={() => setImporting(true)}
            />
          </View>
        </View>
      </ScrollView>

      {/* Add single player */}
      <Modal visible={adding} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Add Player</Text>
            <Field label="Name" value={name} onChangeText={setName} autoFocus />
            <Field
              label="Number (optional)"
              value={number}
              onChangeText={setNumber}
              keyboardType="number-pad"
            />
            <View style={styles.modalActions}>
              <View style={{ flex: 1 }}>
                <Button title="Cancel" variant="ghost" onPress={() => setAdding(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Add" onPress={addOne} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Bulk import */}
      <Modal visible={importing} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Import Roster</Text>
            <Text style={styles.muted}>
              One player per line. Use "Name, Number" or "Number, Name" — number
              is optional.
            </Text>
            <View style={{ height: theme.spacing(1.5) }} />
            <Field
              value={importText}
              onChangeText={setImportText}
              placeholder={'Connor McDavid, 97\nSidney Crosby, 87\nJane Smith'}
              multiline
              numberOfLines={8}
              style={{ height: 160, textAlignVertical: 'top' }}
            />
            <View style={styles.modalActions}>
              <View style={{ flex: 1 }}>
                <Button title="Cancel" variant="ghost" onPress={() => setImporting(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Import" onPress={doImport} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.spacing(1.5), paddingBottom: theme.spacing(6) },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1.5) },
  numBadge: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: { color: theme.colors.accent, fontSize: 18, fontWeight: '800' },
  name: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  muted: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playText: { color: theme.colors.primaryText, fontSize: 16, fontWeight: '900' },
  assignArea: {
    marginTop: theme.spacing(1.5),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing(1.5),
  },
  rowBtns: { flexDirection: 'row', gap: theme.spacing(1), marginTop: theme.spacing(1) },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing(1.5),
    marginTop: theme.spacing(1),
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: theme.colors.card,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: theme.spacing(2.5),
    paddingBottom: theme.spacing(4),
  },
  modalTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: theme.spacing(1),
  },
  modalActions: {
    flexDirection: 'row',
    gap: theme.spacing(1.5),
    marginTop: theme.spacing(1),
  },
});
