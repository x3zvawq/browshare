import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'

export function normalizeProxyHost(value: string): string {
  const host = value.trim()
  if (host.length === 0 || host.length > 255) throw new TypeError('Proxy host is invalid.')
  if (
    /\s|[/@?#]/u.test(host) ||
    host.includes('://') ||
    host.startsWith('[') ||
    host.endsWith(']')
  ) {
    throw new TypeError('Proxy host must not include a scheme, path, credentials or brackets.')
  }
  if (isIP(host) !== 0) return host.toLowerCase()
  const ascii = domainToASCII(host.replace(/\.$/u, '')).toLowerCase()
  if (
    ascii.length === 0 ||
    ascii.length > 253 ||
    !ascii.split('.').every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/u.test(label))
  )
    throw new TypeError('Proxy host must be a valid IPv4, IPv6 or DNS name.')
  return ascii
}

export function assertProxyCredentials(
  type: 'HTTP' | 'HTTPS' | 'SOCKS5',
  username: string | null,
  password: string | null,
): void {
  if (type === 'SOCKS5') {
    // RFC 1929 encodes each credential length in one byte. Test UTF-8 bytes,
    // rather than JS string length, before handing credentials to the client.
    if (
      (username !== null || password !== null) &&
      (username === null ||
        password === null ||
        Buffer.byteLength(username) < 1 ||
        Buffer.byteLength(username) > 255 ||
        Buffer.byteLength(password) < 1 ||
        Buffer.byteLength(password) > 255)
    )
      throw new TypeError(
        'SOCKS5 authentication requires a username and password of 1 to 255 UTF-8 bytes each.',
      )
  } else if (username?.includes(':')) {
    throw new TypeError('HTTP Proxy usernames cannot contain a colon.')
  }
}
