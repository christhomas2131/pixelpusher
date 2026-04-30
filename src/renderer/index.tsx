import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initRendererCrashReporter } from './crash-reporter';

initRendererCrashReporter();

const container = document.getElementById('root')!;
const root = createRoot(container);
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
