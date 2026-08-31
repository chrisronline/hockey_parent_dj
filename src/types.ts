// Core data models for Hockey Parent DJ.
// Everything is stored locally (AsyncStorage) — no backend in v1.

/** A track pulled from Apple Music plus the DJ-specific playback tweaks. */
export interface Song {
  id: string; // local uuid
  uri: string; // Apple Music catalog song ID — what we hand to the player
  title: string;
  artist: string;
  albumImageUrl?: string;
  durationMs?: number; // full track length as reported by Apple Music

  // Playback window / effects. All optional; undefined means "use natural value".
  startMs?: number; // seek here on play (default 0)
  stopMs?: number; // auto-stop here (default = end of track)
  fadeInMs?: number; // volume ramp up over this many ms (default 0 = no fade)
  fadeOutMs?: number; // volume ramp down, ending at stopMs (default 0 = no fade)
}

/** Playlist categories double as the section headers on the playlists screen. */
export type PlaylistCategory =
  | 'Warmups'
  | 'In Game'
  | 'End of Game'
  | 'Intermission'
  | 'Uncategorized';

export const PLAYLIST_CATEGORIES: PlaylistCategory[] = [
  'Warmups',
  'In Game',
  'Intermission',
  'End of Game',
  'Uncategorized',
];

export interface Playlist {
  id: string;
  name: string;
  category: PlaylistCategory;
  shuffle: boolean;
  songs: Song[]; // songs are embedded so each playlist can tune the same track differently
}

/** A roster player and the goal song assigned to them. */
export interface Player {
  id: string;
  name: string;
  number?: string; // jersey number, kept as string ("00" is valid)
  song?: Song; // their goal song; undefined until assigned
}
