import * as Sentry from "@sentry/browser";

const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim();

let initialized = false;

export function initBrowserTelemetry() {
  if (initialized || !sentryDsn) {
    initialized = true;
    return;
  }

  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
  });
  initialized = true;
}

export function captureBrowserException(error: unknown, context?: Record<string, string | number | boolean | null>) {
  initBrowserTelemetry();

  if (!sentryDsn) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        scope.setExtra(key, value);
      }
    }

    Sentry.captureException(error);
  });
}
