import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import { App } from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root application mount point');

createRoot(root).render(
  <StrictMode>
    <Tooltip.Provider delayDuration={350}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Tooltip.Provider>
  </StrictMode>
);

