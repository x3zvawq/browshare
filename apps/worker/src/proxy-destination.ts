import { lookup } from 'node:dns'
import { BlockList, isIP, type LookupFunction } from 'node:net'

import { RequestError } from 'proxy-chain'

const hostLocalAddresses = new BlockList()
hostLocalAddresses.addSubnet('127.0.0.0', 8, 'ipv4')
hostLocalAddresses.addSubnet('0.0.0.0', 8, 'ipv4')
hostLocalAddresses.addAddress('::', 'ipv6')
hostLocalAddresses.addAddress('::1', 'ipv6')

function isHostLocalAddress(address: string): boolean {
  const family = isIP(address)
  return family !== 0 && hostLocalAddresses.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

/** Applies to browser destinations, never to the administrator's upstream endpoint. */
export function assertProxyDestination(hostname: string): void {
  let host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
  if (isIP(host) === 0) {
    // URL canonicalization also covers integer, hexadecimal and shortened IPv4.
    host = new URL(`http://${host}`).hostname.replace(/^\[|\]$/gu, '')
  }
  if (host === 'localhost' || host.endsWith('.localhost') || isHostLocalAddress(host)) {
    throw new RequestError('Profile destination is not permitted', 403)
  }
}

// Resolve and validate in the socket's lookup callback, not in a preflight DNS
// query which could return a different address from the subsequent connection.
const lookupDestination: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, options, (error, address, family) => {
    if (error !== null) {
      callback(error, address, family)
      return
    }
    const addresses =
      typeof address === 'string' ? [address] : address.map((entry) => entry.address)
    if (addresses.some(isHostLocalAddress)) {
      callback(
        Object.assign(new Error('Profile destination is not permitted'), { code: 'EACCES' }),
        '',
        0,
      )
      return
    }
    callback(null, address, family)
  })
}

// proxy-chain types this hook as every dns.lookup overload, but invokes it only
// through Node HTTP/net's LookupFunction contract (including all:true).
export const lookupProxyDestination = lookupDestination as typeof lookup
