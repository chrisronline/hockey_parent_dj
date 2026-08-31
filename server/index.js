// Claude playlist backend for Hockey Parent DJ.
//
// Apple Music replaced Spotify, so the old token-swap endpoints are gone. This
// server now does one thing: proxy playlist-generation requests to Claude so the
// ANTHROPIC_API_KEY stays server-side and never ships in the app bundle.
//
//   POST /generate-playlist  body: { prompt, count? }  -> { name, category, songs: [{title, artist}] }
//   POST /suggest-clip        body: { title, artist?, durationMs? } -> { startMs, stopMs, fadeInMs, fadeOutMs, reason }
//
// The app then resolves each {title, artist} to a real Apple Music catalog track
// via its own catalog search — Claude picks the music, Apple Music makes it
// playable. /suggest-clip uses Claude's knowledge of a song's structure to
// recommend a high-energy start/stop window (not audio analysis — Apple Music's
// DRM streams give us no access to the raw samples). Configure via env vars:
// ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional, defaults below).

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

// Force structured output for clip suggestions too. Times are in seconds; the
// app converts to ms and clamps to the track duration.
const CLIP_TOOL = {
  name: 'suggest_clip',
  description:
    'Recommend the single most exciting segment of a song to use as a short ' +
    'hockey hype/goal clip (roughly 15-30 seconds).',
  input_schema: {
    type: 'object',
    properties: {
      startSeconds: {
        type: 'number',
        description:
          'Where the clip should start, in seconds from the beginning of the track.',
      },
      stopSeconds: {
        type: 'number',
        description:
          'Where the clip should stop, in seconds. Must be after startSeconds, ' +
          'ideally 15-30 seconds later.',
      },
      fadeInSeconds: {
        type: 'number',
        description: 'Short fade-in in seconds (0-2) so the clip does not start abruptly.',
      },
      fadeOutSeconds: {
        type: 'number',
        description: 'Short fade-out in seconds (0-2) so the clip does not cut off harshly.',
      },
      reason: {
        type: 'string',
        description:
          'One short sentence naming what happens at that point (e.g. "the chorus drop").',
      },
    },
    required: ['startSeconds', 'stopSeconds', 'fadeInSeconds', 'fadeOutSeconds', 'reason'],
  },
};

const CLIP_SYSTEM_PROMPT =
  'You help a hockey DJ pick the single most exciting 15-30 second segment of a ' +
  'song to blast after a goal or during warmups. Using your knowledge of the ' +
  "song's structure, identify its peak-energy moment — the main chorus, the drop, " +
  'or the signature hook — and return a start and stop time that captures it. ' +
  'The clip should hit hard immediately and be roughly 15-30 seconds long. If you ' +
  'are unsure of the exact structure, make your best estimate (choruses often ' +
  'first land 20-35% of the way into a track). Always respond by calling the ' +
  'suggest_clip tool.';

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

app.post('/suggest-clip', async (req, res) => {
  const title = (req.body?.title ?? '').toString().trim();
  const artist = (req.body?.artist ?? '').toString().trim();
  if (!title) return res.status(400).json({ error: 'missing_title' });

  // Duration lets us clamp the suggestion so it can't fall past the end of the
  // track. It's optional — the model can still guess without it.
  const rawDuration = Number(req.body?.durationMs);
  const durationMs =
    Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : undefined;
  const durationLine =
    durationMs != null
      ? `The track is ${(durationMs / 1000).toFixed(0)} seconds long.`
      : 'The exact track length is unknown.';

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
        max_tokens: 512,
        system: CLIP_SYSTEM_PROMPT,
        tools: [CLIP_TOOL],
        tool_choice: { type: 'tool', name: 'suggest_clip' },
        messages: [
          {
            role: 'user',
            content:
              `Suggest the best hype-clip segment for "${title}"` +
              (artist ? ` by ${artist}` : '') +
              `. ${durationLine}`,
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

    const toolUse = (data?.content ?? []).find(
      (block) => block.type === 'tool_use' && block.name === 'suggest_clip'
    );
    if (!toolUse?.input) {
      console.error('No tool_use block in clip response:', JSON.stringify(data));
      return res.status(502).json({ error: 'no_clip_returned' });
    }

    const inp = toolUse.input;
    const toMs = (sec, fallback) => {
      const n = Number(sec);
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : fallback;
    };

    let startMs = toMs(inp.startSeconds, 0);
    let stopMs = toMs(inp.stopSeconds, startMs + 20000);
    const fadeInMs = Math.min(toMs(inp.fadeInSeconds, 0), 5000);
    const fadeOutMs = Math.min(toMs(inp.fadeOutSeconds, 0), 5000);

    // Clamp to a sane window inside the track so a bad guess can't produce an
    // empty or out-of-bounds clip.
    if (durationMs != null) {
      startMs = Math.max(0, Math.min(startMs, Math.max(0, durationMs - 5000)));
      stopMs = Math.min(stopMs, durationMs);
    }
    if (stopMs <= startMs) stopMs = startMs + 20000;

    res.json({
      startMs,
      stopMs,
      fadeInMs,
      fadeOutMs,
      reason: typeof inp.reason === 'string' ? inp.reason.trim() : '',
    });
  } catch (err) {
    console.error('Clip suggestion failed:', err);
    res.status(502).json({ error: 'suggestion_failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Playlist server listening on port ${PORT} (model ${ANTHROPIC_MODEL})`);
});
