/**
 * Simple in-memory rate limiter for API routes.
 * Tracks request counts per IP within a sliding window.
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 })
 *   // In your route handler:
 *   const ip = req.headers.get('x-forwarded-for') || 'unknown'
 *   if (!limiter.check(ip)) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface RateLimiterOptions {
  /** Time window in milliseconds */
  windowMs: number
  /** Maximum requests per window */
  max: number
}

export function createRateLimiter(options: RateLimiterOptions) {
  const { windowMs, max } = options
  const store = new Map<string, RateLimitEntry>()

  // Clean up expired entries every 5 minutes to prevent memory leaks
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key)
    }
  }, 5 * 60 * 1000).unref()

  return {
    /**
     * Check if a request from this key is allowed.
     * Returns true if allowed, false if rate limited.
     */
    check(key: string): boolean {
      const now = Date.now()
      const entry = store.get(key)

      if (!entry || now > entry.resetAt) {
        store.set(key, { count: 1, resetAt: now + windowMs })
        return true
      }

      entry.count++
      if (entry.count > max) return false
      return true
    },

    /** Get remaining requests for a key */
    remaining(key: string): number {
      const now = Date.now()
      const entry = store.get(key)
      if (!entry || now > entry.resetAt) return max
      return Math.max(0, max - entry.count)
    },
  }
}

// Pre-configured limiters for different endpoints
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 min
})

export const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour per IP
})

export const passwordResetLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 reset requests per 15 min
})

export const extractLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 extractions per 15 min per IP
})

/** Extract client IP from request headers */
export function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown'
}
