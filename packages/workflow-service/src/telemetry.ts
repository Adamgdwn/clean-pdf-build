import * as Sentry from "@sentry/node";

import { readServerEnv } from "./env.js";

let sentryInitialized = false;

function ensureSentry() {
  if (sentryInitialized) {
    return;
  }

  const env = readServerEnv();

  if (!env.SENTRY_DSN) {
    sentryInitialized = true;
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
  });
  sentryInitialized = true;
}

export function captureServerException(error: unknown, context?: Record<string, string | number | boolean | null>) {
  ensureSentry();

  if (!readServerEnv().SENTRY_DSN) {
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
