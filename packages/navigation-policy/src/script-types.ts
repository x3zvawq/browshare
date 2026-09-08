export type ScriptResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'SCRIPT_ERROR' | 'SCRIPT_TIMEOUT' | 'SCRIPT_BUSY' | 'SCRIPT_INVALID' }

export interface ScriptJob {
  source: string
  input: string
  validateOnly: boolean
}
