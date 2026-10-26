import { execFileSync } from 'node:child_process';

/** The tool checkout's commit, or null when git cannot say. */
export function toolCommit(app: string): string | null {
  try {
    return execFileSync('git', ['-C', app, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Calls `onChange` once when the tool's commit moves from the one it started on (#204), so a deploy that
 * pulls new code restarts the server under its keep-alive job instead of leaving old checks running.
 * An unreadable commit is never a change. Returns a stop function.
 */
export function watchToolCommit(
  read: () => string | null,
  onChange: (from: string, to: string) => void,
  everyMs: number = 30_000,
): () => void {
  let start = read();
  const timer = setInterval(() => {
    const now = read();
    if (now === null) return;
    if (start === null) start = now;
    else if (now !== start) {
      clearInterval(timer);
      onChange(start, now);
    }
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
