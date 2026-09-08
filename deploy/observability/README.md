# Optional Prometheus collector

BrowShare does not require or start a monitoring stack. This example adds an independent collector
on a Linux host using the Backend, Worker and Gateway health listeners already deployed there.
Use the service's actual configured ports. The defaults in
[`prometheus.example.yml`](./prometheus.example.yml) are `3400`, `3410` and `3482`.

1. Copy the scrape configuration to a deployment-owned directory. Adjust private target addresses.
   A container loopback address is reachable from this example only when the service shares the
   host network or publishes its health port to host loopback. Do not publish metrics to public ingress.
2. Set `PROMETHEUS_IMAGE` to an approved `prom/prometheus@sha256:…` digest,
   `PROMETHEUS_CONFIG_FILE` to your absolute configuration path, and
   `PROMETHEUS_GATEWAY_SECRET_FILE` to a protected file containing the existing Gateway secret.
   Both mounted files must be readable by UID 65534. For the secret, use owner-controlled access
   such as root ownership, group 65534 and mode `0640`; do not make it world-readable. The secret
   goes in a file, not into the scrape YAML, command line, labels or repository.
3. Validate configuration before starting the optional collector:

```bash
docker compose -f deploy/observability/compose.example.yml config --quiet
docker compose -f deploy/observability/compose.example.yml run --rm --no-deps \
  --entrypoint /bin/promtool prometheus check config /etc/prometheus/prometheus.yml
docker compose -f deploy/observability/compose.example.yml up -d
```

The query UI listens on host loopback `127.0.0.1:9090`. The example retains at most seven days or
256 MB of samples in a separate volume. It does not delete BrowShare audit or Session records.
Multiple Workers on separate hosts need reachable private monitoring endpoints or a collector on
each host; changing Chrome/CDP listeners is never part of monitoring configuration.

Useful queries:

```promql
up{job=~"browshare-.*"}
rate(browshare_http_requests_failed_total[5m])
rate(browshare_http_request_duration_milliseconds_total[5m])
  / rate(browshare_http_requests_completed_total[5m])
time() - browshare_worker_metrics_observed_timestamp_seconds
browshare_worker_storage_available_bytes / browshare_worker_storage_total_bytes
browshare_gateway_connections_active / browshare_gateway_maximum_connections
```

HTTP elapsed time includes SSE only after the stream ends; this aggregate is not an API latency
percentile. Requests disconnected before a completed response are not counted as completed.
A successful scrape proves listener availability; it does not prove Worker reconciliation or fresh
Chrome measurements. Use `/health/ready` and the runtime sample timestamp as separate evidence.
The timestamp is absent before the first completed sample and records when that sample began.
Choose freshness thresholds above the configured sampling cadence and expected probe duration.
Metrics use bounded aggregate labels, with no Session/Profile/user IDs, target URL or file paths.

Configuration syntax follows the [Prometheus configuration reference](https://prometheus.io/docs/prometheus/latest/configuration/configuration/).
