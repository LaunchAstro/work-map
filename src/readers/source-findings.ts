import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { SourceFinding } from '../core/snapshot.ts';

const ReportSchema = z.object({
  productHead: z.string().regex(/^[0-9a-f]{40}$/),
  completedAt: z.iso.datetime({ offset: true }),
  findings: z.array(z.object({ unit: z.string().min(1), status: z.string().min(1) })),
});

// Native reports carry microseconds, which Date.parse drops: compare the sub-millisecond digits too.
const instant = (iso: string): [number, number] => [
  Date.parse(iso),
  Number((/\.\d{3}(\d*)/.exec(iso)?.[1] ?? '').padEnd(6, '0').slice(0, 6)),
];
const later = (a: string, b: string): boolean => {
  const [ma, ua] = instant(a);
  const [mb, ub] = instant(b);
  return ma === mb ? ua > ub : ma > mb;
};

/**
 * The newest native source-audit finding per unit. A missing folder or a report that does not
 * match the schema contributes nothing, and the section estimates stand unchanged.
 */
export function readSourceFindings(data: string): Record<string, SourceFinding> {
  let runs: string[];
  try {
    runs = readdirSync(join(data, 'code-audits'));
  } catch {
    return {};
  }
  const out: Record<string, SourceFinding> = {};
  for (const run of runs) {
    let report: z.infer<typeof ReportSchema>;
    try {
      report = ReportSchema.parse(
        JSON.parse(readFileSync(join(data, 'code-audits', run, 'summary.json'), 'utf8')),
      );
    } catch {
      continue;
    }
    for (const { unit, status } of report.findings) {
      const seen = out[unit];
      if (!seen || later(report.completedAt, seen.at))
        out[unit] = { at: report.completedAt, sha: report.productHead, status };
    }
  }
  return out;
}
