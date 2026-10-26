// SPDX-License-Identifier: AGPL-3.0-only
//
// The font faces and base tokens, then the diagram's sheet.

import './styles/fonts.css';
import './styles/tokens.css';
import './flow.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

const root = document.querySelector('#root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
