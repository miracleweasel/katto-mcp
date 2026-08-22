# Examples

Ways to connect Katto to an MCP client. Replace `sk_live_...` with your key from
https://katto.tech/dashboard/api-keys (a key can be scoped read-only).

## Local (npx) — Claude Desktop / Cursor / Claude Code / CI

See [`claude_desktop_config.json`](./claude_desktop_config.json) and
[`cursor_mcp.json`](./cursor_mcp.json). Both run the published package with:

```bash
npx -y katto-mcp
```

## Hosted (zero-install, OAuth 2.1)

Point any OAuth 2.1 MCP client (Claude web/desktop, MCP Inspector, or any client
supporting OAuth 2.1 + Dynamic Client Registration) at:

```
https://mcp.katto.tech/mcp
```

Transport: Streamable HTTP. Sign in with your Katto account — no key on disk.
The hosted endpoint also accepts `Authorization: Bearer sk_live_...` directly.

## First prompt to try

> "Clip the best moments from this podcast and reframe them for TikTok:
> https://www.youtube.com/watch?v=..."
