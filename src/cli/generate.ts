// SPDX-License-Identifier: AGPL-3.0-only
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const app = fileURLToPath(new URL('../..', import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: 'string', default: join(app, '.data') },
    round: { type: 'string' },
    floor: { type: 'string' },
    'repo-root': { type: 'string' },
    project: { type: 'string' },
    sync: { type: 'boolean', default: false },
    full: { type: 'boolean', default: false },
  },
});
const mode = positionals[0];
if (positionals.length !== 1 || !['github', 'agents', 'snapshot'].includes(mode ?? ''))
  throw new Error('Expected github, agents or snapshot');
if ((values.sync || values.full) && mode !== 'github')
  throw new Error('--sync and --full apply to the github collector');
const data = resolve(values.data);
mkdirSync(data, { recursive: true });
const lock = join(app, 'ops/hold-lock.pl');
const lockWaitSeconds = '120';
const child = spawn(
  'perl',
  [
    lock,
    join(data, 'checkout.lockf'),
    lockWaitSeconds,
    '--shared',
    'perl',
    lock,
    join(data, mode === 'agents' ? 'agents.lockf' : 'snapshot.lockf'),
    lockWaitSeconds,
    process.execPath,
    join(app, 'src/cli/generate-run.ts'),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
