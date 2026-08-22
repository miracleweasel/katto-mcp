# Contributing

Thanks for your interest in `katto-mcp` — the official MCP client for
[Katto](https://katto.tech), the AI video clipping tool.

## Local development

```bash
git clone https://github.com/miracleweasel/katto-mcp.git
cd katto-mcp
npm install
export KATTO_API_KEY=sk_live_...   # from https://katto.tech/dashboard/api-keys
node index.mjs                     # runs the stdio MCP server
npm test                           # syntax + metadata smoke tests
```

## Guidelines

- Keep the client thin: it maps MCP tool calls to the public Katto REST API
  (see https://katto.tech/docs/api and https://katto.tech/openapi.json).
- No secrets or infrastructure config in the repo — only the public client.
- Run `npm test` and `node --check index.mjs` before opening a PR.
- Bug reports and feature requests: https://katto.tech/contact.
