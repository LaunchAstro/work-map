// #234: PRs merged without review and not marked, the list the section pop-up shows (on cards until #255).
import { expect, it } from 'vitest';
import type { SectionWork } from '../src/core/work.ts';
import { unreviewedMerged } from '../src/web/sectionBrief.ts';

const pr = (n: number, review: 'reviewed' | 'unreviewed', marked = false) => ({
  key: `Acme/app#${n}`,
  title: `PR ${n}`,
  url: `https://github.com/Acme/app/pull/${n}`,
  state: 'MERGED',
  review,
  marked,
  reason: '',
  labels: [],
  receiptUrl: null,
});
const work = (prs: ReturnType<typeof pr>[], open: string[] = []) =>
  ({
    openPrs: open.map((key) => ({ key, title: key, url: '', inferred: false })),
    review: { prs },
  }) as unknown as SectionWork;

it('counts merged PRs with no review and no mark, like the pop-up list', () => {
  const w = work(
    [
      pr(1, 'unreviewed'),
      pr(2, 'reviewed'),
      pr(3, 'unreviewed', true),
      pr(4, 'unreviewed'),
      pr(5, 'unreviewed'),
    ],
    ['Acme/app#5'],
  );
  expect(unreviewedMerged(w).map((p) => p.key)).toEqual(['Acme/app#1', 'Acme/app#4']);
});
