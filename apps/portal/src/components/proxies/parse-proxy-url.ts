import type { Proxy } from '@/api/types.js'

/** Parse locally; never include the credential-bearing input in an error or URL. */
export function parseProxyUrl(value: string): {
  type: Exclude<Proxy['type'], 'DIRECT'>
  host: string
  port: number
  username: string
  password: string
} {
  const input = value.trim()
  const invalid = () => new Error('INVALID_PROXY_URL')
  if (/\s|\\/.test(input)) throw invalid()
  const match = /^(https?|socks5):\/\/([^/?#]+)\/?$/i.exec(input)
  if (!match) throw invalid()
  const authority = match[2]!
  const endpoint = authority.slice(authority.lastIndexOf('@') + 1)
  // URL normalizes default HTTP(S) ports away, so validate the explicit port first.
  const endpointMatch = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(endpoint)
  if (!endpointMatch) throw invalid()
  const port = Number(endpointMatch[2])
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid()
  try {
    // HTTP URL parsing also validates bracketed IPv6 for SOCKS5 endpoints.
    const url = new URL('http://' + authority)
    const username = decodeURIComponent(url.username)
    const password = decodeURIComponent(url.password)
    if (
      [...username, ...password].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      throw invalid()
    if (!url.hostname || url.hostname.length > 255) throw invalid()
    return {
      type: match[1]!.toUpperCase() as Exclude<Proxy['type'], 'DIRECT'>,
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port,
      username,
      password,
    }
  } catch {
    throw invalid()
  }
}
