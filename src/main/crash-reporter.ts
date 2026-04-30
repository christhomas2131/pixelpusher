import { app } from 'electron';
import { logger } from './logger';

let initialized = false;

export function initCrashReporter(): void {
  if (initialized) return;

  const dsn = process.env.SENTRY_DSN || process.env.PIXELPUSHER_SENTRY_DSN;
  if (!dsn) {
    logger.info('crash-reporter', 'Sentry disabled (no SENTRY_DSN set)');
    return;
  }

  try {
    // Lazy require so production builds without the env var pay no startup cost
    // beyond the import — and so tests/dev runs without the dep installed don't crash.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/electron/main') as typeof import('@sentry/electron/main');

    Sentry.init({
      dsn,
      release: `pixelpusher@${app.getVersion()}`,
      environment: app.isPackaged ? 'production' : 'development',
      // Don't auto-collect IP/usernames. Stack traces only.
      sendDefaultPii: false,
      // Cap traffic. The app shouldn't send dozens of events per crash.
      maxBreadcrumbs: 50,
      beforeSend(event) {
        // Strip absolute home-directory paths from stack frames before send.
        // Sentry already redacts query params; this catches the macOS user dir.
        const home = require('os').homedir();
        const redact = (s: string | undefined) =>
          typeof s === 'string' ? s.split(home).join('~') : s;
        if (event.exception?.values) {
          for (const exc of event.exception.values) {
            for (const frame of exc.stacktrace?.frames ?? []) {
              frame.filename = redact(frame.filename);
              frame.abs_path = redact(frame.abs_path);
            }
          }
        }
        return event;
      },
    });

    initialized = true;
    logger.info('crash-reporter', `Sentry initialized  release=pixelpusher@${app.getVersion()} env=${app.isPackaged ? 'production' : 'development'}`);
  } catch (err) {
    logger.error('crash-reporter', 'Failed to initialize Sentry', String(err));
  }
}
