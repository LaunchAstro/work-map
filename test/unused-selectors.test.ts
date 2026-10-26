// scripts/unused-selectors.mjs (#133): a CSS rule is listed for deletion only when no markup, template or
// data-produced class name can reach any selector in it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const script = readFileSync(new URL('../scripts/unused-selectors.mjs', import.meta.url), 'utf8');
/** Runs the script on a throwaway tree holding one stylesheet, one web file and one core file. */
function report(css: string, web: string, core = ''): string {
  const dir = mkdtempSync(join(tmpdir(), 'unused-selectors-'));
  try {
    for (const sub of ['scripts', 'src/web', 'src/core'])
      mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, 'scripts/unused-selectors.mjs'), script);
    writeFileSync(join(dir, 'src/web/flow.css'), css);
    writeFileSync(join(dir, 'src/web/App.tsx'), web);
    writeFileSync(join(dir, 'src/core/kinds.ts'), core);
    writeFileSync(join(dir, 'index.html'), '<div id="root"></div>');
    return execFileSync(process.execPath, [join(dir, 'scripts/unused-selectors.mjs')], {
      encoding: 'utf8',
      timeout: 5000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const deletes = (count: number) =>
  new RegExp(`Rules to delete, every selector dead \\(${count}\\)`);

it('keeps class names built by templates, in markup or in core data', () => {
  const core = "export const wireClass = (kind: 'hot' | 'cold') => `wire-${kind}`;";
  const web =
    "import { wireClass } from '../core/kinds'; export const Edge = ({ kind }) => <path className={wireClass(kind)} />;";
  expect(report('.wire-hot { stroke: red; } .wire-cold { stroke: blue; }', web, core)).toMatch(
    deletes(0),
  );
  expect(
    report(
      '.wire-hot { stroke: red; }',
      'const Edge = ({ kind }) => <path className={`wire-${kind}`} />;',
    ),
  ).toMatch(deletes(0));
});
it('keeps a class the core sends as a string literal', () => {
  const output = report(
    '.dash { stroke-dasharray: 4 4; }',
    'const Edge = ({ wire }) => <path className={wire.kind} />;',
    "export const wire = { kind: 'dash' };",
  );
  expect(output).toMatch(deletes(0));
});
it('keeps a partly used selector list and ignores attribute selectors', () => {
  const output = report(
    '.live, .dead { color: red; } .live[data-s="blocked"] { color: brown; }',
    '<div className="live" data-s="blocked" />',
  );
  expect(output).toMatch(deletes(0));
  expect(output).toMatch(/Rules kept, some selectors dead \(1\)/);
});
it('lists a rule whose every selector is unused', () => {
  expect(report('.dead { color: red; }', '<div className="live" />')).toMatch(deletes(1));
});
it('lists an element selector whose tag no markup renders', () => {
  const output = report(
    '.card kbd { color: red; } .card span { color: blue; }',
    '<div className="card"><span /></div>',
  );
  expect(output).toMatch(deletes(1));
  expect(output).toMatch(/Unused names \(1\):\n {2}<kbd>\n/);
});
it('keeps guarded element names, html and body, and tags rendered in markup', () => {
  expect(report(':where(kbd) { color: red; }', '<div />')).toMatch(deletes(0));
  expect(report('html, body { margin: 0; }', '<div />')).toMatch(deletes(0));
  expect(report('svg text { fill: red; }', '<svg><text /></svg>')).toMatch(deletes(0));
});
it('keeps a tag created by a multiline createElement call', () => {
  const web =
    "document.body.append(document.createElement(\n  'kbd'\n));\n" +
    "document.body.append(document.createElementNS(\n  'http://www.w3.org/2000/svg',\n  'text'\n));";
  expect(report('kbd { color: red; } text { fill: red; }', web)).toMatch(deletes(0));
});
