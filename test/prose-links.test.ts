// SPDX-License-Identifier: AGPL-3.0-only
// The one prose-link rule (#107): what a PR body's prose places it by, and what it never counts.
import { expect, it } from 'vitest';
import { proseIssueKeys } from '../src/core/prose-links.ts';

const url = 'https://github.com/Acme/app/issues/49';
const counted: readonly (readonly [string, string, readonly string[]])[] = [
  ['bare #n', 'For #49.', ['Acme/site#49']],
  ['repo#n', 'See app#49.', ['Acme/app#49']],
  ['owner/repo#n', 'See Acme/app#49.', ['Acme/app#49']],
  ['a plain issue URL', `See ${url}.`, ['Acme/app#49']],
  ['an inline link destination', `For [booking](${url}).`, ['Acme/app#49']],
  ['an angle-bracket destination', `For [booking](<${url}>).`, ['Acme/app#49']],
  ['a full reference', `For [booking][t].\n\n[t]: ${url}`, ['Acme/app#49']],
  ['a collapsed reference', `For [t][].\n\n[t]: ${url}`, ['Acme/app#49']],
  ['a shortcut reference', `For [t].\n\n[t]: ${url}`, ['Acme/app#49']],
  ['prose in a list item', '- for #49', ['Acme/site#49']],
  ['prose in emphasis', 'For **#49**.', ['Acme/site#49']],
  ['prose in a table cell', '| a |\n| - |\n| #49 |', ['Acme/site#49']],
];
const notCounted: readonly (readonly [string, string])[] = [
  ['link text', `For [#50](${url}).`],
  ['a double-quoted title', `For [booking](${url} "Booking #50").`],
  ['a single-quoted title', `For [booking](${url} 'Booking #50').`],
  ['a parenthesised title', `For [booking](${url} (Booking #50)).`],
  ['a title holding a parenthesis', `For [booking](${url} "Booking (v1) #50").`],
  ['a reference label', `For [#50][#50].\n\n[#50]: ${url}`],
  ['a definition title', `For [t].\n\n[t]: ${url} "Booking #50"`],
  ['an unused definition', '[t]: https://github.com/Acme/app/issues/50'],
  ['a destination that is not an issue URL', '[#50](https://example.com/x#50)'],
  ['a pull request URL', 'See https://github.com/Acme/app/pull/50.'],
  ['an issue comment URL', 'See https://github.com/Acme/app/issues/50#issuecomment-1.'],
  ['an image', '![#50](https://github.com/Acme/app/issues/50)'],
  ['a code span', 'Run `fix #50`.'],
  ['a code block', '```\n#50\n```'],
  ['raw HTML', '<a href="https://github.com/Acme/app/issues/50">#50</a>'],
];

it.each(counted)('counts %s', (_, body, keys) => {
  expect(proseIssueKeys(body, 'Acme/site')).toEqual(keys);
});

it.each(notCounted)('never counts %s', (_, body) => {
  expect(proseIssueKeys(body, 'Acme/site').filter((k) => k.endsWith('#50'))).toEqual([]);
});

it('counts prose after an HTML anchor closes', () => {
  expect(proseIssueKeys('<a href="x">#50</a> then #49', 'Acme/site')).toEqual(['Acme/site#49']);
  expect(proseIssueKeys('<a href="x">\n#50\n</a>\n\nFor #49.', 'Acme/site')).toEqual([
    'Acme/site#49',
  ]);
});
