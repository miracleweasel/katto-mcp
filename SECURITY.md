# Security Policy

## Reporting a vulnerability

If you find a security issue in `katto-mcp` or the Katto API/MCP endpoints,
please report it privately: **security@katto.tech** (or via
https://katto.tech/contact). We aim to acknowledge within 48 hours.

Please do not open a public issue for security reports.

## How this client handles credentials

- `katto-mcp` reads your API key from the `KATTO_API_KEY` environment variable
  and sends it only to the Katto API over HTTPS. The key is never logged.
- Prefer a **read-only scoped key** for agents that only need to poll jobs and
  read clips. Create and scope keys at https://katto.tech/dashboard/api-keys.
- For zero-install use, the hosted connector at `https://mcp.katto.tech/mcp`
  uses OAuth 2.1 + Dynamic Client Registration, so no key is stored on disk.

## Supported versions

The latest published version on npm receives fixes. Older versions are not
maintained.
