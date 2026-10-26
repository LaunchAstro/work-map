// SPDX-License-Identifier: AGPL-3.0-only
//
// The server path for the map this window shows (#168). `?map=<id>` sends it through `/m/<id>`,
// which this page's own server answers or forwards to that map's server; without it the path is
// this server's own map. Another host app can keep the same shape: one app, a project in the address.
export function mapPath(path: string, search: string = globalThis.location?.search ?? ''): string {
  const id = new URLSearchParams(search).get('map');
  return id ? `/m/${encodeURIComponent(id)}${path}` : path;
}
