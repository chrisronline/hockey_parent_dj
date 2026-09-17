import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Song } from '../types';

/**
 * Where an intermission playlist left off. Between intermissions you'll play
 * goal songs and other lists, so the playback engine's "current" state gets
 * clobbered constantly — this remembers the last spot that was actually playing
 * *from an intermission playlist* so you can pick it back up next intermission.
 * Keyed per playlist so multiple intermission lists each keep their own spot.
 */
export interface IntermissionResume {
  playlistId: string;
  queue: Song[]; // the exact (possibly shuffled) order that was playing
  index: number; // position of the song within that queue
  positionMs: number; // absolute seek point within the song
  songTitle: string; // for the button label ("Resume — Song (2:14)")
  savedAt: number;
}

interface IntermissionState {
  // playlistId -> resume point
  resumes: Record<string, IntermissionResume>;
  saveResume: (point: IntermissionResume) => void;
  clearResume: (playlistId: string) => void;
}

export const useIntermissionStore = create<IntermissionState>()(
  persist(
    (set, get) => ({
      resumes: {},

      saveResume: (point) =>
        set({ resumes: { ...get().resumes, [point.playlistId]: point } }),

      clearResume: (playlistId) => {
        const next = { ...get().resumes };
        delete next[playlistId];
        set({ resumes: next });
      },
    }),
    {
      name: 'hockeydj-intermission',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
