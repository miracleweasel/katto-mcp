# Changelog

All notable changes to `katto-mcp` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
