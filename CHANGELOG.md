# Changelog

## 0.1.0 — Unreleased candidate

First coordinated BrowShare candidate. There is no published release or supported previous release
yet. The current checkout has no committed release identity; this entry must not be interpreted as
an available public download.

### Product

- Portal authentication, account security, users, roles, permissions and administrator settings.
- Persistent Profiles, groups, per-user context, navigation policy, Page Scripts and Profile Proxy.
- Ordinary and maintenance Sessions, capacity reservation, Viewer tickets, reconnect and takeover,
  clipboard, uploads, retained downloads and policy enforcement.
- Worker enrollment and mTLS control, capability checks, capacity/storage limits, reconciliation,
  independent cleanup recovery, exact Runtime stop, and persistent Chrome lifecycle.
- Independent Gateway and TURN deployment; the public Remote Tab Viewer/Core boundary carries
  WebRTC media, CDP input and Extension integration.
- Audit, aggregate metrics, fixed-field diagnostics and privacy-preserving Page Script error facts.

### Deployment and compatibility

- All-in-one and distributed Compose, explicit PostgreSQL migrations, TLS/CA helpers, environment
  examples, Profile archives and database backup/restore/retention tools.
- Linux amd64; Node 24.12.0; Google Chrome Stable 152.0.7977.75; Remote Tab and signed Extension
  0.1.23; Worker Control protocol 1.22. Exact pins are in [compatibility.json](deploy/compatibility.json).
- Database migration journal contains the candidate schema. Historical schema upgrades and current
  image replacement were tested; there is no claim of upgrading from a previously published release.
- Existing Chrome data is shared within one Profile. Tab ownership does not provide cookie or
  account isolation. Page Scripts are an experience feature, not an authorization boundary.

### Release limits

Real acceptance and its individual environment/version boundaries are recorded in
[testing and acceptance](docs/design/09-testing-and-acceptance.md). Local full checks, source archives,
SBOMs and unsigned build records are separate from a hosted CI run, signed publisher identity, public
source/registry release and an independent third-party empty-host exercise. Those external release
conditions remain pending. See the [release guide](docs/RELEASING.md) before promoting this candidate.
