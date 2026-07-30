// The App Remote SDK can't search the Spotify catalog, so v1 accepts a track
// pasted as either a URI (spotify:track:ID) or a share link
// (https://open.spotify.com/track/ID?si=...). Both normalize to a track URI.
export function parseTrackUri(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  const uriMatch = s.match(/spotify:track:([A-Za-z0-9]+)/);
  if (uriMatch) return `spotify:track:${uriMatch[1]}`;

  const linkMatch = s.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
  if (linkMatch) return `spotify:track:${linkMatch[1]}`;

  // Bare 22-char base62 id.
  if (/^[A-Za-z0-9]{22}$/.test(s)) return `spotify:track:${s}`;

  return null;
}
