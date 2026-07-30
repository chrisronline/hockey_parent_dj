import { useEffect, useState } from 'react';
import { playback, PlaybackStatus } from './playbackEngine';

/** Subscribe a component to the playback engine's status. */
export function usePlayback(): PlaybackStatus {
  const [status, setStatus] = useState<PlaybackStatus>(playback.getStatus());
  useEffect(() => playback.subscribe(setStatus), []);
  return status;
}
