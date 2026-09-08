import { execFile, fork, type ChildProcess } from 'node:child_process'
import { chmod, lstat, mkdir, readFile, readlink, readdir, rm, rmdir } from 'node:fs/promises'
import { hostname } from 'node:os'
import { promisify } from 'node:util'
import { isAbsolute, join } from 'node:path'
import { Readable, Writable } from 'node:stream'

import { isPublicId } from '@browshare/common'

import { CdpPipeBridge } from './cdp-pipe-bridge.js'

import {
  ProfileProxyAdapter,
  type ProfileProxyConfiguration,
  type ProxyHealthResult,
} from './proxy-adapter.js'

export interface ProfileChromeConfiguration {
  readonly profileId: string
  readonly storageDirectory: string
  readonly requireExistingData?: boolean
  readonly chromeExecutable: string
  readonly expectedChromeVersion: string
  readonly extensionId: string
  readonly bypassEndpoints: readonly { readonly host: '127.0.0.1' | '::1'; readonly port: number }[]
  readonly proxy: ProfileProxyConfiguration
  readonly healthcheckUrl?: string
  readonly startupTimeoutMilliseconds?: number
  readonly shutdownTimeoutMilliseconds?: number
}

export interface ProfileChromeAddress {
  readonly cdpEndpoint: string
  readonly chromeProcessId: number
  readonly profileDirectory: string
  readonly proxyHealth: ProxyHealthResult | null
}

export interface ProfileChromeExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

export class ProfileChromeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ProfileChromeError'
  }
}

/** Owns one persistent Chrome process and its immutable network route. Linux Worker only. */
export class ProfileChromeRuntime {
  readonly #configuration: ProfileChromeConfiguration
  readonly #adapter: ProfileProxyAdapter
  readonly #abort = new AbortController()
  #child: ChildProcess | undefined
  #processGroupId: number | undefined
  #processExit: Promise<ProfileChromeExit> | undefined
  #exit: ProfileChromeExit | undefined
  #startPromise: Promise<ProfileChromeAddress> | undefined
  #stopPromise: Promise<void> | undefined
  #terminationPromise: Promise<void> | undefined
  #bridge: CdpPipeBridge | undefined
  #healthCheck: Promise<ProxyHealthResult> | undefined
  #closed = false

  constructor(configuration: ProfileChromeConfiguration) {
    if (!isPublicId(configuration.profileId)) throw new TypeError('Profile ID must be a UUIDv7')
    if (!/^[a-p]{32}$/u.test(configuration.extensionId)) throw new TypeError('Invalid Extension ID')
    for (const endpoint of configuration.bypassEndpoints) {
      if (
        !['127.0.0.1', '::1'].includes(endpoint.host) ||
        !Number.isInteger(endpoint.port) ||
        endpoint.port < 1 ||
        endpoint.port > 65_535
      ) {
        throw new TypeError('Runtime bypass endpoints must be explicit loopback ports')
      }
    }
    for (const timeout of [
      configuration.startupTimeoutMilliseconds ?? 30_000,
      configuration.shutdownTimeoutMilliseconds ?? 10_000,
    ]) {
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120_000)
        throw new RangeError('Invalid Chrome lifecycle timeout')
    }
    if (!isAbsolute(configuration.storageDirectory))
      throw new TypeError('Profile storage path must be absolute')
    if (configuration.healthcheckUrl === undefined && configuration.proxy.type !== 'DIRECT')
      throw new TypeError('An upstream Proxy requires a health check before Chrome startup')
    this.#configuration = {
      ...configuration,
      bypassEndpoints: configuration.bypassEndpoints.map((endpoint) => ({ ...endpoint })),
    }
    this.#adapter = new ProfileProxyAdapter(configuration.proxy)
  }

  start(): Promise<ProfileChromeAddress> {
    if (this.#closed)
      return Promise.reject(new ProfileChromeError('RUNTIME_CLOSED', 'Profile Runtime is closed'))
    this.#startPromise ??= this.#start()
    return this.#startPromise
  }

  checkRouteHealth(): Promise<ProxyHealthResult> {
    this.#assertOpen()
    const url = this.#configuration.healthcheckUrl
    if (url === undefined) throw new Error('Profile has no route health check URL')
    // Sessions sharing a Profile share its adapter and concurrent health observation.
    this.#healthCheck ??= this.#adapter.checkHealth(url).finally(() => {
      this.#healthCheck = undefined
    })
    return this.#healthCheck
  }

  cancelRouteHealthChecks(): void {
    this.#adapter.cancelChecks()
  }

  /** Available after start; cleanup runs even when nobody is observing the exit. */
  get exited(): Promise<ProfileChromeExit> {
    if (this.#processExit === undefined) throw new Error('Chrome has not been launched')
    return this.#processExit
  }

  stop(): Promise<void> {
    this.#closed = true
    this.#abort.abort()
    this.#adapter.cancelChecks()
    this.#stopPromise ??= (async () => {
      // A health check may still be waiting for an upstream when stop arrives.
      if (this.#child === undefined) await this.#adapter.close()
      await this.#startPromise?.catch(() => undefined)
      await this.#terminate()
      await this.#adapter.close()
    })()
    return this.#stopPromise
  }

  async #start(): Promise<ProfileChromeAddress> {
    const config = this.#configuration
    if (process.platform !== 'linux')
      throw new ProfileChromeError(
        'WORKER_PLATFORM_UNSUPPORTED',
        'Managed Profile Chrome requires Linux',
      )
    const directory = join(config.storageDirectory, config.profileId)
    try {
      // Check before mkdir: a replaced volume must not become a new logged-out Profile.
      if (config.requireExistingData) await assertProfileDataExists(directory)
      await ensurePrivateDirectory(config.storageDirectory)
      await ensurePrivateDirectory(directory)
      await assertNoLiveChrome(directory)
      await this.#adapter.start()
      // Node capability probes have no business upstream. Profile starts always supply a URL.
      const proxyHealth =
        config.healthcheckUrl === undefined
          ? null
          : await this.#adapter.checkHealth(config.healthcheckUrl)
      if (proxyHealth !== null && proxyHealth.status !== 'HEALTHY')
        throw new ProfileChromeError(
          'PROXY_UNHEALTHY',
          'The configured Profile route did not pass its health check',
        )
      this.#assertOpen()
      const bypass = [
        '<-loopback>',
        ...config.bypassEndpoints.map((e) => `${e.host === '::1' ? '[::1]' : e.host}:${e.port}`),
      ].join(';')
      // The IPC supervisor cleans this Chrome group if the Worker dies. flock retains
      // the advisory lock outside Chrome's descriptor cleanup.
      // The lock file stays in place: unlinking it would allow another inode to be locked.
      const child = fork(
        new URL('./profile-chrome-supervisor.mjs', import.meta.url),
        [
          String(config.shutdownTimeoutMilliseconds ?? 10_000),
          '--nonblock',
          '--conflict-exit-code',
          '73',
          '--close',
          join(directory, '.browshare-runtime.lock'),
          config.chromeExecutable,
          '--headless=new',
          '--enable-extensions',
          '--remote-debugging-pipe',
          `--user-data-dir=${directory}`,
          `--allowlisted-extension-id=${config.extensionId}`,
          `--proxy-server=${this.#adapter.address.url}`,
          `--proxy-bypass-list=${bypass}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--noerrdialogs',
          '--ozone-platform=headless',
          '--ozone-override-screen-size=1920,1080',
          '--use-angle=swiftshader-webgl',
          'about:blank',
        ],
        { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc', 'pipe', 'pipe'] },
      )
      this.#child = child
      // Chrome stderr may contain page URLs; drain it without logging or parsing.
      child.stderr?.resume()
      const groupReady = new Promise<number>((resolve, reject) => {
        child.on('message', (message: { type?: string; pid?: number }) => {
          if (message.type === 'chrome-process-group' && Number.isSafeInteger(message.pid)) {
            this.#processGroupId = message.pid!
            resolve(message.pid!)
          }
        })
        child.once('error', () =>
          reject(
            new ProfileChromeError('CHROME_LAUNCH_FAILED', 'Chrome supervisor could not start'),
          ),
        )
        child.once('exit', () =>
          reject(
            new ProfileChromeError(
              'CHROME_START_FAILED',
              'Chrome supervisor exited before readiness',
            ),
          ),
        )
      })
      void groupReady.catch(() => undefined)
      this.#processExit = new Promise((resolve, reject) => {
        const finish = (exit: ProfileChromeExit) => {
          if (this.#exit !== undefined) return
          this.#exit = exit
          this.#closed = true
          // The supervisor waits for Chrome descendants, including after flock exits.
          // Verify the group is gone before exposing exit or releasing the Proxy.
          void (async () => {
            await this.#bridge?.close()
            await drainProcessGroup(
              this.#processGroupId,
              config.shutdownTimeoutMilliseconds ?? 10_000,
            )
            await this.#adapter.close()
            resolve(exit)
          })().catch(reject)
        }
        child.once('error', () => finish({ code: null, signal: null }))
        child.once('close', (code, signal) => finish({ code, signal }))
      })
      void this.#processExit.catch(() => undefined)
      const readable = child.stdio.at(5)
      const writable = child.stdio.at(4)
      if (!(readable instanceof Readable) || !(writable instanceof Writable))
        throw new ProfileChromeError('CHROME_LAUNCH_FAILED', 'Chrome debugging pipes are missing')
      this.#bridge = new CdpPipeBridge(readable, writable, () => {
        this.#signal('SIGTERM')
        // Broken transport must also drain a frozen Chrome; TERM alone cannot
        // end SIGSTOP. The existing process-exit promise retains cleanup errors.
        void this.#terminate().catch(() => undefined)
      })
      const cdpEndpoint = await this.#bridge.start()
      const product = await waitForPipeBrowser(
        child,
        this.#bridge,
        this.#abort.signal,
        config.startupTimeoutMilliseconds ?? 30_000,
      )
      const processGroupId = await groupReady
      if (product !== `Chrome/${config.expectedChromeVersion}`)
        throw new ProfileChromeError(
          'CHROME_VERSION_MISMATCH',
          'Chrome does not match the coordinated Worker release',
        )
      const children = (
        await readFile(`/proc/${processGroupId}/task/${processGroupId}/children`, 'utf8')
      )
        .trim()
        .split(/\s+/u)
      const chromeProcessId = Number(children[0])
      if (children.length !== 1 || !Number.isSafeInteger(chromeProcessId) || chromeProcessId < 1)
        throw new ProfileChromeError(
          'CHROME_PROCESS_UNAVAILABLE',
          'Could not identify the owned Chrome process',
        )
      // A Profile upgraded from TCP CDP can retain Chrome's old endpoint file.
      // Remove it only after this pipe Chrome demonstrably holds the Profile lock.
      await rm(join(directory, 'DevToolsActivePort'), { force: true })
      this.#assertOpen()
      if (this.#exit !== undefined)
        throw new ProfileChromeError('CHROME_EXITED', 'Chrome exited during startup')
      return { cdpEndpoint, chromeProcessId, profileDirectory: directory, proxyHealth }
    } catch (cause) {
      this.#closed = true
      await this.#terminate()
      await this.#adapter.close()
      throw cause
    }
  }

  #assertOpen(): void {
    if (this.#closed)
      throw new ProfileChromeError('RUNTIME_CLOSED', 'Profile Runtime startup was cancelled')
  }

  #signal(signal: NodeJS.Signals): void {
    if (this.#processGroupId === undefined) this.#child?.kill(signal)
    else signalGroup(this.#processGroupId, signal)
  }

  #terminate(): Promise<void> {
    this.#terminationPromise ??= this.#terminateOwned()
    return this.#terminationPromise
  }

  async #terminateOwned(): Promise<void> {
    if (this.#child === undefined) return
    if (this.#exit !== undefined) {
      await this.#processExit
      return
    }
    const grace = this.#configuration.shutdownTimeoutMilliseconds ?? 10_000
    if (this.#bridge !== undefined) await this.#bridge.closeBrowser(Math.min(grace, 2_000))
    else this.#signal('SIGTERM')
    if (await waitForExit(this.#processExit!, grace)) return
    this.#signal('SIGTERM')
    if (await waitForExit(this.#processExit!, 2_000)) return
    this.#signal('SIGKILL')
    await this.#processExit
  }
}

async function assertProfileDataExists(directory: string): Promise<void> {
  try {
    const directoryInfo = await lstat(directory)
    const stateInfo = await lstat(join(directory, 'Local State'))
    if (directoryInfo.isDirectory() && stateInfo.isFile() && stateInfo.size > 0) return
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
  throw new ProfileChromeError(
    'PROFILE_DATA_MISSING',
    'Persistent Profile data is missing. Restore its archive on the original Worker before starting.',
  )
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.uid !== process.getuid!())
    throw new ProfileChromeError(
      'PROFILE_DIRECTORY_OWNERSHIP',
      'Profile storage must be a directory owned by the Worker user',
    )
  if ((info.mode & 0o777) !== 0o700) await chmod(directory, 0o700)
}

async function assertNoLiveChrome(directory: string): Promise<void> {
  let lock: string
  try {
    lock = await readlink(join(directory, 'SingletonLock'))
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new ProfileChromeError(
      'PROFILE_LOCK_INVALID',
      'Chrome Profile has an unreadable singleton lock',
    )
  }
  const separator = lock.lastIndexOf('-')
  const pid = Number(lock.slice(separator + 1))
  if (lock.slice(0, separator) !== hostname() || !Number.isSafeInteger(pid) || pid < 1)
    throw new ProfileChromeError(
      'PROFILE_LOCKED',
      'Chrome Profile is locked by another host or an unknown process',
    )
  try {
    process.kill(pid, 0)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ESRCH') return // Chrome removes its own stale native lock.
    throw new ProfileChromeError('PROFILE_LOCKED', 'Chrome Profile lock owner cannot be inspected')
  }
  throw new ProfileChromeError('PROFILE_LOCKED', 'Chrome Profile is already held by a live process')
}

function waitForPipeBrowser(
  child: ChildProcess,
  bridge: CdpPipeBridge,
  signal: AbortSignal,
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let finished = false
    const finish = (cause?: Error, endpoint?: string) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      child.off('error', error)
      child.off('exit', exit)
      signal.removeEventListener('abort', abort)
      if (cause !== undefined) reject(cause)
      else resolve(endpoint!)
    }
    const error = () =>
      finish(
        new ProfileChromeError(
          'CHROME_LAUNCH_FAILED',
          'Chrome or the Profile lock helper could not start',
        ),
      )
    const exit = (code: number | null) =>
      finish(
        new ProfileChromeError(
          code === 73 ? 'PROFILE_LOCKED' : 'CHROME_START_FAILED',
          'Chrome exited before its debugger became ready',
        ),
      )
    const abort = () =>
      finish(new ProfileChromeError('RUNTIME_CLOSED', 'Profile Runtime startup was cancelled'))
    const timer = setTimeout(
      () => finish(new ProfileChromeError('CHROME_START_TIMEOUT', 'Chrome startup timed out')),
      timeout,
    )
    child.once('error', error)
    child.once('exit', exit)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    void bridge.getVersion(timeout, signal).then(
      (product) => finish(undefined, product),
      () => finish(new ProfileChromeError('CHROME_START_FAILED', 'Chrome debugging pipe failed')),
    )
  })
}

async function waitForExit(exit: Promise<ProfileChromeExit>, timeout: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      exit.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeout)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return
  try {
    process.kill(-pid, signal)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause
  }
}

async function drainProcessGroup(pid: number | undefined, grace: number): Promise<void> {
  if (await waitForProcessGroup(pid, grace)) return
  signalGroup(pid, 'SIGTERM')
  if (await waitForProcessGroup(pid, 2_000)) return
  signalGroup(pid, 'SIGKILL')
  if (!(await waitForProcessGroup(pid, 2_000)))
    throw new ProfileChromeError('CHROME_STOP_TIMEOUT', 'Chrome process group did not exit')
}

async function waitForProcessGroup(pid: number | undefined, timeout: number): Promise<boolean> {
  if (pid === undefined) return true
  const deadline = Date.now() + timeout
  while (true) {
    try {
      process.kill(-pid, 0)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ESRCH') return true
      throw cause
    }
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** Delete only after the Chrome supervisor has drained the process group and released its lock. */
export async function deleteProfileDirectory(
  storageDirectory: string,
  profileId: string,
): Promise<void> {
  if (!isAbsolute(storageDirectory) || !isPublicId(profileId))
    throw new TypeError('Invalid Profile storage identity')
  const directory = join(storageDirectory, profileId)
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.uid !== process.getuid!())
      throw new ProfileChromeError(
        'PROFILE_DIRECTORY_OWNERSHIP',
        'Profile storage must be a directory owned by the Worker user',
      )
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    throw cause
  }
  await assertNoLiveChrome(directory)
  try {
    await promisify(execFile)('flock', [
      '--nonblock',
      '--conflict-exit-code',
      '73',
      join(directory, '.browshare-runtime.lock'),
      'rm',
      '-rf',
      '--',
      directory,
    ])
  } catch (cause) {
    if ((cause as { code?: unknown }).code === 73)
      throw new ProfileChromeError(
        'PROFILE_LOCKED',
        'The Profile Runtime is still releasing its storage lock',
      )
    throw new ProfileChromeError(
      'PROFILE_DIRECTORY_DELETE_FAILED',
      'The Profile directory could not be removed',
    )
  }
}

/** Only our exact mkdtemp probe layout is reclaimable; live or uncertain Chrome ownership fails closed. */
export async function cleanupCapabilityDirectories(temporaryDirectory: string): Promise<void> {
  for (const entry of await readdir(temporaryDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\.capability-[A-Za-z0-9]{6}$/.test(entry.name)) continue
    const directory = join(temporaryDirectory, entry.name)
    const info = await lstat(directory)
    if (!info.isDirectory() || info.uid !== process.getuid!()) continue
    const children = await readdir(directory, { withFileTypes: true })
    if (children.some((child) => !child.isDirectory() || !isPublicId(child.name))) continue
    for (const child of children) await deleteProfileDirectory(directory, child.name)
    // rmdir preserves anything unexpected that appeared after inspection.
    await rmdir(directory)
  }
}
