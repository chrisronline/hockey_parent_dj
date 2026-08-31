import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Song } from '../types';
import { theme } from '../theme';
import { Button, Field } from './ui';
import { formatMs } from '../utils';
import { playback } from '../playback/playbackEngine';
import { suggestClip } from '../ai/clipAI';
import { AI_CONFIGURED } from '../config';

// Editor works in seconds for humans; stored values are ms.
function toSec(ms?: number): string {
  return ms == null ? '' : (ms / 1000).toString();
}
function toMs(sec: string): number | undefined {
  const n = parseFloat(sec);
  return isNaN(n) ? undefined : Math.max(0, Math.round(n * 1000));
}

/**
 * Edits the playback window + fades for one Song and previews it. `onChange`
 * receives the patched fields; the parent persists them to whichever store owns
 * this song (playlist or roster).
 */
export function SongEditor({
  song,
  onChange,
}: {
  song: Song;
  onChange: (patch: Partial<Song>) => void;
}) {
  const [start, setStart] = useState(toSec(song.startMs));
  const [stop, setStop] = useState(toSec(song.stopMs));
  const [fadeIn, setFadeIn] = useState(toSec(song.fadeInMs));
  const [fadeOut, setFadeOut] = useState(toSec(song.fadeOutMs));

  // AI clip-suggestion state.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const suggest = async () => {
    setSuggesting(true);
    setSuggestError(null);
    setSuggestNote(null);
    try {
      const clip = await suggestClip(song);
      // Reflect the suggestion in the fields and persist it in one go.
      setStart(toSec(clip.startMs));
      setStop(toSec(clip.stopMs));
      setFadeIn(toSec(clip.fadeInMs));
      setFadeOut(toSec(clip.fadeOutMs));
      onChange({
        startMs: clip.startMs,
        stopMs: clip.stopMs,
        fadeInMs: clip.fadeInMs,
        fadeOutMs: clip.fadeOutMs,
      });
      setSuggestNote(
        clip.reason
          ? `Suggested ${formatMs(clip.startMs)}–${formatMs(clip.stopMs)}: ${clip.reason}`
          : `Suggested ${formatMs(clip.startMs)}–${formatMs(clip.stopMs)}. Preview and tweak as needed.`
      );
    } catch (e: any) {
      setSuggestError(e?.message ?? 'Could not suggest a clip.');
    } finally {
      setSuggesting(false);
    }
  };

  const commit = () => {
    onChange({
      startMs: toMs(start),
      stopMs: toMs(stop),
      fadeInMs: toMs(fadeIn),
      fadeOutMs: toMs(fadeOut),
    });
  };

  const preview = () => {
    commit();
    playback.playSong({
      ...song,
      startMs: toMs(start),
      stopMs: toMs(stop),
      fadeInMs: toMs(fadeIn),
      fadeOutMs: toMs(fadeOut),
    });
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>
        Clip window & fades (seconds). Leave blank for natural start/end.
      </Text>
      <View style={styles.row}>
        <View style={styles.col}>
          <Field
            label="Start (s)"
            value={start}
            onChangeText={setStart}
            onBlur={commit}
            keyboardType="decimal-pad"
            placeholder="0"
          />
        </View>
        <View style={styles.col}>
          <Field
            label="Stop (s)"
            value={stop}
            onChangeText={setStop}
            onBlur={commit}
            keyboardType="decimal-pad"
            placeholder={song.durationMs ? formatMs(song.durationMs) : 'end'}
          />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.col}>
          <Field
            label="Fade in (s)"
            value={fadeIn}
            onChangeText={setFadeIn}
            onBlur={commit}
            keyboardType="decimal-pad"
            placeholder="0"
          />
        </View>
        <View style={styles.col}>
          <Field
            label="Fade out (s)"
            value={fadeOut}
            onChangeText={setFadeOut}
            onBlur={commit}
            keyboardType="decimal-pad"
            placeholder="0"
          />
        </View>
      </View>
      {AI_CONFIGURED && (
        <>
          <Button
            title="✨ Suggest clip with AI"
            onPress={suggest}
            variant="secondary"
            loading={suggesting}
            style={{ marginBottom: theme.spacing(1) }}
          />
          {suggestNote ? <Text style={styles.note}>{suggestNote}</Text> : null}
          {suggestError ? (
            <Text style={styles.error}>{suggestError}</Text>
          ) : null}
        </>
      )}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button title="▶ Preview clip" onPress={preview} variant="secondary" />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="■ Stop" onPress={() => playback.stop()} variant="ghost" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.spacing(1) },
  hint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginBottom: theme.spacing(1),
  },
  row: { flexDirection: 'row', gap: theme.spacing(1.5) },
  col: { flex: 1 },
  note: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: theme.spacing(1),
  },
  error: {
    color: theme.colors.danger,
    fontSize: 12,
    marginBottom: theme.spacing(1),
  },
});
