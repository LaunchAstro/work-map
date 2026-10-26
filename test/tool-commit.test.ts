import { afterEach, expect, it, vi } from 'vitest';
import { watchToolCommit } from '../src/cli/tool-commit.ts';

// #204: a deploy that moves the tool commit restarts the map server.
afterEach(() => vi.useRealTimers());
it('restarts once when the commit moves, never for an unreadable commit', () => {
  vi.useFakeTimers();
  const reads = ['aaa', null, 'aaa', 'bbb', 'ccc'];
  const changes: string[] = [];
  watchToolCommit(
    () => (reads.length ? reads.shift()! : 'ccc'),
    (from, to) => changes.push(`${from}->${to}`),
    1_000,
  );
  vi.advanceTimersByTime(10_000);
  expect(changes).toEqual(['aaa->bbb']);
});
it('a server that started without a readable commit takes the first one it reads as its start', () => {
  vi.useFakeTimers();
  const reads = [null, 'aaa', 'aaa'];
  const changes: string[] = [];
  watchToolCommit(
    () => (reads.length ? reads.shift()! : 'aaa'),
    (from, to) => changes.push(`${from}->${to}`),
    1_000,
  );
  vi.advanceTimersByTime(10_000);
  expect(changes).toEqual([]);
});
