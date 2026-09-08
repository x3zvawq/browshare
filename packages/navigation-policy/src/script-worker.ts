import { parentPort } from 'node:worker_threads'
import { newQuickJSWASMModule, newVariant, RELEASE_SYNC } from 'quickjs-emscripten'
import type { ScriptJob, ScriptResult } from './script-types.js'

// No host functions or module loader are installed. Fixed WASM memory also bounds allocations
// outside QuickJS's own heap accounting. A parent watchdog can terminate native interpreter work.
const engine = await newQuickJSWASMModule(
  newVariant(RELEASE_SYNC, {
    wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: 1024 }),
  }),
)
function execute(job: ScriptJob): ScriptResult {
  const runtime = engine.newRuntime()
  runtime.setMemoryLimit(8 * 1024 * 1024)
  runtime.setMaxStackSize(256 * 1024)
  const deadline = performance.now() + 50
  let interrupted = false
  runtime.setInterruptHandler(() => (interrupted ||= performance.now() >= deadline))
  const context = runtime.newContext()
  try {
    // Function construction validates a body without running it. Input is JSON data in a distinct
    // argument, not source interpolation. Each navigation receives a fresh global environment.
    using source = context.newString(job.source)
    context.setProp(context.global, '__source', source)
    using input = context.newString(job.input)
    context.setProp(context.global, '__input', input)
    const wrapper = job.validateOnly
      ? `new Function("input", '"use strict";\\n' + __source); "null"`
      : `(() => {
          const stringify = JSON.stringify;
          const evaluate = new Function('input', '"use strict";\\n' + __source);
          const input = JSON.parse(__input);
          delete globalThis.__source; delete globalThis.__input;
          const result = evaluate(input);
          if (result === null) return 'null';
          if (typeof result !== 'object' || result === null || Array.isArray(result) ||
              Object.getPrototypeOf(result) !== Object.prototype) return '!invalid';
          const fields = Object.keys(result);
          if (fields.some(key => key !== 'action' && key !== 'redirectUrl')) return '!invalid';
          const action = result.action;
          const redirectUrl = result.redirectUrl;
          if (typeof action !== 'string' || action.length > 32 ||
              (redirectUrl !== undefined && (typeof redirectUrl !== 'string' || redirectUrl.length > 16384))) return '!invalid';
          return stringify({ action, ...(redirectUrl === undefined ? {} : { redirectUrl }) });
        })()`
    using result = context.evalCode(wrapper, 'navigation-policy.js', { type: 'global' })
    if (result.error) return { ok: false, reason: interrupted ? 'SCRIPT_TIMEOUT' : 'SCRIPT_ERROR' }
    const value = context.getString(result.value)
    return value === '!invalid' || value.length > 20000
      ? { ok: false, reason: 'SCRIPT_INVALID' }
      : { ok: true, value }
  } finally {
    context.dispose()
    runtime.dispose()
  }
}
parentPort!.on('message', (job: ScriptJob) => {
  try {
    parentPort!.postMessage(execute(job))
  } catch {
    parentPort!.postMessage({ ok: false, reason: 'SCRIPT_ERROR' } satisfies ScriptResult)
  }
})
parentPort!.postMessage('ready')
