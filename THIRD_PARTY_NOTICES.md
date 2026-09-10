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

## Noto CJK

The Chrome image installs Debian's `fonts-noto-cjk` package, containing
[Noto CJK](https://github.com/notofonts/noto-cjk) fonts under the SIL Open Font License 1.1.
The package's copyright notices and complete license are retained at
`/usr/share/doc/fonts-noto-cjk/copyright`. Retain those notices when redistributing fonts;
Chrome's separate distribution conditions above still apply.

Chrome's standard and sans-serif defaults use Noto Sans CJK SC (proportional text), serif
uses Noto Serif CJK SC, and fixed-width content uses Noto Sans Mono CJK SC. The launcher
preserves unrelated Profile preferences. Available fonts selected explicitly by a website
and web fonts still take precedence; other installed fonts provide missing-glyph fallback.
Apple's PingFang font is not copied into the Linux image.

SBOM tools report detected metadata. Resolve missing or ambiguous license metadata before distributing
an affected artifact; a successful build or scan is not a legal determination.
