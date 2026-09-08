import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Tracks which songs have already been played *this game* so the DJ doesn't
// repeat a song mid-game. Keyed by Apple Music song URI (the actual track), so
// the same song counts as played no matter which playlist entry launched it.
// It's persisted (a game can span an app reload) but resettable — "New game"
// clears it. This is deliberately separate from the playlist store: playlists
// are permanent data, played-state is throwaway per-game state.
interface SessionState {
  // Map of played song uri -> timestamp played (ms). A map (not a Set) so it
  // serializes cleanly through JSON persistence.
  played: Record<string, number>;
  markPlayed: (uri: string) => void;
  resetPlayed: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      played: {},

      markPlayed: (uri) => {
        if (!uri || get().played[uri]) return;
        set({ played: { ...get().played, [uri]: Date.now() } });
      },

      resetPlayed: () => set({ played: {} }),
    }),
    {
      name: 'hockeydj-session',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
