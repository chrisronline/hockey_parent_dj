import { AI_BACKEND_URL } from '../config';
import { appleMusic } from '../appleMusic/appleMusicService';
import { suggestClip } from './clipAI';
import { PLAYLIST_CATEGORIES, PlaylistCategory, Song } from '../types';
import { mapPool, retry } from '../utils';

// Claude picks the music (song titles + artists); Apple Music turns each pick
// into a playable catalog track. The backend holds the Anthropic key so nothing
// secret lives in the app. See server/index.js.

type SuggestedSong = { title: string; artist: string };

type BackendResponse = {
  name: string;
  category: string;
  songs: SuggestedSong[];
};

export type GeneratedPlaylist = {
  name: string;
  category: PlaylistCategory;
  // Resolved, playable tracks ready to hand to addSong (no local id yet).
  songs: Omit<Song, 'id'>[];
  // Human-readable "Title — Artist" for picks we couldn't find on Apple Music,
  // so the UI can tell the user what got dropped instead of silently losing them.
  unmatched: string[];
};

/**
 * Ask the backend for a playlist, then resolve each suggested song to a real
 * Apple Music track via catalog search. Requires an active Apple Music
 * connection (the search step uses it).
 */
export async function generatePlaylist(
  prompt: string,
  count = 30,
  category?: PlaylistCategory
): Promise<GeneratedPlaylist> {
  if (!AI_BACKEND_URL) {
    throw new Error('AI backend URL is not configured (app.json → extra.aiBackendUrl).');
  }
  if (!appleMusic.isConnected()) {
    throw new Error('Connect to Apple Music first so songs can be found.');
  }

  const res = await fetch(`${AI_BACKEND_URL}/generate-playlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, count }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Playlist generation failed (${res.status}). ${detail}`.trim());
  }

  const data = (await res.json()) as BackendResponse;
  const suggestions = data.songs ?? [];

  // Resolve suggestions concurrently. Take the top catalog match for each; keep
  // Apple Music's own title/artist/art since those are what actually play.
  const resolved = await Promise.all(
    suggestions.map(async (s) => {
      const query = `${s.title} ${s.artist}`.trim();
      try {
        const matches = await appleMusic.searchTracks(query);
        return { suggestion: s, track: matches[0] };
      } catch {
        return { suggestion: s, track: undefined };
      }
    })
  );

  const songs: Omit<Song, 'id'>[] = [];
  const unmatched: string[] = [];
  for (const { suggestion, track } of resolved) {
    if (track) {
      songs.push({
        uri: track.uri,
        title: track.title,
        artist: track.artist,
        albumImageUrl: track.albumImageUrl,
        durationMs: track.durationMs,
      });
    } else {
      unmatched.push(
        `${suggestion.title}${suggestion.artist ? ` — ${suggestion.artist}` : ''}`
      );
    }
  }

  // Warmup songs are meant to play long, so we skip auto-clipping them — they
  // keep their natural full length. Every other category gets an AI-suggested
  // hype-clip window so the playlist is game-ready without hand-editing.
  const skipClips = category === 'Warmups';

  // Enrich each matched track with a clip window. Run a few at a time with
  // retries rather than all at once — a large playlist would otherwise blow past
  // the backend's rate limit and lose most suggestions. A failed suggestion just
  // leaves that song at its natural full length.
  const clipped = skipClips
    ? songs
    : await mapPool(songs, 4, async (s) => {
        try {
          const clip = await retry(() => suggestClip(s));
          return {
            ...s,
            startMs: clip.startMs,
            stopMs: clip.stopMs,
            fadeInMs: clip.fadeInMs,
            fadeOutMs: clip.fadeOutMs,
          };
        } catch {
          return s;
        }
      });

  // Prefer the category the user picked; fall back to Claude's guess, then Uncategorized.
  const resolvedCategory: PlaylistCategory =
    category ??
    (PLAYLIST_CATEGORIES.includes(data.category as PlaylistCategory)
      ? (data.category as PlaylistCategory)
      : 'Uncategorized');

  return {
    name: data.name?.trim() || 'AI Playlist',
    category: resolvedCategory,
    songs: clipped,
    unmatched,
  };
}
