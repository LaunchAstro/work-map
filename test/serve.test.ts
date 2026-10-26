// SPDX-License-Identifier: AGPL-3.0-only
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileFor } from '../src/cli/serve-paths.ts';
import { SyncResultSchema } from '../src/core/sync.ts';

const root = mkdtempSync(join(tmpdir(), 'work-map-serve-'));
const dist = join(root, 'dist');
const data = join(root, 'data');
mkdirSync(join(dist, 'assets'), { recursive: true });
mkdirSync(data);
writeFileSync(join(dist, 'index.html'), 'page');
writeFileSync(join(dist, 'assets', 'a.js'), 'js');
writeFileSync(join(data, 'snapshot.json'), '{}');
writeFileSync(join(data, 'versions.json'), '{}');
writeFileSync(join(data, 'maps.json'), '[]');
// Files the retired audit, scan and re-check jobs left behind.
for (const name of [
  'audit.json',
  'audits.json',
  'audit-decisions.json',
  'scan-status.json',
  'recheck-status.json',
])
  writeFileSync(join(data, name), '{}');
writeFileSync(join(data, 'github-cache.json'), '{}');
writeFileSync(join(root, 'secret.txt'), 'secret');
symlinkSync(join(root, 'secret.txt'), join(dist, 'out.txt'));
symlinkSync(join(root, 'secret.txt'), join(data, 'agents.json'));
const roots = { dist, data };

describe('the local server', () => {
  it('serves the page, its assets and the data files the page reads', () => {
    expect(fileFor('/', roots)).toMatch(/dist\/index\.html$/);
    expect(fileFor('/assets/a.js', roots)).toMatch(/a\.js$/);
    expect(fileFor('/data/snapshot.json', roots)).toMatch(/snapshot\.json$/);
    expect(fileFor('/data/versions.json', roots)).toMatch(/versions\.json$/);
    expect(fileFor('/data/maps.json', roots)).toMatch(/maps\.json$/);
  });

  it('no longer serves the retired audit, scan and re-check files', () => {
    for (const name of [
      'audit.json',
      'audits.json',
      'audit-decisions.json',
      'scan-status.json',
      'recheck-status.json',
    ])
      expect(fileFor(`/data/${name}`, roots)).toBeNull();
  });

  it('serves nothing outside them: other data files, traversal, or a symlink out', () => {
    for (const path of [
      '/data/github-cache.json',
      '/data/audit.config.json',
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/out.txt',
      '/data/agents.json',
      '/assets',
      '/missing.js',
    ])
      expect(fileFor(path, roots)).toBeNull();
  });

  it('answers a malformed path as not found instead of throwing', () => {
    expect(fileFor('/%', roots)).toBeNull();
    expect(fileFor('/%E0%A4%A', roots)).toBeNull();
  });
});

describe('the server command', () => {
  it('still takes the retired --audit-runtime option, ignores it, serves the page and answers Sync', async () => {
    const reservation = createServer();
    await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const port = address.port;
    await new Promise<void>((done) => reservation.close(() => done()));
    const child = spawn(
      process.execPath,
      [
        'src/cli/serve.ts',
        '--port',
        String(port),
        '--data',
        data,
        '--dist',
        dist,
        '--audit-runtime',
        '/nonexistent.json',
        '--audit-config',
        '/nonexistent.json',
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, WORK_MAP_PROJECT: '', WORK_MAP_ROADMAP: '' },
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    try {
      await new Promise<void>((done, fail) => {
        const timer = setTimeout(() => fail(new Error('Server did not start')), 5000);
        child.stdout.on('data', (bytes: Buffer) => {
          if (bytes.toString().includes('live roadmap')) {
            clearTimeout(timer);
            done();
          }
        });
        child.once('exit', () => {
          clearTimeout(timer);
          fail(new Error('Server exited'));
        });
      });
      const page = await fetch(`http://127.0.0.1:${port}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toBe('page');
      // With no project configured, Sync still answers with a reply the screen's schema reads.
      const reply = await fetch(`http://127.0.0.1:${port}/sync`, {
        method: 'POST',
        headers: {
          Origin: `http://127.0.0.1:${port}`,
          'X-Work-Map-Sync': '1',
          'Content-Type': 'application/json',
        },
      });
      expect(reply.status).toBe(200);
      const body: unknown = await reply.json();
      expect(SyncResultSchema.safeParse(body), JSON.stringify(body)).toMatchObject({
        success: true,
      });
    } finally {
      child.kill();
    }
  });
});
