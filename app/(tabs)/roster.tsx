import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '../../src/theme';
import { useRosterStore } from '../../src/stores/rosterStore';
import { Player } from '../../src/types';
import { Button, Card, Field, Empty, BottomSheet } from '../../src/components/ui';
import { SongEditor } from '../../src/components/SongEditor';
import { TrackSearch } from '../../src/components/TrackSearch';
import { playback } from '../../src/playback/playbackEngine';
import { suggestClip } from '../../src/ai/clipAI';
import { mapPool, retry } from '../../src/utils';
import { AI_CONFIGURED } from '../../src/config';

export default function RosterScreen() {
  const { players, addPlayer, updatePlayer, removePlayer, assignSong, importRoster } =
    useRosterStore();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [importText, setImportText] = useState('');

  // Batch AI clip generation across every player's goal song.
  const [clipping, setClipping] = useState(false);
  const [clipDone, setClipDone] = useState(0);

  const withSongs = players.filter((p) => p.song);

  const generateAllGoalClips = async () => {
    if (withSongs.length === 0) return;
    setClipping(true);
    setClipDone(0);
    let failed = 0;
    // A few at a time with retries — same throttling as the playlist batch, so a
    // big roster doesn't blow past the backend's rate limit and lose most clips.
    await mapPool(
      withSongs,
      4,
      async (p) => {
        if (!p.song) return;
        try {
          const clip = await retry(() => suggestClip(p.song!));
          assignSong(p.id, {
            ...p.song,
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
        `Set clips for ${withSongs.length - failed} of ${withSongs.length} goal songs. ${failed} couldn't be suggested — open those players and tap "Suggest clip" to retry.`
      );
    }
  };

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
                      playback.playSong(p.song, {
                        queue: [p.song],
                        index: 0,
                        compact: true,
                      })
                    }
                  >
                    <Text style={styles.playText}>▶</Text>
                  </Pressable>
                )}
              </Pressable>

              {expanded === p.id && (
                <View style={styles.assignArea}>
                  <View style={styles.editRow}>
                    <View style={{ flex: 3 }}>
                      <Field
                        label="Name"
                        value={p.name}
                        onChangeText={(t) => updatePlayer(p.id, { name: t })}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Number"
                        value={p.number ?? ''}
                        onChangeText={(t) =>
                          updatePlayer(p.id, { number: t.trim() || undefined })
                        }
                        keyboardType="number-pad"
                      />
                    </View>
                  </View>

                  <Text style={styles.sectionLabel}>
                    {p.song ? 'Change goal song' : 'Assign goal song'}
                  </Text>
                  <TrackSearch
                    onPick={(t) =>
                      assignSong(p.id, {
                        id: p.song?.id ?? p.id,
                        uri: t.uri,
                        title: t.title,
                        artist: t.artist,
                        albumImageUrl: t.albumImageUrl,
                        durationMs: t.durationMs,
                      })
                    }
                  />

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

        {AI_CONFIGURED && withSongs.length > 0 && (
          <Button
            title={
              clipping
                ? `Generating clips ${clipDone}/${withSongs.length}…`
                : '✨ Generate clips for all goal songs'
            }
            variant="secondary"
            onPress={generateAllGoalClips}
            disabled={clipping}
            style={{ marginTop: theme.spacing(1) }}
          />
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
      <BottomSheet
        visible={adding}
        onClose={() => setAdding(false)}
        title="Add Player"
      >
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
      </BottomSheet>

      {/* Bulk import */}
      <BottomSheet
        visible={importing}
        onClose={() => setImporting(false)}
        title="Import Roster"
      >
        <Text style={styles.muted}>
          One player per line. Use "Name, Number" or "Number, Name" — number is
          optional.
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
      </BottomSheet>
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
  editRow: { flexDirection: 'row', gap: theme.spacing(1.5) },
  sectionLabel: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: theme.spacing(0.5),
    marginBottom: theme.spacing(0.5),
  },
  rowBtns: { flexDirection: 'row', gap: theme.spacing(1), marginTop: theme.spacing(1) },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing(1.5),
    marginTop: theme.spacing(1),
  },
  modalActions: {
    flexDirection: 'row',
    gap: theme.spacing(1.5),
    marginTop: theme.spacing(1),
  },
});
