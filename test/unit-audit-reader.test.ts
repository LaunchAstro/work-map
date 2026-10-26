import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readUnitScores } from '../src/readers/unit-audit.ts';

// #194: the project's audit file (the roadmap's completion JSON).
describe('reading build-unit audit scores (#194)', () => {
  const root = mkdtempSync(join(tmpdir(), 'unit-audit-'));
  mkdirSync(join(root, 'docs'));
  const write = (name: string, body: unknown) =>
    writeFileSync(join(root, 'docs', name), typeof body === 'string' ? body : JSON.stringify(body));
  write('ok.json', {
    asAt: '13 October 2026',
    method: 'one entry per unit',
    units: { U00: { days: 49, code: 0.97, live: 'yes' }, U01: { code: 0 } },
  });
  write('bad-score.json', { asAt: 'x', units: { U00: { code: 1.5 } } });
  write('broken.json', '{');
  writeFileSync(
    join(root, 'outside.json'),
    JSON.stringify({ asAt: 'x', units: { U00: { code: 1 } } }),
  );
  it('reads each unit code score and the audit date', () => {
    expect(readUnitScores(root, 'docs/ok.json')).toEqual({
      asAt: '13 October 2026',
      units: {
        U00: {
          days: 49,
          built: 0.97,
          live: 0.97,
          by: 'audit',
          at: '13 October 2026',
          confidence: 1,
          reason: 'Audit',
        },
        // #204: days default to 1 and live to no when the file leaves them out.
        U01: {
          days: 1,
          built: 0,
          live: 0,
          by: 'audit',
          at: '13 October 2026',
          confidence: 1,
          reason: 'Audit',
        },
      },
    });
  });
  it('gives nothing for a missing, broken or out-of-range file, or a path outside the root', () => {
    expect(readUnitScores(root, 'docs/missing.json')).toBeUndefined();
    expect(readUnitScores(root, 'docs/broken.json')).toBeUndefined();
    expect(readUnitScores(root, 'docs/bad-score.json')).toBeUndefined();
    expect(readUnitScores(join(root, 'docs'), '../outside.json')).toBeUndefined();
    expect(readUnitScores(root, join(root, 'docs/ok.json'))).toBeUndefined();
  });
});
