import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { isNativePlatform } from './lib/nativePlatform';
import './index.css';

if (!isNativePlatform() && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);
