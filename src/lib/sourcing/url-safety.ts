/**
 * SSRF guards for admin-supplied URLs.
 *
 * The Candidates `from-url` and `from-urls-bulk` endpoints accept URLs typed
 * by an authenticated admin and forward them to the proxy fetcher. The proxy
 * runs on the VPS host and CAN reach internal docker network targets
 * (`http://app:3000`, `http://db:5432`, `http://scraper:8091`, etc.) as well
 * as private IP ranges. Without filtering we trust the admin not to type or
 * paste internal URLs by mistake — and a compromised admin account becomes
 * an SSRF vector against everything in the docker compose network.
 *
 * This module rejects:
 *   - non-http(s) schemes (file:, data:, ftp:, gopher:, etc.)
 *   - hostnames that resolve to RFC1918 / loopback / link-local / metadata
 *     addresses purely by string check (we do NOT do DNS resolution; relying
 *     on the proxy to reject too is defense-in-depth)
 *   - the docker-compose service names we know about (`app`, `db`, `scraper`,
 *     `localhost`, `host.docker.internal`)
 *
 * It does NOT rate-limit (admin-only path) and does NOT validate that the
 * URL points at an actual job listing — that's the extractor's job.
 */

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  // Docker-compose service names from this project's stack. If new services
  // are added, list them here so they're not reachable from the public route.
  'app',
  'db',
  'scraper',
  'host.docker.internal',
  'docker.internal',
  // Cloud metadata endpoints — never want admin URLs hitting these.
  '169.254.169.254',
  'metadata.google.internal',
])

// CIDR-style match without a CIDR library: covers the common private ranges
// by string prefix on the dotted IPv4 form. False negatives possible for
// exotic representations (octal, decimal-encoded, IPv4-mapped IPv6) but the
// docker network is the realistic threat surface and it uses standard form.
function isBlockedIPv4(host: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false
  const [a, b] = host.split('.').map(n => parseInt(n, 10))
  if (a === 10) return true                    // 10.0.0.0/8
  if (a === 127) return true                   // 127.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12
  if (a === 192 && b === 168) return true      // 192.168.0.0/16
  if (a === 169 && b === 254) return true      // 169.254.0.0/16 (link-local + AWS metadata)
  if (a === 0) return true                     // 0.0.0.0/8
  return false
}

export type UrlSafetyResult =
  | { ok: true }
  | { ok: false; reason: string }

export function validateAdminUrl(rawUrl: string): UrlSafetyResult {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'URL invalide' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `Schéma ${parsed.protocol} non autorisé (http/https uniquement)` }
  }
  const host = parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTS.has(host)) {
    return { ok: false, reason: `Host bloqué: ${host}` }
  }
  if (isBlockedIPv4(host)) {
    return { ok: false, reason: `IP privée bloquée: ${host}` }
  }
  // IPv6 loopback / link-local / unique-local prefixes by string check.
  if (host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe80') || host === '[::1]') {
    return { ok: false, reason: `IPv6 privée bloquée: ${host}` }
  }
  return { ok: true }
}
