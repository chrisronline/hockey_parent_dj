import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Playlist, PlaylistCategory, Song } from '../types';
import { uid } from '../utils';

interface PlaylistState {
  playlists: Playlist[];
  addPlaylist: (name: string, category: PlaylistCategory) => Playlist;
  updatePlaylist: (id: string, patch: Partial<Omit<Playlist, 'id'>>) => void;
  removePlaylist: (id: string) => void;

  addSong: (playlistId: string, song: Omit<Song, 'id'>) => void;
  updateSong: (playlistId: string, songId: string, patch: Partial<Song>) => void;
  removeSong: (playlistId: string, songId: string) => void;
  reorderSongs: (playlistId: string, songs: Song[]) => void;
}

export const usePlaylistStore = create<PlaylistState>()(
  persist(
    (set, get) => ({
      playlists: [],

      addPlaylist: (name, category) => {
        const playlist: Playlist = {
          id: uid(),
          name,
          category,
          shuffle: false,
          songs: [],
        };
        set({ playlists: [...get().playlists, playlist] });
        return playlist;
      },

      updatePlaylist: (id, patch) =>
        set({
          playlists: get().playlists.map((p) =>
            p.id === id ? { ...p, ...patch } : p
          ),
        }),

      removePlaylist: (id) =>
        set({ playlists: get().playlists.filter((p) => p.id !== id) }),

      addSong: (playlistId, song) =>
        set({
          playlists: get().playlists.map((p) =>
            p.id === playlistId
              ? { ...p, songs: [...p.songs, { ...song, id: uid() }] }
              : p
          ),
        }),

      updateSong: (playlistId, songId, patch) =>
        set({
          playlists: get().playlists.map((p) =>
            p.id === playlistId
              ? {
                  ...p,
                  songs: p.songs.map((s) =>
                    s.id === songId ? { ...s, ...patch } : s
                  ),
                }
              : p
          ),
        }),

      removeSong: (playlistId, songId) =>
        set({
          playlists: get().playlists.map((p) =>
            p.id === playlistId
              ? { ...p, songs: p.songs.filter((s) => s.id !== songId) }
              : p
          ),
        }),

      reorderSongs: (playlistId, songs) =>
        set({
          playlists: get().playlists.map((p) =>
            p.id === playlistId ? { ...p, songs } : p
          ),
        }),
    }),
    {
      name: 'hockeydj-playlists',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
