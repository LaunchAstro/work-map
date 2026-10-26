import { createServer } from 'vite';

export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  if (process.env['WORK_MAP_TEST_URL']) return;
  const server = await createServer({
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  process.env['WORK_MAP_TEST_URL'] = server.resolvedUrls!.local[0]!;
  return () => server.close();
}
