// Apple Music (MusicKit) is our audio source. Unlike Spotify, it needs no
// client-side credentials — authorization is a native system prompt tied to the
// app's bundle ID (which must have the MusicKit App Service enabled on a paid
// Apple Developer account). So there's nothing to "configure" in app.json; this
// flag exists only to keep the connection store's shape consistent.
export const MUSIC_CONFIGURED = true;
