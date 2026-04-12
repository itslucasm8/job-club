import { withAuth } from 'next-auth/middleware'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

// Skip auth entirely in development
function devMiddleware(req: NextRequest) {
  return NextResponse.next()
}

const prodMiddleware = withAuth(
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

export default process.env.NODE_ENV === 'development' ? devMiddleware : prodMiddleware

export const config = {
  matcher: ['/feed/:path*', '/states/:path*', '/job/:path*', '/profile/:path*', '/admin/:path*', '/saved/:path*', '/settings/:path*', '/guide/:path*', '/notifications/:path*', '/privacy', '/terms', '/onboarding'],
}
