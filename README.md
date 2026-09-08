<p align="center">English | <a href="README_cn.md">简体中文</a></p>

<p align="center">
  <img src="docs/assets/browshare-icon.svg" width="144" height="144" alt="BrowShare" />
</p>

<h1 align="center">BrowShare</h1>

<p align="center">Your team’s browser workspace, on your own infrastructure.</p>

<p align="center">
  <a href="https://github.com/x3zvawq/browshare/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/x3zvawq/browshare/ci.yml?branch=main&amp;label=CI" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0F62D6" alt="MIT License" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://github.com/x3zvawq/browshare-remote-tab"><img src="https://img.shields.io/badge/media-WebRTC-0F62D6" alt="WebRTC media" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/CONTRIBUTING.md">Contributing</a> ·
  <a href="https://github.com/x3zvawq/browshare/issues">Report an issue</a>
</p>

BrowShare is an open-source, self-hosted shared browser workspace. Administrators manage persistent Google Chrome Profiles, and team members open authorized workspaces in their browser, each with an exclusive remote tab. Login state and browser data stay on your server, while the platform manages access, navigation policies and Session lifecycles.

## Features

- **Persistent workspaces.** Each Profile has its own Chrome data directory, preserving login state and the working environment across restarts.
- **Access from your browser.** WebRTC video and audio with mouse, keyboard, IME, clipboard, uploads and downloads.
- **Team access management.** Users, roles, Profile grants, maintenance Sessions and audit records keep everyday access and administration clear.
- **Business access policies.** Configure proxies, navigation rules, Session policies and Page Scripts for each Profile.
- **Operable Workers.** Node enrollment, certificate rotation, capacity management, state reconciliation and runtime recovery.
- **Your data, your infrastructure.** Single-tenant deployment with PostgreSQL for business state and Worker storage for Profiles and files, plus backup and restore tools.

Tabs in the same Profile share cookies and site data. They suit members working in the same business environment; use separate Profiles when different login states are needed.

## Quick start

Deployment requirements: **Linux amd64, Docker Engine / Compose / Buildx, Node.js 24.12.0, pnpm 10.28.2 and OpenSSL**. Chrome runs on the Linux Worker; users only need a desktop browser.

### 1. Get the source

```bash
git clone https://github.com/x3zvawq/browshare.git
git clone https://github.com/x3zvawq/browshare-remote-tab.git browshare-tab-remote
cd browshare
corepack enable
pnpm install --frozen-lockfile
pnpm --dir ../browshare-tab-remote install --frozen-lockfile
```

### 2. Deploy the services

Follow the [container deployment guide](deploy/docker/README.md) to select a verified source pair, build images, configure HTTPS, initialize an administrator and enroll a Worker. The guide covers a single-host deployment, TURN, file endpoints, backups and recovery.

BrowShare provides five image build targets: Portal, Backend, Migrator, Gateway and Worker. A local Worker image build installs a pinned Google Chrome Stable version. Runtime configuration and signing keys stay outside the images.

### 3. Open your first workspace

1. Sign in to the Portal and confirm that your Worker is online and available for scheduling.
2. Create a Profile, select its Worker, and configure its runtime mode, access permissions and published navigation rules.
3. Enter a Session from the workspace and use the remote tab in the Viewer. Collect downloaded files from the download inbox.

See [creating your first business Session](deploy/docker/README.md#创建第一条业务-session) for the complete flow. To work on the Portal or Backend, use the [local development guide](docs/development.md).

## Two projects, clear responsibilities

| Project | Purpose |
| --- | --- |
| **BrowShare** | The complete workspace platform: Portal, users and permissions, Profiles, Worker scheduling, policies, audits and data operations. |
| **[BrowShare Remote Tab](https://github.com/x3zvawq/browshare-remote-tab)** | The embeddable remote-tab engine: Chrome capture, WebRTC, input, Viewer, signaling and public integration APIs. |

BrowShare embeds Remote Tab Core in its Worker and reuses the Viewer in its Portal. Choose BrowShare for a complete shared workspace, or use Remote Tab directly to add remote browsing to your own application.

## Documentation

- [Documentation index](docs/README.md): guides organized around using, operating and developing BrowShare.
- [Deployment and operations](deploy/docker/README.md): installation, network endpoints, Workers and data recovery.
- [Local development](docs/development.md): start the Portal, Backend and development services.
- [Architecture](docs/design/02-architecture.md) · [APIs and protocols](docs/design/07-protocols.md).
- [Changelog](CHANGELOG.md) · [Compatibility](deploy/compatibility.json) · [Security policy](docs/SECURITY.md).

The technical guides are currently written in Simplified Chinese.

## Contributing

Bug fixes, interaction improvements, documentation and feature proposals are welcome. Read the [contributing guide](docs/CONTRIBUTING.md), then open a focused pull request describing the use case, behavior changes and validation.

[Open an issue](https://github.com/x3zvawq/browshare/issues/new/choose) with your version, deployment setup, browser and reproduction steps. Report security vulnerabilities through the [private security reporting process](docs/SECURITY.md).

## License

BrowShare is licensed under the [MIT License](LICENSE). Google Chrome usage and distribution are governed by its own terms; see the [third-party notices](THIRD_PARTY_NOTICES.md).
