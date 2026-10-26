// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { currentMapLinks } from '../src/core/map-links.ts';
import { MapLinks } from '../src/web/MapLinks.tsx';

const maps = [
  { id: 'first', title: 'First work map', url: 'http://127.0.0.1:4317/' },
  { id: 'second', title: 'Second work map', url: 'http://127.0.0.1:4400/' },
];

it('links independent loopback maps and identifies the current page', () => {
  const links = currentMapLinks(maps);
  expect(links).toEqual(maps);
  const html = renderToStaticMarkup(<MapLinks maps={links} id="second" title="Second work map" />);
  const root = document.createElement('div');
  root.innerHTML = html;
  expect(root.querySelector('nav')?.getAttribute('aria-label')).toBe('Work maps');
  expect(root.querySelector('[aria-current="page"]')?.textContent).toBe('Second work map');
  // #168: maps switch in one window, so a link names the map on this origin, not its own port.
  expect(root.querySelector('a')?.getAttribute('href')).toBe('?map=first');
  expect(root.querySelectorAll('h1')).toHaveLength(1);
});

it('falls back to the current title for absent, failed or unrelated configuration', () => {
  for (const links of [null, [], [maps[0]!]]) {
    const html = renderToStaticMarkup(
      <MapLinks maps={links} id="second" title="Current work map" />,
    );
    expect(html).toContain('<h1>Current work map</h1>');
    expect(html).not.toContain('<nav');
  }
});

it('rejects the whole list on unsafe addresses, duplicates or excessive configuration', () => {
  for (const url of [
    'https://example.com/',
    'http://127.0.0.2:4317/',
    'http://localhost:4317/',
    'http://user@127.0.0.1:4317/',
    'javascript:alert(1)',
    '//127.0.0.1:4317/',
    'http://127.0.0.1:4317/path',
    'http://127.0.0.1:4317/?token=secret',
    'http://127.0.0.1:4317/#fragment',
    'http://2130706433:4317/',
  ])
    expect(currentMapLinks([{ ...maps[0], url }])).toBeNull();
  for (const value of [
    null,
    {},
    [maps[0], maps[0]],
    [maps[0], { ...maps[1], url: maps[0]!.url }],
    [{ ...maps[0], title: '' }],
    Array.from({ length: 21 }, (_, n) => ({
      id: String(n),
      title: 'Map',
      url: `http://127.0.0.1:${4400 + n}/`,
    })),
  ])
    expect(currentMapLinks(value)).toBeNull();
});
