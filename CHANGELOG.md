# Changelog

All notable changes to `katto-mcp` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.6.1] - 2026-10-19
### Changed
- Releases are now published from GitHub Actions with npm provenance
  (sigstore build attestation linking each tarball to its source commit and
  workflow run). Verify with `npm audit signatures`.
- The public repository now carries the exact source published to npm
  (it had fallen behind at 0.5.9 / 16 tools while npm shipped 0.6.0).

## [0.5.2 – 0.6.0] - 2026-10-13
### Added
- Grew from 15 to 29 tools (clip pool, subtitle translation, retitling,
  publishing and scheduled posts, connected accounts, clip adjustments).
  The README lists every tool; `katto_*` names are stable.

## [0.5.1] - 2026-08-21
### Added
- 15 tools covering the full clipping workflow: create/list/get jobs, get clips,
  transcript, usage, account, cancel, list sources, list clip lengths, rerender,
  dub, get rerender, brand kit, webhook secret.
- Hosted connector documented: `https://mcp.katto.tech/mcp` (Streamable HTTP,
  OAuth 2.1 + Dynamic Client Registration) alongside the local `npx` transport.

### Changed
- Enriched README with per-tool descriptions and client setup (Claude, Cursor,
  ChatGPT and any MCP-compatible client).

## [0.3.1] - 2026-08-21
### Added
- Expanded from 6 to 8 tools (cancel job, get clips, account introspection).

## [0.2.1] - 2026-08-20
### Added
- Initial public release: create clip jobs and poll results from any MCP client.
- Published to npm and the official MCP Registry.
