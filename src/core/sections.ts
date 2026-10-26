// SPDX-License-Identifier: AGPL-3.0-only
//
// The section map (section-map.json): which box owns which product paths. A changed file belongs
// to the box whose matching glob is most specific (the most literal characters); "shared" paths belong to no box and
// are not gaps; anything else no glob matches is a map gap. A PR belongs to the box most of its owned files point to.

export interface SectionMapFile {
  readonly repo: string;
  /** Map issues ("example-org/example-roadmap#21") to the box their tickets belong to, or 'outside'. */
  readonly maps?: Readonly<Record<string, string>>;
  readonly shared: readonly string[];
  readonly boxes: Readonly<Record<string, readonly string[]>>;
}
interface Rule {
  readonly box: string | null; // null: shared
  readonly re: RegExp;
  readonly weight: number;
}
export interface SectionMap {
  readonly rules: readonly Rule[];
}

/** "**" spans folders, "*" stays inside one, "?" is one character; a leading "**\/" may match nothing. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? '';
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      out += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replaceAll(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function compileSectionMap(file: SectionMapFile): SectionMap {
  const rule = (box: string | null, glob: string): Rule => ({
    box,
    re: globToRegExp(glob),
    weight: glob.replaceAll(/[*?]/g, '').length,
  });
  return {
    rules: [
      ...file.shared.map((g) => rule(null, g)),
      ...Object.entries(file.boxes).flatMap(([box, globs]) => globs.map((g) => rule(box, g))),
    ],
  };
}

/** The box that owns a path, 'shared', or null for a map gap. */
export function ownerOf(map: SectionMap, path: string): string | 'shared' | null {
  let best: Rule | null = null;
  for (const r of map.rules) if (r.re.test(path) && (!best || r.weight > best.weight)) best = r;
  return best ? (best.box ?? 'shared') : null;
}
