/** Reject URLs that point at private network space, loopback, or internal
 *  Docker hosts. Used to prevent SSRF on user-supplied URL endpoints
 *  (/api/extract). Even admin-only endpoints need this — a compromised admin
 *  account or a typo'd paste should not let the server fetch
 *  http://host.docker.internal:8090 (which would bypass the Claude proxy's
 *  bearer auth) or http://db:5432 (probe internal services). */

const PRIVATE_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  // Docker compose service names used internally by job-club
  'app',
  'db',
  'host.docker.internal',
])

const PRIVATE_HOSTNAME_SUFFIXES = ['.local', '.internal', '.localdomain']

function isPrivateIPv4(host: string): boolean {
  // Match dotted-quad and check RFC1918 + loopback + link-local + CGNAT.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const a = parseInt(m[1], 10)
  const b = parseInt(m[2], 10)
  if (a === 10) return true                          // 10.0.0.0/8
  if (a === 127) return true                         // loopback
  if (a === 169 && b === 254) return true            // link-local + AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12
  if (a === 192 && b === 168) return true            // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true  // CGNAT
  return false
}

export class UrlGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlGuardError'
  }
}

export function assertPublicHttpUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new UrlGuardError('Invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlGuardError(`Disallowed protocol: ${url.protocol}`)
  }
  const host = url.hostname.toLowerCase()
  if (PRIVATE_HOSTS.has(host)) {
    throw new UrlGuardError(`Disallowed host: ${host}`)
  }
  for (const suffix of PRIVATE_HOSTNAME_SUFFIXES) {
    if (host.endsWith(suffix)) {
      throw new UrlGuardError(`Disallowed host suffix: ${host}`)
    }
  }
  if (isPrivateIPv4(host)) {
    throw new UrlGuardError(`Disallowed private IP: ${host}`)
  }
  // IPv6 literal addresses come in []. We block them wholesale because
  // resolving "is this private IPv6?" properly is non-trivial and we have
  // no legitimate need for IPv6-literal sources. Hostnames resolving to
  // IPv6 publicly still work because we only check the literal form here.
  if (host.startsWith('[')) {
    throw new UrlGuardError('IPv6 literal hosts are not allowed')
  }
  return url
}
