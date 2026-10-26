// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ComponentControls } from '../src/web/ComponentControls.tsx';

it('shows only Close when a callout has nothing to sync or copy', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(<ComponentControls title="Loading bay" close={() => {}} />);
  expect([...root.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
    'Close Loading bay',
  ]);
});
