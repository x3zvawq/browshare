# Third-party software

BrowShare source is provided under [MIT](LICENSE). This does not relicense its dependencies,
container base distributions, fonts, or Google Chrome.

- The coordinated `browshare-tab-remote` source has its own MIT license and third-party notices.
  Keep those files with its source and packages.
- Release candidates include `dependency-licenses.json` from both locked pnpm workspaces and
  CycloneDX/SPDX source SBOMs. These include development dependencies; they are an inventory,
  not a claim that every dependency is shipped in every runtime image.
- Each OCI candidate includes its own SPDX SBOM and BuildKit provenance. Runtime images contain
  operating-system packages with their own licenses; retain the notices supplied in the image.
- Google Chrome is proprietary software subject to Google's terms. The Worker Dockerfile downloads
  the fixed official package and verifies its checksum for a local build. Do not publish the
  Chrome-containing image until its redistribution conditions have been established. This project
  does not grant Chrome redistribution rights or distribute a Chrome binary in its source archive.
- A signed Remote Tab Extension requires an authorized, stable signing key. Signing keys, enrollment
  tokens, TLS secrets, Profile data and test credentials are never release artifacts.

SBOM tools report detected metadata. Resolve missing or ambiguous license metadata before distributing
an affected artifact; a successful build or scan is not a legal determination.
