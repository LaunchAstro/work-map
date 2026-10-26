import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';

let home: string;
let project: string;
let roadmap: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'work-map-install-'));
  roadmap = join(home, 'roadmap');
  mkdirSync(roadmap);
  project = join(roadmap, 'project.json');
  writeFileSync(project, JSON.stringify({ id: 'demo' }));
});

function install(
  args: string[],
  settings: Record<string, string> = {},
  env: Record<string, string> = {},
) {
  const config = join(home, 'work-map.conf');
  writeFileSync(
    config,
    Object.entries({
      WORK_MAP_PROJECT: project,
      WORK_MAP_ROADMAP: roadmap,
      WORK_MAP_NODE: process.execPath,
      ...settings,
    })
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
  return spawnSync('sh', ['ops/install.sh', '--config', config, '--no-launchd', ...args], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'], HOME: home, ...env },
  });
}

// The flat plist ops/install.sh writes: each <key> followed by a <string> or <integer>.
function plist(label: string): Map<string, string> {
  const text = readFileSync(join(home, 'Library/LaunchAgents', `${label}.plist`), 'utf8');
  return new Map(
    [...text.matchAll(/<key>([^<]+)<\/key><(?:string|integer)>([^<]*)</g)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  );
}

const agents = () => readdirSync(join(home, 'Library/LaunchAgents')).toSorted();

it('installs one map with neutral names and self-update off by default', () => {
  const run = install(['--no-build']);
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  expect(agents()).toEqual([
    'local.work-map.demo.agents.plist',
    'local.work-map.demo.github.plist',
    'local.work-map.demo.serve.plist',
  ]);
  const serve = plist('local.work-map.demo.serve');
  expect(serve.get('Label')).toBe('local.work-map.demo.serve');
  expect(serve.get('WORK_MAP_PORT')).toBe('4317');
  expect(serve.get('WORK_MAP_DATA')).toBe(join(home, '.local/share/work-map/demo'));
  expect(serve.get('WORK_MAP_SELF_UPDATE')).toBe('0');
  expect(serve.get('WORK_MAP_PROJECT')).toBe(project);
  expect(plist('local.work-map.demo.github').get('StartInterval')).toBe('300');
  expect(plist('local.work-map.demo.agents').get('StartInterval')).toBe('45');
  // --no-launchd prints what it would run and runs none of it.
  expect(run.stdout).toContain(
    `launchctl bootstrap gui/${process.getuid!()} ${join(home, 'Library/LaunchAgents/local.work-map.demo.serve.plist')}`,
  );
});

it('takes the label prefix, port, data folder and self-update from the config', () => {
  const run = install(['--no-build'], {
    WORK_MAP_LABEL: 'com.example.map',
    WORK_MAP_PORT: '4400',
    WORK_MAP_DATA: '~/maps/demo-data',
    WORK_MAP_SELF_UPDATE: '1',
  });
  expect(run.status).toBe(0);
  const github = plist('com.example.map.github');
  expect(github.get('WORK_MAP_PORT')).toBe('4400');
  expect(github.get('WORK_MAP_DATA')).toBe(join(home, 'maps/demo-data'));
  expect(github.get('WORK_MAP_SELF_UPDATE')).toBe('1');
  expect(existsSync(join(home, 'maps/demo-data'))).toBe(true);
});

it('passes a round-log folder to the jobs only when one is set', () => {
  expect(install(['--no-build']).status).toBe(0);
  expect(plist('local.work-map.demo.agents').has('WORK_MAP_ROUND_ROOT')).toBe(false);
  mkdirSync(join(home, 'rounds'));
  expect(install(['--no-build'], { WORK_MAP_ROUND_ROOT: '~/rounds' }).status).toBe(0);
  expect(plist('local.work-map.demo.agents').get('WORK_MAP_ROUND_ROOT')).toBe(join(home, 'rounds'));
});

it('takes the round-log folder from OA_ROUND_ROOT, the older name, when WORK_MAP_ROUND_ROOT is unset, and says so', () => {
  mkdirSync(join(home, 'rounds'));
  const old = install(['--no-build'], {}, { OA_ROUND_ROOT: '~/rounds' });
  expect(old.status).toBe(0);
  expect(old.stderr).toMatch(/OA_ROUND_ROOT.*WORK_MAP_ROUND_ROOT/);
  expect(plist('local.work-map.demo.agents').get('WORK_MAP_ROUND_ROOT')).toBe(join(home, 'rounds'));
  mkdirSync(join(home, 'named'));
  const both = install(
    ['--no-build'],
    { WORK_MAP_ROUND_ROOT: '~/named' },
    { OA_ROUND_ROOT: '~/rounds' },
  );
  expect(both.stderr).toBe('');
  expect(plist('local.work-map.demo.agents').get('WORK_MAP_ROUND_ROOT')).toBe(join(home, 'named'));
});

it('refuses an OA_ROUND_ROOT that is not a folder, by that name, before writing anything', () => {
  const run = install(['--no-build'], {}, { OA_ROUND_ROOT: '/nonexistent/rounds' });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toMatch(/OA_ROUND_ROOT '\/nonexistent\/rounds' is not a folder/);
  expect(existsSync(join(home, 'Library/LaunchAgents'))).toBe(false);
});

it('reads the config as text and never runs it', () => {
  const run = install(['--no-build'], { WORK_MAP_DATA: `${home}/d$(touch ${home}/ran)` });
  expect(run.status).toBe(0);
  expect(existsSync(join(home, 'ran'))).toBe(false);
  expect(plist('local.work-map.demo.serve').get('WORK_MAP_DATA')).toBe(
    `${home}/d$(touch ${home}/ran)`,
  );
});

it('escapes a path with XML characters in the job files', () => {
  const data = `${home}/a&b <c> "d"`;
  expect(install(['--no-build'], { WORK_MAP_DATA: data }).status).toBe(0);
  const text = readFileSync(
    join(home, 'Library/LaunchAgents/local.work-map.demo.serve.plist'),
    'utf8',
  );
  expect(text).toContain('a&amp;b &lt;c&gt; &quot;d&quot;');
  expect(existsSync(data)).toBe(true);
});

it('refuses an indented or misspelt key rather than skipping it', () => {
  const config = join(home, 'bad.conf');
  writeFileSync(
    config,
    `WORK_MAP_PROJECT=${project}\nWORK_MAP_ROADMAP=${roadmap}\n  WORK_MAP_PORT=4400\n`,
  );
  const run = spawnSync(
    'sh',
    ['ops/install.sh', '--config', config, '--no-launchd', '--no-build'],
    {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'], HOME: home, WORK_MAP_NODE: process.execPath },
    },
  );
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain('WORK_MAP_PORT=4400');
  expect(existsSync(join(home, 'Library/LaunchAgents'))).toBe(false);
});

it('refuses a setting from the environment that spans lines', () => {
  const config = join(home, 'env.conf');
  writeFileSync(config, `WORK_MAP_PROJECT=${project}\nWORK_MAP_ROADMAP=${roadmap}\n`);
  for (const [name, value] of [
    ['WORK_MAP_LABEL', 'safe\nbad label'],
    ['WORK_MAP_DATA', `${home}/data\n${home}/other`],
  ]) {
    const run = spawnSync(
      'sh',
      ['ops/install.sh', '--config', config, '--no-launchd', '--no-build'],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env['PATH'],
          HOME: home,
          WORK_MAP_NODE: process.execPath,
          [name!]: value,
        },
      },
    );
    expect(run.status, name).not.toBe(0);
    expect(run.stderr).toContain(name);
    expect(existsSync(join(home, 'Library/LaunchAgents'))).toBe(false);
  }
});

it.each([
  [{ WORK_MAP_PORT: '80' }, /port/i],
  [{ WORK_MAP_PORT: '4317x' }, /port/i],
  [{ WORK_MAP_LABEL: 'my map' }, /label/i],
  [{ WORK_MAP_SELF_UPDATE: 'yes' }, /SELF_UPDATE/],
  [{ WORK_MAP_ROUND_ROOT: '/nonexistent/rounds' }, /ROUND_ROOT/],
  [{ WORK_MAP_PROJECT: '/nonexistent/project.json' }, /project/i],
  [{ WORK_MAP_TYPO: '1' }, /WORK_MAP_TYPO/],
])('refuses a bad setting %j before writing anything', (settings, message) => {
  const run = install(['--no-build'], settings);
  expect(run.status).not.toBe(0);
  expect(run.stderr).toMatch(message);
  expect(existsSync(join(home, 'Library/LaunchAgents'))).toBe(false);
});

it('removes only its own jobs', () => {
  expect(install(['--no-build']).status).toBe(0);
  writeFileSync(join(home, 'Library/LaunchAgents/other.plist'), '');
  const run = install(['--remove']);
  expect(run.status).toBe(0);
  expect(agents()).toEqual(['other.plist']);
  expect(run.stdout).toContain(
    `launchctl bootout gui/${process.getuid!()}/local.work-map.demo.serve`,
  );
});

it('removes its jobs by label alone once the roadmap clone and Node are gone', () => {
  expect(install(['--no-build'], { WORK_MAP_LABEL: 'my.map' }).status).toBe(0);
  rmSync(roadmap, { recursive: true });
  const run = install(['--remove'], {
    WORK_MAP_LABEL: 'my.map',
    WORK_MAP_NODE: '/nonexistent/node',
  });
  expect(run.status, run.stderr).toBe(0);
  expect(agents()).toEqual([]);
});

it.each([
  ['is gone', () => rmSync(roadmap, { recursive: true })],
  ['is not JSON', () => writeFileSync(project, '{')],
  ['has an id that cannot name a label', () => writeFileSync(project, '{"id":"a b"}')],
])('asks for the label to remove when the project file %s', (_, breakProject) => {
  expect(install(['--no-build']).status).toBe(0);
  breakProject();
  const run = install(['--remove']);
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain('WORK_MAP_LABEL');
  expect(agents()).toHaveLength(3);
});

it('builds before it touches the running jobs, so a failed build leaves them running', () => {
  expect(install(['--no-build']).status).toBe(0);
  // The project file can't hold a folder, so the build fails at its first step.
  const run = install([], { WORK_MAP_DATA: join(project, 'data') });
  expect(run.status).not.toBe(0);
  expect(run.stdout).not.toContain('bootout');
  expect(agents()).toHaveLength(3);
});
