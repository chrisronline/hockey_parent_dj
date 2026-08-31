import { create } from 'zustand';
import { appleMusic } from '../appleMusic/appleMusicService';
import { MUSIC_CONFIGURED } from '../config';

interface ConnectionState {
  connected: boolean;
  connecting: boolean;
  error?: string;
  configured: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  restore: () => Promise<void>;
}

// Track whether we've wired the service->store bridge so restore() only does it
// once, even if called again across remounts.
let subscribed = false;

export const useConnectionStore = create<ConnectionState>((set) => ({
  connected: false,
  connecting: false,
  error: undefined,
  configured: MUSIC_CONFIGURED,

  connect: async () => {
    set({ connecting: true, error: undefined });
    try {
      await appleMusic.connect();
      set({ connected: appleMusic.isConnected(), connecting: false });
    } catch (e: any) {
      set({
        connecting: false,
        connected: false,
        error: e?.message ?? 'Could not connect to Apple Music.',
      });
    }
  },

  disconnect: async () => {
    await appleMusic.disconnect();
    set({ connected: false });
  },

  restore: async () => {
    // Keep the UI in sync with background auth-state changes.
    if (!subscribed) {
      subscribed = true;
      appleMusic.subscribe((connected) => set({ connected }));
    }
    try {
      const ok = await appleMusic.restore();
      set({ connected: ok });
    } catch {
      set({ connected: false });
    }
  },
}));
