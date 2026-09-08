import { integer, secret } from '@browshare/config'

// Share configuration semantics with the service, including Secret files and port overrides.
try {
  const service = process.argv[2]
  const endpoints = {
    backend: ['BROWSHARE_BACKEND_PORT', 3400, '/health/ready'],
    gateway: ['BROWSHARE_GATEWAY_HEALTH_PORT', 3482, '/health/ready'],
    worker: ['BROWSHARE_WORKER_HEALTH_PORT', 3410, '/health/live'],
  }
  const endpoint = endpoints[service]
  if (endpoint === undefined) throw new Error('Unknown service')
  const [name, defaultValue, path] = endpoint
  const port = integer(process.env, name, { defaultValue, minimum: 1, maximum: 65535 })
  const headers =
    service === 'gateway'
      ? { authorization: `Bearer ${secret(process.env, 'BROWSHARE_GATEWAY_SECRET')}` }
      : {}
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(6000),
  })
  await response.body?.cancel()
  process.exitCode = response.ok ? 0 : 1
} catch {
  // Docker stores probe output; never include secrets or server response bodies.
  process.exitCode = 1
}
