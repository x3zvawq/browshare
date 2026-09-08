export interface MediaDiagnostic {
  readonly name: string
  readonly fields: Readonly<Record<string, string | number | boolean | null>>
}

const fields = {
  bitrateBps: 'bitrate_bps',
  framesPerSecond: 'frames_per_second',
  packetsLost: 'packets_lost',
  framesDropped: 'frames_dropped',
  packetLossRatio: 'packet_loss_ratio',
  jitterMs: 'jitter_milliseconds',
  roundTripTimeMs: 'round_trip_time_milliseconds',
} as const
type Field = keyof typeof fields
interface Sample {
  observedAt: number
  direction: string
  kind: string
  values: Partial<Record<Field, number>>
  limitation?: string
}
interface Channel {
  observedAt: number
  bufferedAmount: number
}
const freshnessMs = 15_000
const channels = ['control-reliable', 'control-realtime', 'file-transfer']

/** Aggregate only allowlisted numeric diagnostics; page-script messages never enter metrics. */
export class WorkerMediaMetrics {
  readonly #streams = new Map<string, Map<string, Sample>>()
  readonly #channels = new Map<string, Map<string, Channel>>()

  observe(sessionId: string, event: MediaDiagnostic): void {
    const data = event.fields
    if (event.name === 'webrtc.media-metrics') {
      if (
        !['inbound', 'outbound'].includes(String(data.direction)) ||
        !['audio', 'video'].includes(String(data.kind))
      )
        return
      const sample: Sample = {
        observedAt: Date.now(),
        direction: String(data.direction),
        kind: String(data.kind),
        values: {},
      }
      for (const field of Object.keys(fields) as Field[]) {
        const value = data[field]
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
          sample.values[field] = value
      }
      if (['none', 'cpu', 'bandwidth', 'other'].includes(String(data.qualityLimitationReason)))
        sample.limitation = String(data.qualityLimitationReason)
      const streams = this.#streams.get(sessionId) ?? new Map<string, Sample>()
      streams.set(`${sample.direction}:${sample.kind}`, sample)
      this.#streams.set(sessionId, streams)
    } else if (event.name === 'data-channel.metrics') {
      const label = String(data.label)
      if (
        !channels.includes(label) ||
        typeof data.bufferedAmount !== 'number' ||
        !Number.isFinite(data.bufferedAmount) ||
        data.bufferedAmount < 0
      )
        return
      const samples = this.#channels.get(sessionId) ?? new Map<string, Channel>()
      samples.set(label, { observedAt: Date.now(), bufferedAmount: data.bufferedAmount })
      this.#channels.set(sessionId, samples)
    }
  }

  remove(sessionId: string): void {
    this.#streams.delete(sessionId)
    this.#channels.delete(sessionId)
  }

  render(now = Date.now()): string[] {
    const all = [...this.#streams.values()].flatMap((samples) => [...samples.values()])
    const fresh = all.filter((sample) => now - sample.observedAt <= freshnessMs)
    const lines = [
      '# HELP browshare_webrtc_streams Latest observed media streams by freshness; fresh means at most 15 seconds old.',
      '# TYPE browshare_webrtc_streams gauge',
      `browshare_webrtc_streams{freshness="fresh"} ${fresh.length}`,
      `browshare_webrtc_streams{freshness="stale"} ${all.length - fresh.length}`,
      '# HELP browshare_webrtc_field_contributors Fresh streams reporting the field; missing values do not contribute.',
      '# TYPE browshare_webrtc_field_contributors gauge',
      '# HELP browshare_webrtc_quality_limited_streams Fresh streams by reported quality limitation.',
      '# TYPE browshare_webrtc_quality_limited_streams gauge',
      '# HELP browshare_data_channel_buffered_bytes Sum of latest fresh data channel buffered bytes.',
      '# TYPE browshare_data_channel_buffered_bytes gauge',
    ]
    if (all.length)
      lines.push(
        '# HELP browshare_webrtc_oldest_observed_timestamp_seconds Oldest retained media sample ingestion time.',
        '# TYPE browshare_webrtc_oldest_observed_timestamp_seconds gauge',
        `browshare_webrtc_oldest_observed_timestamp_seconds ${Math.min(...all.map((s) => s.observedAt)) / 1000}`,
      )
    for (const [field, name] of Object.entries(fields))
      lines.push(
        `# HELP browshare_webrtc_${name}_sum Sum of latest fresh ${field} readings; peer lifetime readings can reset.`,
        `# TYPE browshare_webrtc_${name}_sum gauge`,
      )
    for (const direction of ['inbound', 'outbound'])
      for (const kind of ['audio', 'video']) {
        const samples = fresh.filter((s) => s.direction === direction && s.kind === kind)
        const labels = `direction="${direction}",kind="${kind}"`
        for (const field of Object.keys(fields) as Field[]) {
          const values = samples.flatMap((s) =>
            s.values[field] === undefined ? [] : [s.values[field]!],
          )
          lines.push(
            `browshare_webrtc_field_contributors{${labels},field="${field}"} ${values.length}`,
          )
          if (values.length)
            lines.push(
              `browshare_webrtc_${fields[field]}_sum{${labels}} ${values.reduce((a, b) => a + b, 0)}`,
            )
        }
        for (const reason of ['none', 'cpu', 'bandwidth', 'other'])
          lines.push(
            `browshare_webrtc_quality_limited_streams{${labels},reason="${reason}"} ${samples.filter((s) => s.limitation === reason).length}`,
          )
      }
    for (const channel of channels) {
      const samples = [...this.#channels.values()].flatMap((values) => {
        const sample = values.get(channel)
        return sample && now - sample.observedAt <= freshnessMs ? [sample.bufferedAmount] : []
      })
      if (samples.length)
        lines.push(
          `browshare_data_channel_buffered_bytes{channel="${channel}"} ${samples.reduce((a, b) => a + b, 0)}`,
        )
    }
    return lines
  }
}
