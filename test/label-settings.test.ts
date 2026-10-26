// A project names the labels that mark a pull request as still owing review, and the title its switch-on issues
// start with. Unset, they are the values every map used before projects could name their own.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { reviewPr } from '../src/core/scope.ts';
import type { OpenPr } from '../src/core/work.ts';
import { readProject } from '../src/readers/project.ts';

const roadmap = join(import.meta.dirname, '../examples/demo/roadmap');
const head = 'a'.repeat(40);
const approved = (labels: string[]): OpenPr => ({
  key: 'Acme/app#1',
  number: 1,
  title: 'New feature',
  body: 'Section: tasks',
  url: 'https://example.com/1',
  headRefName: 'feature',
  headRefOid: head,
  issueKeys: [],
  state: 'OPEN',
  labels,
  labelsComplete: true,
  reviews: [{ state: 'APPROVED', head }],
  reviewsComplete: true,
  comments: [],
  commentsComplete: true,
});

it("holds an approved pull request as unreviewed while it carries one of the project's debt labels", () => {
  expect(reviewPr(approved(['needs-human']), [], ['needs-human']).review).toBe('unreviewed');
  expect(reviewPr(approved(['needs-sol']), [], ['needs-human']).review).toBe('reviewed');
  expect(reviewPr(approved([]), [], ['needs-human']).review).toBe('reviewed');
});

it('keeps the earlier three debt labels when the project names none', () => {
  for (const label of ['needs-sol', 'unreviewed', 'needs-second-model'])
    expect(reviewPr(approved([label])).review, label).toBe('unreviewed');
  expect(reviewPr(approved(['needs-human'])).review).toBe('reviewed');
});

it('reads the debt labels from project.json', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'work-map-debt-')), 'project.json');
  const base = JSON.parse(readFileSync(join(roadmap, 'project.json'), 'utf8'));
  writeFileSync(file, JSON.stringify({ ...base, reviewDebtLabels: ['needs-human'] }));
  expect(readProject(file, roadmap).project.reviewDebtLabels).toEqual(['needs-human']);
  writeFileSync(file, JSON.stringify({ ...base, reviewDebtLabels: [''] }));
  expect(() => readProject(file, roadmap)).toThrow(/reviewDebtLabels/);
});

it('reads the switch-on title from project.json and refuses one that would break the search', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'work-map-switch-on-')), 'project.json');
  const base = JSON.parse(readFileSync(join(roadmap, 'project.json'), 'utf8'));
  writeFileSync(file, JSON.stringify({ ...base, switchOnTitle: 'Go-live' }));
  expect(readProject(file, roadmap).project.switchOnTitle).toBe('Go-live');
  for (const bad of ['', 'Go "live"', 'Go\\live']) {
    writeFileSync(file, JSON.stringify({ ...base, switchOnTitle: bad }));
    expect(() => readProject(file, roadmap), bad).toThrow(/switchOnTitle/);
  }
});

// GitHub trims issue titles and caps a search at 256 characters, and the switch-on search shares one query with
// the merged pull requests, so a title that can't match or can't be searched would empty or break both.
it('refuses a switch-on title with outer spaces or control characters, or over 100 characters', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'work-map-switch-on-')), 'project.json');
  const base = JSON.parse(readFileSync(join(roadmap, 'project.json'), 'utf8'));
  for (const good of ['Go live', 'Mise en service', 'x'.repeat(100)]) {
    writeFileSync(file, JSON.stringify({ ...base, switchOnTitle: good }));
    expect(readProject(file, roadmap).project.switchOnTitle, good).toBe(good);
  }
  for (const bad of [
    ' ',
    ' Go-live',
    'Go-live ',
    'Go\nlive',
    'Go\tlive',
    'Go\u0007live',
    'Go\u2028live',
    'x'.repeat(101),
  ]) {
    writeFileSync(file, JSON.stringify({ ...base, switchOnTitle: bad }));
    expect(() => readProject(file, roadmap), JSON.stringify(bad)).toThrow(/switchOnTitle/);
  }
});
