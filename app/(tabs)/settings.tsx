import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../src/theme';
import { useConnectionStore } from '../../src/stores/connectionStore';
import { Button, Card } from '../../src/components/ui';
import { SPOTIFY_REDIRECT_URI } from '../../src/config';

export default function SettingsScreen() {
  const { connected, connecting, error, configured, connect, disconnect } =
    useConnectionStore();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: connected ? theme.colors.primary : theme.colors.danger },
            ]}
          />
          <Text style={styles.statusText}>
            Spotify: {connected ? 'Connected' : 'Not connected'}
          </Text>
        </View>

        {!configured && (
          <Text style={styles.warn}>
            No Client ID set. Add yours in app.json → expo.extra.spotifyClientId,
            then rebuild the dev client.
          </Text>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={{ marginTop: theme.spacing(2) }}>
          {connected ? (
            <Button title="Disconnect" variant="danger" onPress={disconnect} />
          ) : (
            <Button
              title="Connect Spotify"
              onPress={connect}
              loading={connecting}
              disabled={!configured}
            />
          )}
        </View>
      </Card>

      <Card style={{ marginTop: theme.spacing(2) }}>
        <Text style={styles.cardTitle}>Requirements</Text>
        <Text style={styles.body}>
          • Spotify Premium account{'\n'}
          • The Spotify app installed and logged in on this device{'\n'}
          • Playback controls the Spotify app, so keep it running in the
          background during games.
        </Text>
      </Card>

      <Card style={{ marginTop: theme.spacing(2) }}>
        <Text style={styles.cardTitle}>Fades & clip timing</Text>
        <Text style={styles.body}>
          Fades ramp your phone's output volume (Spotify doesn't expose an
          in-app volume control). For best results at the rink, plug the phone
          into the PA and set the phone volume where you want the peak — fades
          ramp up to that level.
        </Text>
      </Card>

      <Card style={{ marginTop: theme.spacing(2) }}>
        <Text style={styles.cardTitle}>Setup reference</Text>
        <Text style={styles.body}>Redirect URI to register in Spotify Dashboard:</Text>
        <Text selectable style={styles.mono}>
          {SPOTIFY_REDIRECT_URI}
        </Text>
        <Button
          title="Open Spotify Developer Dashboard"
          variant="ghost"
          style={{ marginTop: theme.spacing(1.5) }}
          onPress={() =>
            Linking.openURL('https://developer.spotify.com/dashboard')
          }
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.spacing(1.5) },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing(1) },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusText: { color: theme.colors.text, fontSize: 18, fontWeight: '800' },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: theme.spacing(1),
  },
  body: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 21 },
  warn: { color: theme.colors.warning, fontSize: 14, marginTop: theme.spacing(1.5) },
  error: { color: theme.colors.danger, fontSize: 14, marginTop: theme.spacing(1.5) },
  mono: {
    color: theme.colors.text,
    fontSize: 13,
    fontFamily: 'Courier',
    backgroundColor: theme.colors.cardAlt,
    padding: theme.spacing(1),
    borderRadius: theme.radius.sm,
    marginTop: theme.spacing(0.5),
  },
});
