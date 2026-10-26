// SPDX-License-Identifier: AGPL-3.0-only
//
// The page's build. The dev server also answers /data/* from .data, as src/cli/serve.ts does for the built page.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const app = import.meta.dirname;

function devData(): Plugin {
  return {
    name: 'work-map-data',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0] ?? '';
        const file = join(app, '.data', name);
        if (
          !['snapshot.json', 'agents.json', 'audit.json', 'scan-status.json'].includes(name) ||
          !existsSync(file)
        )
          return next();
        res.setHeader('content-type', 'application/json');
        res.end(readFileSync(file));
        return;
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devData()],
  server: { host: '127.0.0.1', port: Number(process.env['WORK_MAP_DEV_PORT'] || 5173) },
});
