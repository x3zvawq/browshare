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

## Maple Mono CN

The Worker image installs the unmodified Regular, Bold, Italic and Bold Italic fonts from
[Maple Mono CN v7.9](https://github.com/subframe7536/maple-font/releases/tag/v7.9), by the
Maple Mono Project Authors, under the SIL Open Font License 1.1. Its Chinese and Japanese
glyphs derive from Resource Han Rounded, as documented by upstream. The fixed archive SHA-256
is `cb1e79b2c23dff772ae351784ef2b84454a61b3920e9b20bd5db4bf207e4472d`.
The complete upstream copyright and license accompany the fonts in the image at
`/usr/share/doc/maple-mono-cn/LICENSE.txt`; retain them when redistributing the font files.
The OFL permits bundling and redistribution with software, subject to its terms, including
retaining the license and not selling the fonts on their own. This does not change Chrome's
separate distribution conditions above.

Chrome's default standard, serif, sans-serif and fixed families use Maple Mono CN. Explicit
website CSS families and web fonts remain in control of their own text. Fontconfig retains
fallback selection for glyphs not included in Maple Mono CN; no font here promises every
Unicode character.

SBOM tools report detected metadata. Resolve missing or ambiguous license metadata before distributing
an affected artifact; a successful build or scan is not a legal determination.
