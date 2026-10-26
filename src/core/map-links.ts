import { z } from 'zod';

export interface MapLink {
  readonly id: string;
  readonly title: string;
  readonly url: string;
}

const mapLinks: z.ZodType<readonly MapLink[]> = z
  .array(
    z
      .object({
        id: z.string().trim().min(1).max(80),
        title: z.string().trim().min(1).max(120),
        url: z
          .string()
          .regex(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/$/)
          .refine((value) => {
            try {
              return new URL(value).port !== '';
            } catch {
              return false;
            }
          }),
      })
      .strict(),
  )
  .min(1)
  .max(20)
  .refine(
    (maps) =>
      new Set(maps.map((map) => map.id)).size === maps.length &&
      new Set(maps.map((map) => map.url)).size === maps.length,
  );

export function currentMapLinks(value: unknown): readonly MapLink[] | null {
  const parsed = mapLinks.safeParse(value);
  return parsed.success ? parsed.data : null;
}
