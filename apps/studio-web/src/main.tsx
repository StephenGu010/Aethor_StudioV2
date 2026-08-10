import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import { App } from './App';
import { readDesktopBootstrap } from './integrations/desktopBridge';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root application mount point');
const Router = readDesktopBootstrap() ? HashRouter : BrowserRouter;

createRoot(root).render(
  <StrictMode>
    <Tooltip.Provider delayDuration={350}>
      <Router>
        <App />
      </Router>
    </Tooltip.Provider>
  </StrictMode>
);
