import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initPwa } from './app/pwa';
import './ui/styles.css';

try {
  const theme = localStorage.getItem('hq:theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  /* per-viewer convenience only */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
void initPwa();
if (import.meta.env.VITE_E2E_MOCKS === '1') void import('./app/testHooks').then((m) => m.installTestHooks());
