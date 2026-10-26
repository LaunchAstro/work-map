import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';

// Stubs for `open` and `osascript` that record their calls; osascript finds Chrome when CHROME=1. They are
// written once: macOS checks a new executable on its first run, which can take seconds on a busy machine.
const bin = mkdtempSync(join(tmpdir(), 'work-map-open-'));
const calls = join(bin, 'calls');
beforeAll(() => {
  writeFileSync(join(bin, 'open'), `#!/bin/sh\necho "open $*" >> '${calls}'\n`, { mode: 0o755 });
  writeFileSync(
    join(bin, 'osascript'),
    `#!/bin/sh\necho "osascript $*" >> '${calls}'\n[ "$CHROME" = 1 ]\n`,
    { mode: 0o755 },
  );
});

function openWindow(chrome: boolean): string[] {
  rmSync(calls, { force: true });
  const run = spawnSync('sh', ['ops/open-window.sh'], {
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, WORK_MAP_PORT: '4999', CHROME: chrome ? '1' : '0' },
  });
  expect(run.status, run.stderr).toBe(0);
  return readFileSync(calls, 'utf8').trim().split('\n');
}

it('opens the map in a Chrome app window without revealing Chrome in the Finder', () => {
  expect(openWindow(true).filter((call) => call.startsWith('open '))).toEqual([
    'open -na Google Chrome --args --app=http://127.0.0.1:4999/ --window-size=1600,1000',
  ]);
}, 20_000);

it('opens the map in the default browser when Chrome is not installed', () => {
  expect(openWindow(false).filter((call) => call.startsWith('open '))).toEqual([
    'open http://127.0.0.1:4999/',
  ]);
}, 20_000);
