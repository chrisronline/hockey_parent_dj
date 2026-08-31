import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../src/theme';
import { useConnectionStore } from '../../src/stores/connectionStore';
import { Button, Card } from '../../src/components/ui';

export default function SettingsScreen() {
  const { connected, connecting, error, connect, disconnect } =
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
            Apple Music: {connected ? 'Connected' : 'Not connected'}
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={{ marginTop: theme.spacing(2) }}>
          {connected ? (
            <Button title="Disconnect" variant="danger" onPress={disconnect} />
          ) : (
            <Button
              title="Connect Apple Music"
              onPress={connect}
              loading={connecting}
            />
          )}
        </View>
      </Card>

      <Card style={{ marginTop: theme.spacing(2) }}>
        <Text style={styles.cardTitle}>Requirements</Text>
        <Text style={styles.body}>
          • An active Apple Music subscription on this device{'\n'}
          • Allow Apple Music access when prompted (Settings → Hockey Parent DJ →
          Media & Apple Music){'\n'}
          • The app streams the audio itself, so it controls the lock screen and
          Control Center — no other music app needs to be running.
        </Text>
      </Card>

      <Card style={{ marginTop: theme.spacing(2) }}>
        <Text style={styles.cardTitle}>Fades & clip timing</Text>
        <Text style={styles.body}>
          Fades ramp your phone's output volume. For best results at the rink,
          plug the phone into the PA and set the phone volume where you want the
          peak — fades ramp up to that level.
        </Text>
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
  error: { color: theme.colors.danger, fontSize: 14, marginTop: theme.spacing(1.5) },
});
