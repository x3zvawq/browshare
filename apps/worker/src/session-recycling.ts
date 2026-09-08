import type {
  SessionPolicyValues,
  SessionRecycleReason,
  SessionRecycleState,
} from '@browshare/contracts'

/** Worker-owned policy clock; authorization leases remain a separate, mandatory boundary. */
export class SessionRecycling {
  readonly #policy: Readonly<SessionPolicyValues>
  #disconnectedAt: number | null
  #lastInputAt: number
  #lastFrameChangedAt: number
  #continuedAt: number
  #proxyFailedAt: number | null = null

  constructor(
    policy: SessionPolicyValues,
    private readonly createdAt: number,
    readyAt: number,
  ) {
    this.#policy = Object.freeze({ ...policy })
    this.#disconnectedAt = readyAt
    this.#lastInputAt = readyAt
    this.#lastFrameChangedAt = readyAt
    this.#continuedAt = readyAt
  }

  viewerConnected(connected: boolean, now: number): void {
    if (connected) this.#disconnectedAt = null
    else this.#disconnectedAt ??= now
  }

  input(now: number): void {
    this.#lastInputAt = now
  }

  frameChanged(now: number): void {
    this.#lastFrameChangedAt = now
  }

  proxyHealthy(healthy: boolean, now: number): void {
    if (healthy) this.#proxyFailedAt = null
    else this.#proxyFailedAt ??= now
  }

  continue(now: number): void {
    // A deliberate continuation resets soft idle conditions, not connection or hard limits.
    this.#continuedAt = now
  }

  next(): SessionRecycleState | null {
    const p = this.#policy
    if (p.recycleDisabled) return null
    const deadlines: Array<{ reason: SessionRecycleReason; at: number; canContinue: boolean }> = []
    const add = (
      reason: SessionRecycleReason,
      since: number | null,
      timeout: number | null,
      canContinue = false,
    ) => {
      if (since !== null && timeout !== null)
        deadlines.push({ reason, at: since + timeout * 1000, canContinue })
    }
    // Stable tie ordering gives hard limits precedence over resettable idle limits.
    add('MAX_DURATION', this.createdAt, p.maxDurationSeconds)
    add('PROXY_FAILURE', this.#proxyFailedAt, p.proxyFailureTimeoutSeconds)
    add('VIEWER_DISCONNECTED', this.#disconnectedAt, p.viewerDisconnectTimeoutSeconds)
    add('NO_INPUT', Math.max(this.#lastInputAt, this.#continuedAt), p.noInputTimeoutSeconds, true)
    add(
      'NO_FRAME_CHANGE',
      Math.max(this.#lastInputAt, this.#lastFrameChangedAt, this.#continuedAt),
      p.noFrameChangeTimeoutSeconds,
      true,
    )
    const first = deadlines.sort((a, b) => a.at - b.at)[0]
    return first
      ? {
          reason: first.reason,
          deadline: new Date(first.at).toISOString(),
          countdownStartsAt: new Date(first.at - p.countdownSeconds * 1000).toISOString(),
          canContinue: first.canContinue,
        }
      : null
  }
}
