import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const workspace = resolve(import.meta.dirname, '..')
const common = await import(resolve(workspace, 'packages/common/dist/index.mjs'))
const configuration = await import(resolve(workspace, 'packages/config/dist/index.mjs'))
const apiClient = await import(resolve(workspace, 'packages/api-client/dist/index.mjs'))
const backend = await import(resolve(workspace, 'apps/backend/dist/index.mjs'))
const worker = await import(resolve(workspace, 'apps/worker/dist/index.mjs'))

const publicId = common.createPublicId()
assert.equal(common.isPublicId(publicId), true)
const cursor = common.encodePageCursor({ id: publicId, createdAt: '2026-09-04T00:00:00.000Z' })
assert.deepEqual(common.decodePageCursor(cursor), {
  id: publicId,
  createdAt: '2026-09-04T00:00:00.000Z',
})
assert.equal(common.normalizePageLimit(undefined), 50)

const secretDirectory = await mkdtemp(resolve(tmpdir(), 'browshare-foundation-'))
const secretPath = resolve(secretDirectory, 'session-secret')
await writeFile(secretPath, 'foundation-smoke-secret-000000000001\n', { mode: 0o600 })
try {
  assert.equal(
    configuration.secret(
      { BROWSHARE_SESSION_SECRET_FILE: secretPath },
      'BROWSHARE_SESSION_SECRET',
      { minLength: 32 },
    ),
    'foundation-smoke-secret-000000000001',
  )
  assert.throws(
    () =>
      configuration.secret(
        {
          BROWSHARE_SESSION_SECRET: 'foundation-smoke-secret-000000000001',
          BROWSHARE_SESSION_SECRET_FILE: secretPath,
        },
        'BROWSHARE_SESSION_SECRET',
      ),
    /Set only one/u,
  )
} finally {
  await rm(secretDirectory, { recursive: true, force: true })
}

const app = await backend.createBackendApp(
  {
    host: '127.0.0.1',
    port: 0,
    databaseUrl: 'postgresql://smoke:smoke@127.0.0.1/smoke',
    allowedOrigins: ['http://127.0.0.1:5173'],
    sessionSecret: 'foundation-smoke-secret-000000000001',
    cookieSecure: false,
    logLevel: 'silent',
    docsEnabled: false,
    workerControlUrl: 'wss://127.0.0.1:3400/api/v1/worker-control',
    workerControlListener: {
      host: '127.0.0.1',
      port: 0,
      tlsCertificatePem: 'smoke-only',
      tlsPrivateKeyPem: 'smoke-only',
      helloTimeoutMilliseconds: 10_000,
      heartbeatIntervalMilliseconds: 10_000,
    },
    workerCertificateAuthority: {
      certificatePem: 'smoke-only',
      privateKeyPem: 'smoke-only',
      certificateValidityDays: 90,
    },
  },
  {
    authentication: {
      getPublicConfiguration: async () => ({
        registrationOpen: false,
        emailVerificationRequired: false,
      }),
      login: async () => assert.fail('login should not run in the foundation smoke'),
      register: async () => assert.fail('register should not run in the foundation smoke'),
      authenticate: async () => undefined,
      logout: async () => undefined,
      changePassword: async () =>
        assert.fail('change password should not run in the foundation smoke'),
      resetUserPassword: async () =>
        assert.fail('password reset should not run in the foundation smoke'),
      listSessions: async () => [],
      revokeSession: async () =>
        assert.fail('session revoke should not run in the foundation smoke'),
      revokeAllSessions: async () =>
        assert.fail('session revoke should not run in the foundation smoke'),
    },
    authorization: {
      listUserPermissionCodes: async () => [],
      hasPermission: async () => false,
      requirePermission: async () =>
        assert.fail('authorization should not run in the foundation smoke'),
    },
    readiness: async () => ({
      status: 'ready',
      checks: {
        process: 'ready',
        configuration: 'smoke',
        database: 'smoke',
        migrations: 'smoke',
        bootstrap: 'smoke',
      },
    }),
    users: {
      list: async () => assert.fail('user list should not run in the foundation smoke'),
      get: async () => assert.fail('user get should not run in the foundation smoke'),
      create: async () => assert.fail('user create should not run in the foundation smoke'),
      update: async () => assert.fail('user update should not run in the foundation smoke'),
      setState: async () => assert.fail('user state should not run in the foundation smoke'),
      delete: async () => assert.fail('user delete should not run in the foundation smoke'),
      setRoles: async () => assert.fail('user roles should not run in the foundation smoke'),
      listRoles: async () => assert.fail('role list should not run in the foundation smoke'),
    },
    workerEnrollments: {
      list: async () => assert.fail('enrollment list should not run in the foundation smoke'),
      create: async () => assert.fail('enrollment create should not run in the foundation smoke'),
      revoke: async () => assert.fail('enrollment revoke should not run in the foundation smoke'),
    },
    workerRegistration: {
      register: async () =>
        assert.fail('worker registration should not run in the foundation smoke'),
    },
  },
)
try {
  const liveness = await app.inject({ method: 'GET', url: '/health/live' })
  assert.equal(liveness.statusCode, 200)
  assert.equal(liveness.json().service, 'backend')

  const readiness = await app.inject({ method: 'GET', url: '/health/ready' })
  assert.equal(readiness.statusCode, 200)
  assert.equal(readiness.json().status, 'ready')

  const version = await app.inject({ method: 'GET', url: '/api/v1/version' })
  assert.equal(version.statusCode, 200)
  assert.equal(version.json().version, '0.1.0')

  const missing = await app.inject({ method: 'GET', url: '/api/v1/missing' })
  assert.equal(missing.statusCode, 404)
  assert.equal(missing.json().error.code, 'NOT_FOUND')
  assert.equal(typeof missing.json().error.requestId, 'string')
} finally {
  await app.close()
}

const daemon = new worker.WorkerDaemon({
  name: 'foundation-smoke',
  healthHost: '127.0.0.1',
  healthPort: 0,
  logLevel: 'silent',
})
const address = await daemon.start()
try {
  const liveness = await fetch(`http://${address.host}:${address.port}/health/live`)
  assert.equal(liveness.status, 200)
  assert.equal((await liveness.json()).service, 'worker')

  const readiness = await fetch(`http://${address.host}:${address.port}/health/ready`)
  assert.equal(readiness.status, 503)
  assert.equal((await readiness.json()).checks.backendControl, 'not-connected')
} finally {
  await daemon.close()
}

const openApi = JSON.parse(await readFile(resolve(workspace, 'apps/backend/openapi.json'), 'utf8'))
assert.equal(openApi.info.version, '0.1.0')
assert.ok(openApi.servers.some((server) => server.url === '/api/v1'))
assert.ok(openApi.paths['/version'])
assert.ok(openApi.paths['/health/live'])
assert.equal(apiClient.DEFAULT_API_BASE_URL, '/api/v1')

await stat(resolve(workspace, 'packages/api-client/src/generated.ts'))
await stat(resolve(workspace, 'apps/portal/dist/index.html'))

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'passed',
      publicIdVersion: 7,
      backend: ['liveness', 'readiness', 'version', 'not-found'],
      worker: ['liveness', 'honest-not-ready'],
      openApiPaths: Object.keys(openApi.paths).length,
      portalBuild: 'present',
    },
    null,
    2,
  )}\n`,
)
