import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

async function freePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  await new Promise<void>((done) => reservation.close(() => done()));
  return address.port;
}

it('serves on WORK_MAP_PORT when no --port is given', async () => {
  const root = mkdtempSync(join(tmpdir(), 'work-map-port-'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/index.html'), 'page');
  const port = await freePort();
  const child = spawn(
    process.execPath,
    ['src/cli/serve.ts', '--data', root, '--dist', join(root, 'dist')],
    {
      env: {
        ...process.env,
        WORK_MAP_PORT: String(port),
        WORK_MAP_PROJECT: '',
        WORK_MAP_ROADMAP: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    const line = await new Promise<string>((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Server did not start')), 5000);
      child.stdout.on('data', (bytes: Buffer) => {
        clearTimeout(timer);
        done(bytes.toString());
      });
      child.once('exit', () => {
        clearTimeout(timer);
        fail(new Error('Server exited'));
      });
    });
    expect(line).toContain(`http://127.0.0.1:${port}`);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(await page.text()).toBe('page');
  } finally {
    child.kill();
  }
});
