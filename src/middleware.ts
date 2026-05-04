import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

// Auth runs in every environment. Local dev signs in as the seeded admin
// (`admin@...` / `admin123` from prisma/seed.ts). Avoids the previous
// NODE_ENV-conditional bypass — a single misconfiguration there would have
// disabled auth in production. Defense in depth: removing the branch removes
// the misconfiguration risk.
export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const path = req.nextUrl.pathname

    logger.info('request', { route: path, user: token?.email as string })

    if (path.startsWith('/admin') && token?.role !== 'admin') {
      return NextResponse.redirect(new URL('/feed', req.url))
    }

    if (token?.subscriptionStatus !== 'active' && token?.subscriptionStatus !== 'past_due' && token?.role !== 'admin') {
      return NextResponse.redirect(new URL('/subscribe', req.url))
    }

    // Onboarding gate: active subscribers who haven't completed onboarding
    if (token?.role !== 'admin' && !token?.onboardingCompleted) {
      if (path !== '/onboarding') {
        return NextResponse.redirect(new URL('/onboarding', req.url))
      }
    }

    // Already onboarded users visiting /onboarding get sent to feed
    if (path === '/onboarding' && token?.onboardingCompleted) {
      return NextResponse.redirect(new URL('/feed', req.url))
    }

    return NextResponse.next()
  },
  { callbacks: { authorized: ({ token }) => !!token } }
)

export const config = {
  matcher: ['/feed/:path*', '/states/:path*', '/job/:path*', '/profile/:path*', '/admin/:path*', '/saved/:path*', '/settings/:path*', '/guide/:path*', '/notifications/:path*', '/privacy', '/terms', '/onboarding'],
}
