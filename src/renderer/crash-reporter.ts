// Renderer-side Sentry init. The main process owns the DSN; the renderer SDK
// pulls it over IPC automatically. We just need to call init() so the renderer's
// global error handlers are wired up.

export function initRendererCrashReporter(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/electron/renderer') as typeof import('@sentry/electron/renderer');
    Sentry.init({});
  } catch {
    // SDK not installed or main never initialized — silently no-op so the
    // renderer always boots, even without a DSN configured.
  }
}
