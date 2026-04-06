import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  sendDefaultPii: true,

  // 100% in dev (see everything), 10% in production (save quota)
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Session Replay: skip baseline recording, but capture 100% of error sessions
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
})

// Track App Router page navigations
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
