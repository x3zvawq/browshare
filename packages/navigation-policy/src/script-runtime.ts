import { Worker } from 'node:worker_threads'
import type { ScriptJob, ScriptResult } from './script-types.js'

interface Pending {
  job: ScriptJob
  resolve: (result: ScriptResult) => void
}
const queue: Pending[] = []
let worker: Worker | undefined
let current: Pending | undefined
let ready = false
let terminating = false
let watchdog: NodeJS.Timeout | undefined
let idle: NodeJS.Timeout | undefined

function stop(reason: 'SCRIPT_ERROR' | 'SCRIPT_TIMEOUT') {
  const previous = worker
  worker = undefined
  ready = false
  clearTimeout(watchdog)
  current?.resolve({ ok: false, reason })
  current = undefined
  for (const item of queue.splice(0)) item.resolve({ ok: false, reason })
  terminating = true
  // Termination completes before replacement, keeping the number of live interpreters bounded.
  void (previous?.terminate() ?? Promise.resolve()).finally(() => {
    terminating = false
    dispatch()
  })
}
function dispatch() {
  if (current || terminating) return
  clearTimeout(idle)
  if (!queue.length) {
    worker?.unref()
    if (worker) {
      idle = setTimeout(() => stop('SCRIPT_ERROR'), 30_000)
      idle.unref()
    }
    return
  }
  if (!worker) {
    const created = new Worker(new URL('./script-worker.mjs', import.meta.url), {
      env: {},
      execArgv: [],
      stdout: true,
      stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    })
    worker = created
    // Interpreter diagnostics can contain source or URLs, so they never enter application logs.
    created.stdout.resume()
    created.stderr.resume()
    watchdog = setTimeout(() => {
      if (worker === created) stop('SCRIPT_TIMEOUT')
    }, 5000)
    created.on('error', () => {
      if (worker === created) stop('SCRIPT_ERROR')
    })
    created.on('exit', () => {
      if (worker === created) stop('SCRIPT_ERROR')
    })
    created.on('message', (result: ScriptResult | 'ready') => {
      if (worker !== created) return
      clearTimeout(watchdog)
      if (result === 'ready') ready = true
      else {
        current?.resolve(result)
        current = undefined
      }
      dispatch()
    })
  }
  if (!ready) return
  current = queue.shift()!
  worker.ref()
  worker.postMessage(current.job)
  watchdog = setTimeout(() => stop('SCRIPT_TIMEOUT'), 250)
}
export function runPolicyScript(
  source: string,
  input: unknown,
  validateOnly = false,
): Promise<ScriptResult> {
  if (queue.length >= 16) return Promise.resolve({ ok: false, reason: 'SCRIPT_BUSY' })
  return new Promise((resolve) => {
    queue.push({ job: { source, input: JSON.stringify(input), validateOnly }, resolve })
    dispatch()
  })
}

/** Release the shared interpreter during Backend/Worker shutdown. */
export async function closeNavigationScriptRuntime() {
  clearTimeout(watchdog)
  clearTimeout(idle)
  for (const item of queue.splice(0)) item.resolve({ ok: false, reason: 'SCRIPT_ERROR' })
  current?.resolve({ ok: false, reason: 'SCRIPT_ERROR' })
  current = undefined
  const previous = worker
  worker = undefined
  ready = false
  await previous?.terminate()
}
