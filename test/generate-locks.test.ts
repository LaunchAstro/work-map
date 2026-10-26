import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'map-generate-locks-'));
  const data = join(root, 'data');
  const bin = join(root, 'bin');
  mkdirSync(data);
  mkdirSync(bin);
  mkdirSync(join(root, 'src/cli'), { recursive: true });
  mkdirSync(join(root, 'ops'));
  copyFileSync(resolve('src/cli/generate.ts'), join(root, 'src/cli/generate.ts'));
  copyFileSync(resolve('ops/hold-lock.pl'), join(root, 'ops/hold-lock.pl'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  // Scale only the requested wait by 100; keep the CLI and kernel-lock helper unchanged.
  writeFileSync(
    join(bin, 'perl'),
    '#!/bin/sh\nprintf "%s:%s\\n" "${2##*/}" "$3" >> "$TEST_LOCK_TRACE"\nscript=$1\nlock=$2\nwait=$(( $3 / 100 ))\nshift 3\nexec /usr/bin/perl "$script" "$lock" "$wait" "$@"\n',
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, 'src/cli/generate-run.ts'),
    `import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const probe = (name) => spawnSync('/usr/bin/perl', ['-e',
  'use Fcntl qw(:flock); open(my $f, ">>", $ARGV[0]) or die; exit(flock($f, LOCK_EX | LOCK_NB) ? 0 : 75);',
  join(process.env.TEST_LOCK_DATA, name)]).status;
writeFileSync(process.env.TEST_PUBLICATION, JSON.stringify({
  args: process.argv.slice(2),
  checkout: probe('checkout.lockf'),
  publication: probe(process.argv[2] === 'agents' ? 'agents.lockf' : 'snapshot.lockf'),
}));
`,
  );
  const publication = join(data, 'published.json');
  const trace = join(data, 'locks.txt');
  return {
    root,
    data,
    publication,
    trace,
    run(mode: string, ...extra: string[]) {
      return spawn(
        process.execPath,
        [join(root, 'src/cli/generate.ts'), mode, ...extra, '--data', data],
        {
          env: {
            ...process.env,
            PATH: bin + ':' + process.env['PATH'],
            TEST_LOCK_TRACE: trace,
            TEST_LOCK_DATA: data,
            TEST_PUBLICATION: publication,
          },
          stdio: 'ignore',
        },
      );
    },
  };
}

async function hold(data: string, name: string, seconds: number) {
  const holder = spawn(
    '/usr/bin/perl',
    [
      '-e',
      'use Fcntl qw(:flock); $|=1; open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_EX) or die; print "held\\n"; select(undef, undef, undef, $ARGV[1]);',
      join(data, name),
      String(seconds),
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  await once(holder.stdout, 'data');
  return holder;
}

it.each(['checkout.lockf', 'snapshot.lockf'])(
  'snapshot publication waits through brief contention on %s and retains both kernel locks',
  async (name) => {
    const f = fixture();
    const holder = await hold(f.data, name, 0.4);
    const child = f.run('snapshot');
    try {
      const [code] = await once(child, 'close');
      expect(code).toBe(0);
      expect(JSON.parse(readFileSync(f.publication, 'utf8'))).toEqual({
        args: ['snapshot', '--data', f.data],
        checkout: 75,
        publication: 75,
      });
      expect(readFileSync(f.trace, 'utf8')).toBe('checkout.lockf:120\nsnapshot.lockf:120\n');
    } finally {
      child.kill();
      holder.kill();
      rmSync(f.root, { recursive: true, force: true });
    }
  },
  10_000,
);

it.each(['github', 'agents', 'snapshot'])(
  '%s publication stops when its bounded wait expires',
  async (mode) => {
    const f = fixture();
    const name = mode === 'agents' ? 'agents.lockf' : 'snapshot.lockf';
    // Held until the test ends, so a slow start under load still meets a held lock.
    const holder = await hold(f.data, name, 60);
    const child = f.run(mode);
    try {
      const [code] = await once(child, 'close');
      expect(code).toBe(75);
      expect(existsSync(f.publication)).toBe(false);
      expect(readFileSync(f.trace, 'utf8')).toBe(`checkout.lockf:120\n${name}:120\n`);
    } finally {
      child.kill();
      holder.kill();
      rmSync(f.root, { recursive: true, force: true });
    }
  },
  10_000,
);

it('refuses the retired audit observations flag before taking publication locks', async () => {
  const f = fixture();
  const child = f.run('snapshot', '--audit-observations');
  try {
    const [code] = await once(child, 'close');
    expect(code).toBe(1);
    expect(existsSync(f.trace)).toBe(false);
    expect(existsSync(f.publication)).toBe(false);
  } finally {
    child.kill();
    rmSync(f.root, { recursive: true, force: true });
  }
});
