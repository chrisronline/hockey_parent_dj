import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Player, Song } from '../types';
import { uid } from '../utils';

interface RosterState {
  players: Player[];
  addPlayer: (name: string, number?: string) => Player;
  updatePlayer: (id: string, patch: Partial<Omit<Player, 'id'>>) => void;
  removePlayer: (id: string) => void;
  assignSong: (id: string, song: Song | undefined) => void;
  /** Bulk import from pasted "Name, Number" lines. Skips blanks. */
  importRoster: (raw: string) => number;
}

/** Parse one CSV-ish line into name + optional number. */
function parseLine(line: string): { name: string; number?: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[,\t]/).map((p) => p.trim());
  // Accept "Name, 12" or "12, Name" or just "Name".
  if (parts.length >= 2) {
    const [a, b] = parts;
    if (/^\d+$/.test(a) && !/^\d+$/.test(b)) return { name: b, number: a };
    return { name: a, number: b || undefined };
  }
  return { name: parts[0] };
}

export const useRosterStore = create<RosterState>()(
  persist(
    (set, get) => ({
      players: [],

      addPlayer: (name, number) => {
        const player: Player = { id: uid(), name, number };
        set({ players: [...get().players, player] });
        return player;
      },

      updatePlayer: (id, patch) =>
        set({
          players: get().players.map((p) =>
            p.id === id ? { ...p, ...patch } : p
          ),
        }),

      removePlayer: (id) =>
        set({ players: get().players.filter((p) => p.id !== id) }),

      assignSong: (id, song) =>
        set({
          players: get().players.map((p) =>
            p.id === id ? { ...p, song } : p
          ),
        }),

      importRoster: (raw) => {
        const parsed = raw
          .split(/\r?\n/)
          .map(parseLine)
          .filter((x): x is { name: string; number?: string } => x !== null);
        const newPlayers: Player[] = parsed.map((p) => ({
          id: uid(),
          name: p.name,
          number: p.number,
        }));
        set({ players: [...get().players, ...newPlayers] });
        return newPlayers.length;
      },
    }),
    {
      name: 'hockeydj-roster',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
