const { withSentryConfig } = require("@sentry/nextjs")

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
        ],
      },
    ]
  },
}

module.exports = withSentryConfig(nextConfig, {
  org: "my-little-france",
  project: "javascript-nextjs",

  // Route browser Sentry events through your own domain to bypass ad blockers
  tunnelRoute: "/monitoring",

  // Suppress noisy build logs
  silent: true,
})
