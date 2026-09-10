# Changelog

## 0.1.0 — Unreleased candidate

First coordinated BrowShare candidate. Source commits and CI candidates are publicly available;
there is no tagged release or supported previous release yet.

### Product

- Move normal Viewer route status into the header and size storage columns to their content.
- Use proportional Noto CJK browser defaults, with separate serif and monospace families.
- Integrate Remote Tab 0.1.25 native text selection, editing keys, clipboard shortcuts and file
  drop capabilities through the existing Session transfer policies.

- Profile detail pages with maintenance, Page Script and navigation tabs, shared actions, compact
  refresh status and persistent table column selection.
- Proxy URL quick entry with local credential parsing and explicit review before saving.
- Negotiated Remote Tab cursor feedback and passive pointer queue coalescing.

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
- Container configuration and healthcheck copies set readable permissions explicitly, allowing
  non-root services to start from source checkouts created with a restrictive umask.
- Linux amd64; Node 24.12.0; Google Chrome Stable 152.0.7977.75; Remote Tab and signed Extension
  0.1.25; Worker Control protocol 1.22. Exact pins are in [compatibility.json](deploy/compatibility.json).
- Database migration journal contains the candidate schema. Historical schema upgrades and current
  image replacement were tested; there is no claim of upgrading from a previously published release.
- Existing Chrome data is shared within one Profile. Tab ownership does not provide cookie or
  account isolation. Page Scripts are an experience feature, not an authorization boundary.

### Release limits

Real acceptance and its individual environment/version boundaries are recorded in
[testing and acceptance](docs/design/09-testing-and-acceptance.md). Public source, hosted CI, received
candidate verification, isolated source installation and same-identity backup recovery have passed
within their recorded scope. Registry publication and official Remote Tab signing remain pending;
the source-install exercise was performed by the project Agent, not an independent external operator.
See the [release guide](docs/RELEASING.md) before promoting this candidate.
