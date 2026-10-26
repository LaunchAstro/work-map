// The PR-body Markdown parser (marked) is collector-only: the browser bundle never carries it (#107).
import { expect, it } from 'vitest';
import { build } from 'vite';

it('keeps marked out of the production web bundle', async () => {
  const result = await build({ logLevel: 'silent', build: { write: false } });
  const modules = (Array.isArray(result) ? result : [result]).flatMap((entry) =>
    'output' in entry
      ? entry.output.flatMap((output) =>
          output.type === 'chunk'
            ? Object.keys(output.modules).filter((id) => /\/marked\/lib\//.test(id))
            : [],
        )
      : [],
  );
  expect(modules).toEqual([]);
}, 20_000);
