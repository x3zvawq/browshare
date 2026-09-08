import type { WorkerCommandType } from '@browshare/contracts'

type Outcome = 'succeeded' | 'failed' | 'timeout' | 'unavailable' | 'incompatible' | 'restarted'
interface Counts {
  started: number
  attempts: number
  completed: Map<Outcome, { count: number; seconds: number }>
}

/** Process counters count RPC lifetimes; retransmissions are separate wire attempts. */
export class CommandMetrics {
  readonly #commands = new Map<WorkerCommandType, Counts>()
  #entry(type: WorkerCommandType): Counts {
    let entry = this.#commands.get(type)
    if (!entry) {
      entry = { started: 0, attempts: 0, completed: new Map() }
      this.#commands.set(type, entry)
    }
    return entry
  }
  start(type: WorkerCommandType): void {
    this.#entry(type).started += 1
  }
  attempt(type: WorkerCommandType): void {
    this.#entry(type).attempts += 1
  }
  complete(type: WorkerCommandType, outcome: Outcome, elapsedMilliseconds: number): void {
    const counts = this.#entry(type).completed,
      sample = counts.get(outcome) ?? { count: 0, seconds: 0 }
    sample.count += 1
    sample.seconds += elapsedMilliseconds / 1000
    counts.set(outcome, sample)
  }
  render(): string[] {
    const lines = [
      '# HELP browshare_control_commands_started_total Backend command RPC lifetimes started in this process.',
      '# TYPE browshare_control_commands_started_total counter',
      '# HELP browshare_control_command_attempts_total Wire dispatch attempts including retransmissions.',
      '# TYPE browshare_control_command_attempts_total counter',
      '# HELP browshare_control_commands_completed_total Command RPC lifetimes settled by outcome.',
      '# TYPE browshare_control_commands_completed_total counter',
      '# HELP browshare_control_command_duration_seconds_total Cumulative monotonic time until command settlement including reconnect waits.',
      '# TYPE browshare_control_command_duration_seconds_total counter',
      '# HELP browshare_control_commands_pending Unsettled command RPC lifetimes in this Backend.',
      '# TYPE browshare_control_commands_pending gauge',
    ]
    for (const [type, c] of this.#commands) {
      const labels = `type="${type}"`
      lines.push(
        `browshare_control_commands_started_total{${labels}} ${c.started}`,
        `browshare_control_command_attempts_total{${labels}} ${c.attempts}`,
        `browshare_control_commands_pending{${labels}} ${c.started - [...c.completed.values()].reduce((n, x) => n + x.count, 0)}`,
      )
      for (const [outcome, sample] of c.completed)
        lines.push(
          `browshare_control_commands_completed_total{${labels},outcome="${outcome}"} ${sample.count}`,
          `browshare_control_command_duration_seconds_total{${labels},outcome="${outcome}"} ${sample.seconds}`,
        )
    }
    return lines
  }
}
