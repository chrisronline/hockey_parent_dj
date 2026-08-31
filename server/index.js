// Claude playlist backend for Hockey Parent DJ.
//
// Apple Music replaced Spotify, so the old token-swap endpoints are gone. This
// server now does one thing: proxy playlist-generation requests to Claude so the
// ANTHROPIC_API_KEY stays server-side and never ships in the app bundle.
//
//   POST /generate-playlist  body: { prompt, count? }  -> { name, category, songs: [{title, artist}] }
//
// The app then resolves each {title, artist} to a real Apple Music catalog track
// via its own catalog search — Claude picks the music, Apple Music makes it
// playable. Configure via env vars: ANTHROPIC_API_KEY (required),
// ANTHROPIC_MODEL (optional, defaults below).

import express from 'express';

const {
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL = 'claude-sonnet-5',
  PORT = 3000,
} = process.env;

if (!ANTHROPIC_API_KEY) {
  console.error('Missing required env var ANTHROPIC_API_KEY.');
  process.exit(1);
}

const MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages';

// Playlist categories must match the app's PlaylistCategory union.
const CATEGORIES = [
  'Warmups',
  'In Game',
  'Intermission',
  'End of Game',
  'Uncategorized',
];

// Force structured output: Claude must call this tool, so we always get back a
// clean {name, category, songs} object instead of prose we'd have to parse.
const PLAYLIST_TOOL = {
  name: 'build_playlist',
  description:
    'Return a hockey-game playlist as structured data. Every song must be a real, ' +
    'widely-available commercial track (title + primary artist) so it can be found ' +
    'on Apple Music.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'A short, punchy playlist name fitting the request.',
      },
      category: {
        type: 'string',
        enum: CATEGORIES,
        description: 'The best-fitting category for this playlist.',
      },
      songs: {
        type: 'array',
        description: 'The tracks, in a sensible play order.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            artist: { type: 'string', description: 'Primary performing artist.' },
          },
          required: ['title', 'artist'],
        },
      },
    },
    required: ['name', 'category', 'songs'],
  },
};

const SYSTEM_PROMPT =
  'You are a music curator for youth and beer-league hockey games. Given a ' +
  'request, build a playlist of real, well-known songs that are available on ' +
  'Apple Music. Prefer high-energy, crowd-pleasing tracks appropriate to the ' +
  'moment (warmups, in-game hype, intermission, celebrating a win). Keep lyrics ' +
  'clean and family-friendly unless the user explicitly asks otherwise — this ' +
  'plays over a rink PA with kids present. Use the primary artist for each song. ' +
  'Always respond by calling the build_playlist tool.';

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.type('text/plain').send('Hockey Parent DJ playlist server is running.');
});

app.post('/generate-playlist', async (req, res) => {
  const prompt = (req.body?.prompt ?? '').toString().trim();
  if (!prompt) return res.status(400).json({ error: 'missing_prompt' });

  // Clamp the requested size so a bad value can't ask Claude for 10,000 songs.
  const rawCount = Number(req.body?.count);
  const count = Number.isFinite(rawCount)
    ? Math.min(40, Math.max(1, Math.round(rawCount)))
    : 15;

  try {
    const anthropicRes = await fetch(MESSAGES_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [PLAYLIST_TOOL],
        tool_choice: { type: 'tool', name: 'build_playlist' },
        messages: [
          {
            role: 'user',
            content: `Build a hockey playlist of about ${count} songs for this request:\n\n${prompt}`,
          },
        ],
      }),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      console.error(
        `Anthropic error status=${anthropicRes.status} body=${JSON.stringify(data)}`
      );
      return res
        .status(502)
        .json({ error: 'anthropic_error', detail: data?.error?.message });
    }

    // Pull the forced tool call out of the response content blocks.
    const toolUse = (data?.content ?? []).find(
      (block) => block.type === 'tool_use' && block.name === 'build_playlist'
    );
    if (!toolUse?.input) {
      console.error('No tool_use block in Anthropic response:', JSON.stringify(data));
      return res.status(502).json({ error: 'no_playlist_returned' });
    }

    const { name, category, songs } = toolUse.input;
    res.json({
      name: typeof name === 'string' && name.trim() ? name.trim() : 'AI Playlist',
      category: CATEGORIES.includes(category) ? category : 'Uncategorized',
      songs: Array.isArray(songs)
        ? songs
            .filter((s) => s && s.title)
            .map((s) => ({
              title: String(s.title),
              artist: s.artist ? String(s.artist) : '',
            }))
        : [],
    });
  } catch (err) {
    console.error('Playlist generation failed:', err);
    res.status(502).json({ error: 'generation_failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Playlist server listening on port ${PORT} (model ${ANTHROPIC_MODEL})`);
});
