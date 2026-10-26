import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  buildSeatGauge,
  seatGaugeFailure,
  type SeatGaugePlacements,
  type SeatGaugeReport,
} from '../core/seat-gauge.ts';
import type { Project } from './project.ts';

export function readSeatGauge(
  project: Project,
  sections: ReadonlySet<string>,
  work: unknown,
  previous: unknown,
  placements: SeatGaugePlacements | null = null,
  now: Date = new Date(),
): SeatGaugeReport {
  let fd: number | undefined;
  try {
    fd = openSync(
      join(homedir(), 'Library/Application Support/com.launchastro.seatgauge/log.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = fstatSync(fd);
    const limit = 4_000_000;
    if (!before.isFile() || before.size > limit) throw new Error('Invalid publication');
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = readSync(fd, bytes, size, bytes.length - size, null);
      if (!read) break;
      size += read;
    }
    const after = fstatSync(fd);
    if (
      size > limit ||
      size !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new Error('Publication changed');
    return buildSeatGauge(
      JSON.parse(bytes.subarray(0, size).toString('utf8')),
      project,
      sections,
      work,
      now,
      previous,
      placements,
    );
  } catch {
    return seatGaugeFailure(previous, project, now, sections, placements);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
