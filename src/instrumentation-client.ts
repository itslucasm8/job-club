import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",
  environment: process.env.NODE_ENV || "development",

  sendDefaultPii: true,
  tracesSampleRate: 0.1,

  // Session Replay: skip baseline recording, but capture 100% of error sessions
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
})

// Track App Router page navigations
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
