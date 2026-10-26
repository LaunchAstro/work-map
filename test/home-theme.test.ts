// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it.each(['', '?map=away'])('paints the addressed map theme before React starts at %s', (search) => {
  const html = readFileSync(join(import.meta.dirname, '../index.html'), 'utf8');
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  localStorage.setItem('work-map:home', 'home');
  localStorage.setItem('work-map:last', 'away');
  localStorage.setItem('work-map:view:home', JSON.stringify({ theme: 'dark' }));
  localStorage.setItem('work-map:view:away', JSON.stringify({ theme: 'light' }));
  const source = new DOMParser()
    .parseFromString(html, 'text/html')
    .querySelector('script')!.textContent;
  new Function('location', 'localStorage', 'document', source)(
    new URL(`http://127.0.0.1:4317/${search}`),
    localStorage,
    document,
  );
  expect(document.documentElement.dataset['theme'] ?? 'light').toBe(search ? 'light' : 'dark');
});
