// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globalSetup: ['test/browser-proof-server.ts'], include: ['test/**/*.test.{ts,tsx}'] },
});
