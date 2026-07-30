import { create } from 'zustand';
import { spotify } from '../spotify/spotifyService';
import { SPOTIFY_CONFIGURED } from '../config';

interface ConnectionState {
  connected: boolean;
  connecting: boolean;
  error?: string;
  configured: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  restore: () => Promise<void>;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connected: false,
  connecting: false,
  error: undefined,
  configured: SPOTIFY_CONFIGURED,

  connect: async () => {
    if (!SPOTIFY_CONFIGURED) {
      set({ error: 'Add your Spotify Client ID in app.json first.' });
      return;
    }
    set({ connecting: true, error: undefined });
    try {
      await spotify.connect();
      set({ connected: spotify.isConnected(), connecting: false });
    } catch (e: any) {
      set({
        connecting: false,
        connected: false,
        error: e?.message ?? 'Could not connect to Spotify.',
      });
    }
  },

  disconnect: async () => {
    await spotify.disconnect();
    set({ connected: false });
  },

  restore: async () => {
    if (!SPOTIFY_CONFIGURED) return;
    try {
      const ok = await spotify.restore();
      set({ connected: ok });
    } catch {
      set({ connected: false });
    }
  },
}));
