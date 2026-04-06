const { withSentryConfig } = require("@sentry/nextjs")

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
}

module.exports = withSentryConfig(nextConfig, {
  // Route browser Sentry events through your own domain to bypass ad blockers
  tunnelRoute: "/monitoring",

  // Don't upload source maps yet (needs auth token — will set up later)
  sourcemaps: {
    disable: true,
  },

  // Suppress build logs about missing org/project
  silent: true,
})
