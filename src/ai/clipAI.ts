import { AI_BACKEND_URL } from '../config';
import { Song } from '../types';

// Claude recommends a high-energy start/stop window for a song from its
// knowledge of the track's structure (chorus/drop/hook). This is NOT audio
// analysis — Apple Music's DRM streams give the app no access to the raw
// samples — so treat the result as a smart starting point to fine-tune, not a
// measurement. The backend holds the Anthropic key. See server/index.js.

export type ClipSuggestion = {
  startMs: number;
  stopMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  // Short human-readable note on what the segment is (e.g. "the chorus drop").
  reason: string;
};

/**
 * Ask the backend for a suggested hype-clip window for one song. Needs the
 * track's title (artist + duration sharpen the guess but are optional).
 */
export async function suggestClip(
  song: Pick<Song, 'title' | 'artist' | 'durationMs'>
): Promise<ClipSuggestion> {
  if (!AI_BACKEND_URL) {
    throw new Error('AI backend URL is not configured (app.json → extra.aiBackendUrl).');
  }
  if (!song.title?.trim()) {
    throw new Error('This track has no title to analyze.');
  }

  const res = await fetch(`${AI_BACKEND_URL}/suggest-clip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: song.title,
      artist: song.artist,
      durationMs: song.durationMs,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Clip suggestion failed (${res.status}). ${detail}`.trim());
  }

  return (await res.json()) as ClipSuggestion;
}
