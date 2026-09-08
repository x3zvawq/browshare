import { spawn } from 'node:child_process'
import { closeSync } from 'node:fs'

// IPC closes even when the Worker is SIGKILLed. This process owns only its flock/Chrome
// group and survives long enough to release the Profile before a new Worker can use it.
const grace = Number(process.argv[2])
if (!process.connected || !Number.isInteger(grace) || grace < 1 || grace > 120_000)
  throw new Error('Chrome supervisor requires a Worker IPC channel and shutdown timeout')

let child
let cleanup
let ownerDisconnected = false
process.stderr.on('error', () => {}) // The Worker may close its stderr pipe before disconnect arrives.
process.once('disconnect', stop)
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

function signalGroup(signal) {
  if (child?.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch (cause) {
    if (cause.code !== 'ESRCH') throw cause
  }
}

async function waitForGroup(timeout) {
  if (child?.pid === undefined) return true
  const deadline = Date.now() + timeout
  while (true) {
    try {
      process.kill(-child.pid, 0)
    } catch (cause) {
      if (cause.code === 'ESRCH') return true
      throw cause
    }
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function stop() {
  ownerDisconnected = true
  signalGroup('SIGTERM')
  finish(null, 'SIGTERM')
}

function finish(code, signal) {
  if (cleanup !== undefined) return
  cleanup = (async () => {
    if (!(await waitForGroup(grace))) {
      signalGroup('SIGTERM')
      if (!(await waitForGroup(2000))) {
        signalGroup('SIGKILL')
        if (!(await waitForGroup(2000))) throw new Error('Chrome group did not exit')
      }
    }
    if (process.connected) process.disconnect()
    if (signal !== null) {
      process.removeAllListeners(signal)
      process.kill(process.pid, signal)
    } else process.exitCode = code ?? 1
  })().catch(() => {
    signalGroup('SIGKILL')
    if (process.connected) process.disconnect()
    process.exitCode = 74
  })
}

child = spawn('/usr/bin/flock', process.argv.slice(3), {
  detached: true,
  // Worker IPC stays on fd3. Its extra fd4/fd5 are inherited by Chrome as
  // debugging read/write fd3/fd4, independently of the Profile lock descriptor.
  stdio: ['ignore', 'ignore', 'pipe', 4, 5],
})
// Only Chrome/flock may retain these pipe ends. Keeping supervisor copies would
// hide Chrome's pipe EOF from the Worker after an unexpected browser exit.
closeSync(4)
closeSync(5)
child.stderr.on('data', (data) => {
  if (process.connected) process.stderr.write(data)
})
child.once('error', () => finish(1, null))
child.once('close', (code, signal) => finish(code, signal))
if (child.pid !== undefined && process.connected)
  process.send({ type: 'chrome-process-group', pid: child.pid }, (error) => {
    if (error) stop()
  })
if (!process.connected || ownerDisconnected) stop()
