# katto-mcp

[![smithery badge](https://smithery.ai/badge/dev-4lue/katto-mcp)](https://smithery.ai/servers/dev-4lue/katto-mcp)

**The AI video clipping MCP server.** Turn long videos into scored, captioned, vertical 9:16 short clips from any MCP client (Claude, Cursor, Claude Code, ChatGPT, VS Code, and other conformant clients). Drop in a YouTube link, a podcast, or a Twitch VOD and get publish-ready shorts back through natural conversation.

Powered by [Katto](https://katto.tech), an AI video clipper that turns long-form video (podcasts, interviews, streams, webinars) into short-form clips for TikTok, Reels and YouTube Shorts. Katto is a flat-priced, no-credits alternative to tools like OpusClip: one 25-video quota covers videos up to 90 minutes each, with the API and MCP included on every paid plan (not gated behind an enterprise tier).

## What it does

Ask your agent something like *"clip the best moments from this podcast and reframe them for TikTok"* and Katto will:

- find the strongest 30 to 90 second moments in a long video and score each clip 0 to 100 on Hook, Flow, Value and Trend,
- reframe to vertical 9:16 with face tracking, split-screen for two speakers, and stacked layouts for gaming,
- burn word-by-word animated captions (99 languages) and optionally dub into 8 languages,
- and hand back publish-ready MP4 files plus SRT caption urls.

Typical uses: repurpose a YouTube video into shorts, turn a podcast episode into clips, cut highlights from a Twitch VOD, or convert a long interview into vertical social posts.

## Two ways to connect

### Hosted (zero-install, recommended)

Point any OAuth-capable MCP client at the hosted endpoint and sign in with your Katto account. The API key never touches your disk, and you can revoke access anytime:

```
https://mcp.katto.tech/mcp   (Streamable HTTP, OAuth 2.1)
```

### Local (npx)

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

## Tools (15)

Clipping:
- **`katto_create_clip_job(url, config?)`** clip a long video (YouTube, Twitch, Vimeo, Rumble, Zoom, Dailymotion). Returns a job id.
- **`katto_get_job(id)`** poll until `status` is `completed`; `clips` holds the finished MP4 + caption (SRT) urls.
- **`katto_get_clips(id)`** just the finished clips of a job (MP4 + SRT + title + virality score).
- **`katto_get_transcript(id)`** the job's timestamped transcript segments.
- **`katto_list_jobs(limit?, cursor?, status?)`** your recent jobs, newest first (keyset pagination).
- **`katto_cancel_job(id)`** cancel a running job and refund the monthly video slot.

Editing (no quota):
- **`katto_rerender_clip(id, clip_index, layout_mode?, caption_style?)`** re-render one clip with a new reframe layout or caption style.
- **`katto_dub_clip(id, clip_index, languages)`** re-render a clip dubbed into one or more of 8 languages.
- **`katto_get_rerender(id, rerender_id)`** poll a re-render for the new versioned clip url.

Account and reference:
- **`katto_get_usage()`** your plan and remaining monthly video quota.
- **`katto_get_account()`** the connected account, this key's scopes, and quota.
- **`katto_get_brand_kit()`** your saved brand kits (colors, caption font, layout, watermark).
- **`katto_get_webhook_secret()`** your webhook signing secret and how to verify signed callbacks.
- **`katto_list_sources()`** the video platforms Katto can clip from, with an example url each.
- **`katto_list_clip_lengths()`** the valid target clip-length buckets.

Jobs draw from your Katto plan's monthly video quota (25 on Creator, 2 on Free), videos up to 90 minutes. The underlying REST API also supports `Idempotency-Key` safe retries, read-only scoped keys, and signed HMAC webhooks. See the [docs](https://katto.tech/docs/api).

## Env

| var | required | default |
| --- | --- | --- |
| `KATTO_API_KEY` | yes | (none) |
| `KATTO_API_URL` | no | `https://katto.tech` |

Full docs: **[katto.tech/docs/api](https://katto.tech/docs/api)**

MIT
