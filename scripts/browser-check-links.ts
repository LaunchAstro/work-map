import type { Page } from 'playwright';

/**
 * The header's map links, checked only when the browser check was given two or more maps: every map is linked
 * and the current one is marked. A map checked on its own may show its title instead, so it has nothing to check.
 */
export async function mapLinkFailures(page: Page, label: string, maps: number): Promise<string[]> {
  if (maps < 2) return [];
  const failures: string[] = [];
  if ((await page.locator('.map-links a').count()) < 2)
    failures.push(`${label}: both maps are linked`);
  if ((await page.locator('.map-links a[aria-current=page]').count()) !== 1)
    failures.push(`${label}: the current map is marked`);
  return failures;
}
