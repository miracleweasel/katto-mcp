# katto-mcp

MCP server for [Katto](https://katto.tech) — turn long videos into scored, captioned 9:16 clips from any MCP client (Claude Desktop, Cursor, Claude Code, ChatGPT, …).

Two ways to connect:

## Hosted (zero-install, recommended)

Point any OAuth-capable MCP client (ChatGPT, Claude web/desktop, MCP Inspector) at the hosted endpoint and sign in with your Katto account — the key never touches your disk, and you can revoke access anytime:

```
https://mcp.katto.tech/mcp   (Streamable HTTP · OAuth)
```

## Local (npx)

For Cursor, CI and scripts. Create an API key at **[katto.tech/dashboard/api-keys](https://katto.tech/dashboard/api-keys)**, then add the server to your MCP client config:

```json
{
  "mcpServers": {
    "katto": {
      "command": "npx",
      "args": ["-y", "katto-mcp"],
      "env": { "KATTO_API_KEY": "sk_live_..." }
    }
  }
}
```

The hosted endpoint above also accepts `Authorization: Bearer sk_live_...` directly for key-based clients.

## Tools

- **`katto_create_clip_job(url, config?)`** — submit a long video (YouTube, Twitch, Vimeo, Rumble, Zoom, Dailymotion). Returns a job id.
- **`katto_get_job(id)`** — poll until `status` is `completed`; `clips` holds the finished MP4 + caption (SRT) urls.
- **`katto_list_jobs(limit?, cursor?, status?)`** — list your recent jobs, newest first (keyset pagination via `cursor`).
- **`katto_get_clips(id)`** — just the finished clips of a job.
- **`katto_get_transcript(id)`** — the job's timestamped transcript segments (`[{ start, end, text }]`).
- **`katto_get_usage()`** — your plan and remaining monthly video quota.
- **`katto_cancel_job(id)`** — cancel a running job and refund the monthly video slot.
- **`katto_get_account()`** — the connected account, this key's scopes, and quota.

Jobs draw from your Katto plan's monthly video quota (25 on Creator, 2 on Free). Videos up to 90 minutes. The underlying REST API also supports `Idempotency-Key` safe retries and read-only scoped keys — see the [docs](https://katto.tech/docs/api).

## Env

| var | required | default |
| --- | --- | --- |
| `KATTO_API_KEY` | yes | — |
| `KATTO_API_URL` | no | `https://katto.tech` |

Full docs: **[katto.tech/docs/api](https://katto.tech/docs/api)**

MIT
