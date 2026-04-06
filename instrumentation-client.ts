import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Capture 10% of transactions for performance monitoring
  tracesSampleRate: 0.1,

  // No session replay (saves quota — can enable later)
  replaysSessionSampleRate: 0,
  // Replay 100% of sessions that hit an error
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
})
