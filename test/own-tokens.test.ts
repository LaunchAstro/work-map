import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

function files(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && keep(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

const read = (file: string) => readFileSync(join(root, file), 'utf8');
const webSheets = files('src/web', (name) => name.endsWith('.css'));
const webScripts = files('src/web', (name) => /\.tsx?$/.test(name));

it('declares every custom property the page reads in its own sheets or inline styles', () => {
  const declared = new Set<string>();
  for (const file of webSheets)
    for (const [, name] of read(file).matchAll(/(--[\w-]+)\s*:/g)) declared.add(name!);
  for (const file of webScripts)
    for (const [, name] of read(file).matchAll(/['"](--[\w-]+)['"]\s*:/g)) declared.add(name!);
  const missing: string[] = [];
  for (const file of [...webSheets, ...webScripts, 'index.html'])
    for (const [, name] of read(file).matchAll(/var\((--[\w-]+)/g))
      if (!declared.has(name!)) missing.push(`${file}: ${name}`);
  expect([...new Set(missing)]).toEqual([]);
});

// Every font binary a sheet asks for, following its @imports: [the sheet, the url as written, the file it names].
function fontRequests(sheet: string): [string, string, string][] {
  const require = createRequire(sheet);
  const text = readFileSync(sheet, 'utf8');
  return [
    ...[...text.matchAll(/@import '([^']+)'/g)].flatMap((m) =>
      fontRequests(require.resolve(m[1]!)),
    ),
    ...[...text.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((m): [string, string, string] => [
      sheet,
      m[1]!,
      m[1]!.startsWith('.') ? join(dirname(sheet), m[1]!) : require.resolve(m[1]!),
    ]),
  ];
}

it('finds every font file the font sheet asks for, through its imports', () => {
  const requests = fontRequests(join(root, 'src/web/styles/fonts.css'));
  // Funnel Display: woff2 and woff for four weights; Funnel Sans and Chivo Mono: one variable woff2 each.
  expect(requests).toHaveLength(10);
  expect(requests.filter(([, , file]) => !existsSync(file))).toEqual([]);
});

it('ships the OFL licence beside each bundled font family', () => {
  const families = Object.keys(JSON.parse(read('package.json')).dependencies).filter((name) =>
    name.startsWith('@fontsource'),
  );
  expect(families.length).toBe(3);
  for (const family of families) {
    const licence = read(`src/web/styles/licences/OFL-${family.split('/')[1]}.txt`);
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
  }
});

it('builds from registry packages and its own files alone', () => {
  const manifest = JSON.parse(read('package.json'));
  const specifiers = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies });
  expect(specifiers.filter(([, spec]) => !/^[\^~]?\d/.test(String(spec)))).toEqual([]);
  expect(read('vite.config.ts')).not.toContain('alias');
  const imports = [...read('src/web/main.tsx').matchAll(/^import '([^']+\.css)'/gm)].map(
    (m) => m[1],
  );
  expect(imports).toEqual(['./styles/fonts.css', './styles/tokens.css', './flow.css']);
});

it('needs no step to fetch a style kit before installing', () => {
  expect(['scripts/vendor-ui.sh', 'UI_PIN'].filter((file) => existsSync(join(root, file)))).toEqual(
    [],
  );
  expect(Object.keys(JSON.parse(read('package.json')).scripts)).not.toContain('vendor:ui');
  for (const file of ['ops/run.sh', 'examples/demo/README.md', 'examples/demo/run.sh'])
    expect(read(file), file).not.toContain('vendor');
});
