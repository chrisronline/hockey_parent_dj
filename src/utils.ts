/** Cheap unique id — good enough for local records, no crypto dependency. */
export function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

/** Fisher–Yates shuffle returning a new array. */
export function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Retry an async op with exponential backoff. Meant for flaky network calls
 * (rate limits, transient 5xx) — a bad request that always fails just burns the
 * attempts and rethrows the last error. Defaults: 4 tries, 500ms → 1s → 2s.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  attempts = 4,
  baseDelayMs = 500
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
      }
    }
  }
  throw lastErr;
}

/**
 * Run `task` over `items` with at most `limit` in flight at once, preserving
 * input order in the results. Unlike `Promise.all(items.map(task))`, this won't
 * fire hundreds of requests simultaneously — essential for a rate-limited
 * backend, where a big burst gets most requests throttled and dropped. `task`
 * should handle its own errors (return a sentinel) so one failure doesn't abort
 * the pool. `onProgress` fires as each item settles.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const total = items.length;
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      results[i] = await task(items[i], i);
      done += 1;
      onProgress?.(done, total);
    }
  };

  const workers = Array.from({ length: Math.min(limit, total) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Format milliseconds as m:ss for display. */
export function formatMs(ms?: number): string {
  if (ms == null) return '--:--';
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
