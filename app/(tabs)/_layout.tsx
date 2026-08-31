import React from 'react';
import { ColorValue, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { theme } from '../../src/theme';

// Emoji tab icons keep us dependency-free and read fine at a glance on the bench.
function Icon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 22, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ flex: 1 }}>
        <Tabs
          screenOptions={{
            headerStyle: { backgroundColor: theme.colors.bg },
            headerTintColor: theme.colors.text,
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: '800', fontSize: 20 },
            sceneStyle: { backgroundColor: theme.colors.bg },
            tabBarStyle: {
              backgroundColor: theme.colors.card,
              borderTopColor: theme.colors.border,
            },
            tabBarActiveTintColor: theme.colors.primary,
            tabBarInactiveTintColor: theme.colors.textMuted,
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Goal Board',
              tabBarIcon: ({ color }) => <Icon glyph="🥅" color={color} />,
            }}
          />
          <Tabs.Screen
            name="playlists"
            options={{
              title: 'Playlists',
              tabBarIcon: ({ color }) => <Icon glyph="🎵" color={color} />,
            }}
          />
          <Tabs.Screen
            name="roster"
            options={{
              title: 'Roster',
              tabBarIcon: ({ color }) => <Icon glyph="👥" color={color} />,
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: 'Settings',
              tabBarIcon: ({ color }) => <Icon glyph="⚙️" color={color} />,
            }}
          />
        </Tabs>
      </View>
    </View>
  );
}
