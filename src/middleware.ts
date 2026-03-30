import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const path = req.nextUrl.pathname

    logger.info('request', { route: path, user: token?.email as string })

    if (path.startsWith('/admin') && token?.role !== 'admin') {
      return NextResponse.redirect(new URL('/feed', req.url))
    }

    if (token?.subscriptionStatus !== 'active' && token?.role !== 'admin') {
      return NextResponse.redirect(new URL('/subscribe', req.url))
    }

    return NextResponse.next()
  },
  { callbacks: { authorized: ({ token }) => !!token } }
)

export const config = {
  matcher: ['/feed/:path*', '/states/:path*', '/job/:path*', '/profile/:path*', '/admin/:path*', '/saved/:path*'],
}
