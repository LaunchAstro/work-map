// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { usePoll } from '../src/web/usePoll.ts';

interface Board {
  name: string;
}
const parseBoard = (value: unknown): Board | null =>
  typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string'
    ? { name: value.name }
    : null;

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function pollingHarness(retainPrevious = false) {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const requests: { url: string; resolve: (response: Response) => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => new Promise<Response>((resolve) => requests.push({ url, resolve }))),
  );
  let poll!: ReturnType<typeof usePoll<Board>>;
  function Harness({ url }: { url: string }) {
    poll = usePoll(url, 60_000, parseBoard, retainPrevious);
    return null;
  }
  root = createRoot(document.createElement('div'));
  async function visit(url: string) {
    await act(async () => root!.render(<Harness url={url} />));
  }
  async function answer(index: number, name: string, status = 200) {
    await act(async () => {
      requests[index]!.resolve(new Response(JSON.stringify({ name }), { status }));
    });
  }
  await visit('/m/alpha/data/snapshot.json');
  return {
    requests,
    visit,
    answer,
    get poll() {
      return poll;
    },
  };
}

it('a completed refresh from the first Alpha visit cannot overwrite a later Alpha visit', async () => {
  const harness = await pollingHarness();
  await harness.answer(0, 'Alpha first');
  const firstAlphaRefresh = harness.poll.refresh;
  let oldRefresh!: Promise<Board>;
  await act(async () => {
    oldRefresh = firstAlphaRefresh();
  });
  await harness.visit('/m/beta/data/snapshot.json');
  await harness.answer(2, 'Beta');
  await harness.visit('/m/alpha/data/snapshot.json');
  await harness.answer(3, 'Alpha new visit');
  expect(harness.poll.current).toBe(true);
  await harness.answer(1, 'Alpha obsolete result');
  await oldRefresh;
  expect(harness.poll.data).toEqual({ name: 'Alpha new visit' });
  expect(harness.poll.current).toBe(true);

  // A saved callback invoked after returning to Alpha is still owned by the first visit.
  await act(async () => {
    oldRefresh = firstAlphaRefresh();
  });
  await harness.answer(4, 'Alpha saved callback');
  await oldRefresh;
  expect(harness.poll.data).toEqual({ name: 'Alpha new visit' });
});

it('an optional poll clears the previous map while the new map is loading and after it fails', async () => {
  const harness = await pollingHarness();
  await harness.answer(0, 'Alpha optional data');
  await harness.visit('/m/beta/data/snapshot.json');
  expect(harness.poll.data).toBeNull();
  expect(harness.poll.current).toBe(false);
  await harness.answer(1, 'unavailable', 503);
  expect(harness.poll.data).toBeNull();
  expect(harness.poll.failed).not.toBeNull();
  expect(harness.poll.current).toBe(false);
});

it('a snapshot poll retains the previous board without marking it current until the new map resolves', async () => {
  const harness = await pollingHarness(true);
  await harness.answer(0, 'Alpha board');
  await harness.visit('/m/beta/data/snapshot.json');
  expect(harness.poll.data).toEqual({ name: 'Alpha board' });
  expect(harness.poll.current).toBe(false);
  await harness.answer(1, 'Beta board');
  expect(harness.poll.data).toEqual({ name: 'Beta board' });
  expect(harness.poll.current).toBe(true);
});

it('a retained poll names the address its shown data came from, even after the new address fails (#184)', async () => {
  const harness = await pollingHarness(true);
  await harness.answer(0, 'Alpha board');
  expect(harness.poll.source).toBe('/m/alpha/data/snapshot.json');
  await harness.visit('/m/beta/data/snapshot.json');
  await harness.answer(1, 'unavailable', 503);
  expect(harness.poll.data).toEqual({ name: 'Alpha board' });
  expect(harness.poll.source).toBe('/m/alpha/data/snapshot.json');
  await act(async () => void harness.poll.refresh().catch(() => {}));
  await harness.answer(2, 'Beta board');
  expect(harness.poll.source).toBe('/m/beta/data/snapshot.json');
});
