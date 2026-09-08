# syntax=docker/dockerfile:1.7

FROM node:24.12.0-bookworm-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99 AS workspace

WORKDIR /source
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/gateway/package.json ./apps/gateway/package.json
COPY apps/portal/package.json ./apps/portal/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/common/package.json ./packages/common/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/navigation-policy/package.json ./packages/navigation-policy/package.json
RUN pnpm install --frozen-lockfile
COPY . .

FROM workspace AS build
RUN pnpm --filter @browshare/worker... build \
  && pnpm --filter @browshare/worker deploy --legacy --prod /out/worker

FROM workspace AS gateway-build
RUN pnpm --filter @browshare/gateway... build \
  && pnpm --filter @browshare/gateway deploy --legacy --prod /out/gateway

FROM workspace AS backend-build
RUN pnpm --filter @browshare/backend... build \
  && pnpm --filter @browshare/backend deploy --legacy --prod /out/backend

# The named context is the sibling Remote Tab source checkout, never a Chrome image.
FROM node:24.12.0-bookworm-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99 AS remote-tab-dependencies
WORKDIR /remote-tab
RUN corepack enable
COPY --from=remote-tab-source . .
COPY deploy/compatibility.json /browshare-compatibility.json
RUN node --input-type=module -e 'import fs from "node:fs"; const expected = JSON.parse(fs.readFileSync("/browshare-compatibility.json")).remoteTab.releaseVersion; for (const name of ["core", "protocol"]) { const actual = JSON.parse(fs.readFileSync(`packages/${name}/package.json`)).version; if (actual !== expected) throw new Error(`Remote Tab ${name} ${actual} does not match ${expected}`); }' \
  && pnpm install --frozen-lockfile

FROM remote-tab-dependencies AS remote-tab-build
RUN pnpm --filter @browshare/remote-tab-core... build \
  && pnpm --filter @browshare/remote-tab-core deploy --legacy --prod /out/remote-tab-core

FROM remote-tab-dependencies AS signaling-build
RUN pnpm --filter @browshare/remote-tab-signaling... build \
  && pnpm --filter @browshare/remote-tab-signaling deploy --legacy --prod /out/signaling

FROM remote-tab-dependencies AS viewer-build
RUN node --input-type=module -e 'import fs from "node:fs"; const expected = JSON.parse(fs.readFileSync("/browshare-compatibility.json")).remoteTab.releaseVersion; if (JSON.parse(fs.readFileSync("packages/viewer/package.json")).version !== expected) throw new Error("Remote Tab Viewer version mismatch");' \
  && pnpm --filter @browshare/remote-tab-viewer... build \
  && pnpm --filter @browshare/remote-tab-viewer deploy --legacy --prod /out/viewer

FROM workspace AS portal-build
COPY --from=viewer-build /out/viewer/ /opt/browshare/viewer/
# Consume the same exported Viewer package as prepare-portal-viewer.mjs.
RUN mkdir -p apps/portal/node_modules/@browshare \
  && ln -s /opt/browshare/viewer apps/portal/node_modules/@browshare/remote-tab-viewer \
  && pnpm --filter @browshare/api-client... build \
  && pnpm --filter @browshare/portal exec vite build

FROM node:24.12.0-bookworm-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99 AS backend
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
COPY --from=backend-build --chown=node:node /out/backend/ /app/
COPY --chmod=0644 deploy/docker/healthcheck.mjs /app/healthcheck.mjs
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/cli.mjs"]
HEALTHCHECK --interval=10s --timeout=8s --start-period=20s --retries=3 \
  CMD ["node", "healthcheck.mjs", "backend"]

# The migrator is a one-shot use of the exact Backend dependency and SQL set.
FROM backend AS migrator
CMD ["node", "node_modules/@browshare/database/dist/cli.mjs"]
HEALTHCHECK NONE

FROM nginx:1.27.5-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS portal
COPY --from=portal-build /source/apps/portal/dist/ /usr/share/nginx/html/
COPY --chmod=0644 deploy/docker/nginx.conf /etc/nginx/nginx.conf
USER nginx
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --output-document=/dev/null http://127.0.0.1:8080/health/live || exit 1

FROM node:24.12.0-bookworm-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99 AS gateway
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
COPY --from=gateway-build --chown=node:node /out/gateway/ /app/
COPY --from=signaling-build --chown=node:node /out/signaling/ /opt/browshare/signaling/
COPY --chmod=0644 deploy/docker/healthcheck.mjs /app/healthcheck.mjs
RUN ln -s /opt/browshare/signaling /app/node_modules/@browshare/remote-tab-signaling \
  && ln -s /opt/browshare/signaling/node_modules/@browshare/remote-tab-protocol /app/node_modules/@browshare/remote-tab-protocol
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/cli.mjs"]
HEALTHCHECK --interval=10s --timeout=8s --start-period=20s --retries=3 \
  CMD ["node", "healthcheck.mjs", "gateway"]

FROM node:24.12.0-bookworm-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99 AS worker-chrome

ARG GOOGLE_CHROME_VERSION=152.0.7977.75-1
ARG GOOGLE_CHROME_DEB_URL=https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_152.0.7977.75-1_amd64.deb
ARG GOOGLE_CHROME_DEB_SHA256=a0b7a64f768ffc0ff5ccc9260ad9ebb53fd16f7a131e2e36994da58b82d913df
ARG DEBIAN_FRONTEND=noninteractive

LABEL org.opencontainers.image.title="BrowShare Worker with Google Chrome Stable" \
  org.opencontainers.image.description="Locally built BrowShare Worker runtime with a verified Google Chrome Stable package" \
  org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
  BROWSHARE_WORKER_CHROME_EXECUTABLE=/usr/bin/google-chrome-stable \
  BROWSHARE_EXPECTED_CHROME_VERSION=152.0.7977.75 \
  BROWSHARE_WORKER_IDENTITY_DIRECTORY=/var/lib/browshare/identity \
  BROWSHARE_WORKER_PROFILE_STORAGE_DIRECTORY=/var/lib/browshare/profiles \
  BROWSHARE_WORKER_TEMPORARY_STORAGE_DIRECTORY=/var/lib/browshare/session-temp \
  BROWSHARE_REMOTE_TAB_EXTENSION_RELEASE_DIRECTORY=/opt/browshare/extension-release \
  BROWSHARE_REMOTE_TAB_MANAGED_POLICY_PATH=/var/lib/browshare/chrome-policy/browshare-remote-tab.json

WORKDIR /app
USER root
RUN test "$(dpkg --print-architecture)" = amd64 \
  && apt-get update \
  && apt-get upgrade --yes --no-install-recommends \
  && apt-get install --yes --no-install-recommends ca-certificates curl fonts-liberation tini \
  && curl --fail --show-error --silent --location "$GOOGLE_CHROME_DEB_URL" --output /tmp/google-chrome.deb \
  && echo "$GOOGLE_CHROME_DEB_SHA256  /tmp/google-chrome.deb" | sha256sum --check --strict \
  && apt-get install --yes --no-install-recommends /tmp/google-chrome.deb \
  && test "$(dpkg-query -W -f='${Version}' google-chrome-stable)" = "$GOOGLE_CHROME_VERSION" \
  && rm -f /tmp/google-chrome.deb \
    /etc/apt/sources.list.d/google-chrome.sources \
    /etc/cron.daily/google-chrome \
    /etc/default/google-chrome \
    /usr/share/keyrings/google-chrome.gpg \
  && rm -rf /var/lib/apt/lists/* \
    /usr/local/lib/node_modules/corepack \
    /usr/local/lib/node_modules/npm \
    /opt/yarn-v1.22.22 \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg

RUN install -d -o root -g root -m 0755 \
    /etc/opt/chrome/policies/managed \
    /opt/browshare/extension-release \
  && install -d -o node -g node -m 0700 \
    /var/lib/browshare/identity \
    /var/lib/browshare/profiles \
    /var/lib/browshare/session-temp \
    /var/lib/browshare/chrome-policy \
  && ln -s \
    /var/lib/browshare/chrome-policy/browshare-remote-tab.json \
    /etc/opt/chrome/policies/managed/browshare-remote-tab.json

COPY --from=build --chown=node:node /out/worker/ /app/
COPY --chmod=755 tools/profile-archive.sh /app/tools/profile-archive.sh
COPY --chmod=0644 deploy/docker/healthcheck.mjs /app/healthcheck.mjs
COPY --from=remote-tab-build --chown=node:node /out/remote-tab-core/ /opt/browshare/remote-tab-core/
RUN ln -s /opt/browshare/remote-tab-core /app/node_modules/@browshare/remote-tab-core \
  && ln -s /opt/browshare/remote-tab-core/node_modules/@browshare/remote-tab-protocol /app/node_modules/@browshare/remote-tab-protocol


# Chrome must decode non-ASCII upload paths using a UTF-8 locale.
ENV LANG=C.UTF-8
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/cli.mjs"]
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "healthcheck.mjs", "worker"]
