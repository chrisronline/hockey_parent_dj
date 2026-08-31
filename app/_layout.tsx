import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { theme } from '../src/theme';
import { useConnectionStore } from '../src/stores/connectionStore';
import { NowPlayingBar } from '../src/components/NowPlayingBar';

export default function RootLayout() {
  const restore = useConnectionStore((s) => s.restore);

  // Try to re-attach to an existing Apple Music session on cold start.
  useEffect(() => {
    restore();
  }, [restore]);

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.colors.bg },
            headerTintColor: theme.colors.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: theme.colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        {/* Mounted at the root so the transport is available on every screen,
            including the playlist detail stack route (not just the tabs). */}
        <NowPlayingBar />
      </View>
    </SafeAreaProvider>
  );
}
