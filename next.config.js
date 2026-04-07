const { withSentryConfig } = require("@sentry/nextjs")

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
}

module.exports = withSentryConfig(nextConfig, {
  org: "my-little-france",
  project: "javascript-nextjs",

  // Route browser Sentry events through your own domain to bypass ad blockers
  tunnelRoute: "/monitoring",

  // Suppress noisy build logs
  silent: true,
})
