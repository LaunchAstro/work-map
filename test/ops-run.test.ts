import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';

let root: string;
let tool: string;
let behind: string;
let ahead: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

// A tool checkout one commit behind its origin, with a page already built for its own commit.
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'work-map-run-'));
  git(root, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
  tool = join(root, 'tool');
  git(root, 'clone', '-q', 'origin.git', 'tool');
  mkdirSync(join(tool, 'ops'));
  copyFileSync('ops/run.sh', join(tool, 'ops/run.sh'));
  git(tool, 'add', '.');
  git(tool, 'commit', '-q', '-m', 'one');
  git(tool, 'push', '-q', 'origin', 'HEAD:main');
  behind = git(tool, 'rev-parse', 'HEAD');
  git(root, 'clone', '-q', 'origin.git', 'other');
  writeFileSync(join(root, 'other/next.txt'), 'next');
  git(join(root, 'other'), 'add', '.');
  git(join(root, 'other'), 'commit', '-q', '-m', 'two');
  git(join(root, 'other'), 'push', '-q', 'origin', 'HEAD:main');
  ahead = git(join(root, 'other'), 'rev-parse', 'HEAD');
  mkdirSync(join(tool, 'dist'));
  writeFileSync(join(tool, 'dist/index.html'), 'page');
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data/built-commit'), `${behind}\n`);
});

const prepare = (env: Record<string, string>) =>
  spawnSync('sh', [join(tool, 'ops/run.sh'), 'prepare'], {
    encoding: 'utf8',
    env: {
      HOME: root,
      WORK_MAP_DATA: join(root, 'data'),
      WORK_MAP_NODE: process.execPath,
      WORK_MAP_PROJECT: join(root, 'project.json'),
      WORK_MAP_ROADMAP: join(root, 'no-roadmap'),
      ...env,
    },
  });

it('leaves the tool checkout where it is when self-update is off', () => {
  const run = prepare({ WORK_MAP_SELF_UPDATE: '0' });
  expect(run.status).toBe(0);
  expect(git(tool, 'rev-parse', 'HEAD')).toBe(behind);
});

it('pulls the tool checkout when self-update is unset, as existing installs expect', () => {
  prepare({});
  expect(git(tool, 'rev-parse', 'HEAD')).toBe(ahead);
});

it('pulls the tool checkout when self-update is on', () => {
  prepare({ WORK_MAP_SELF_UPDATE: '1' });
  expect(git(tool, 'rev-parse', 'HEAD')).toBe(ahead);
});
