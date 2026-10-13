# katto-mcp

[![npm version](https://img.shields.io/npm/v/katto-mcp.svg)](https://www.npmjs.com/package/katto-mcp)
[![npm downloads](https://img.shields.io/npm/dm/katto-mcp.svg)](https://www.npmjs.com/package/katto-mcp)
[![license](https://img.shields.io/npm/l/katto-mcp.svg)](./LICENSE)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.miracleweasel%2Fkatto--mcp-blue)](https://registry.modelcontextprotocol.io)

**The AI video clipping MCP server.** Turn long videos into scored, captioned, vertical 9:16 short clips from any MCP client (Claude, Cursor, Claude Code, ChatGPT, VS Code, and other conformant clients). Drop in a YouTube link, a podcast, or a Twitch VOD and get publish-ready shorts back through natural conversation.

Powered by [Katto](https://katto.tech), an AI video clipper that turns long-form video (podcasts, interviews, streams, webinars) into short-form clips for TikTok, Reels and YouTube Shorts. Katto is a flat-priced, no-credits alternative to tools like OpusClip: the Creator plan's 25-video monthly quota covers videos up to 90 minutes each. API and MCP access is included on **every plan, including the free one** (2 videos/month), not gated behind a paid or enterprise tier.

## What it does

Ask your agent something like *"clip the best moments from this podcast and reframe them for TikTok"* and Katto will:

- find the strongest 30 to 90 second moments in a long video and score each clip 0 to 100 on Hook, Flow, Value and Trend,
- reframe to vertical 9:16 with face tracking, split-screen for two speakers, and stacked layouts for gaming,
- burn animated captions (auto-captioned in 99 languages via Whisper large-v3; word-by-word timing in 41 of them, sentence-level in the rest) and optionally dub into 19 languages,
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

## Install per client

**Claude Code** (hosted, OAuth):
```bash
claude mcp add --transport http katto https://mcp.katto.tech/mcp
```

**Claude Desktop** — Settings → Connectors → *Add custom connector* → `https://mcp.katto.tech/mcp`, then sign in. (Or add the `npx` block above to `claude_desktop_config.json`.)

**Cursor** — Settings → MCP → *Add* → paste the `npx` JSON block above (uses `KATTO_API_KEY`).

**VS Code** (MCP extension) — add the same `npx` block to your MCP settings, or point it at the hosted URL if your client supports remote OAuth servers.

**ChatGPT** (Developer mode / connectors) — add a custom connector with URL `https://mcp.katto.tech/mcp`.

## Tools

**29 tools**, in five groups: nine for clipping, eight for editing, four for publishing, one for feedback, seven for account and reference.

Clipping:
- **`katto_create_clip_job(url | upload_id, config?)`** clip a long video from a public link (YouTube, Twitch, Kick, Vimeo, Zoom, Google Drive, Dropbox, Loom, LinkedIn, Facebook, Rumble, Dailymotion, Medal.tv, or a direct https link to a video file) or a file uploaded with `katto_upload_video`. Returns a job id.
- **`katto_upload_video(filename, content_type, size)`** clip a local file: returns a presigned upload url to PUT the file to, then `katto_create_clip_job` with `upload_id`.
- **`katto_get_job(id)`** poll until `status` is `completed`; `clips` holds the finished MP4 + caption (SRT) urls.
- **`katto_get_clips(id)`** just the finished clips of a job (MP4 + SRT + title + virality score).
- **`katto_get_transcript(id)`** the job's timestamped transcript segments.
- **`katto_list_jobs(limit?, cursor?, status?)`** your recent jobs, newest first (keyset pagination).
- **`katto_cancel_job(id)`** cancel a running job and refund the monthly video slot.
- **`katto_create_clip(id, start_seconds, end_seconds, aspect?, auto_reframe?)`** a new clip from any time range of the source (3-180 s, up to 10 per video, within 7 days). No quota.
- **`katto_more_clips(id, count?)`** render more clips from the moments Katto scored but did not render. No quota.

Editing (no quota):
- **`katto_rerender_clip(id, clip_index, layout_mode?, caption_style?)`** re-render one clip with a new reframe layout or caption style.
- **`katto_dub_clip(id, clip_index, languages)`** re-render a clip dubbed into one or more of 19 languages.
- **`katto_get_rerender(id, rerender_id)`** poll a re-render for the new versioned clip url.
- **`katto_translate_captions(id, clip_index, language)`** re-render a clip with its captions translated into one of 19 languages (Creator).
- **`katto_retitle_clip(id, clip_index, style? | title?)`** AI-regenerate a clip's title, or save your own.
- **`katto_adjust_clip(id, clip_index, start_offset_seconds?, end_offset_seconds?)`** trim or extend a clip (relative to its original bounds, 3-180 s; extending works within 7 days of the job) and re-render it.
- **`katto_add_hook(id, clip_index, text?, position?, duration?)`** burn a hook over the first seconds; without text, Katto's AI writes one.
- **`katto_generate_post_text(id, clip_index, platform?)`** AI-written title / caption / hashtags per platform, ready for `katto_publish_clip`. Nothing is posted.

Publishing:
- **`katto_list_connected_accounts()`** which of the 7 platforms are connected in Katto, and whether one needs a reconnect. Call it before publishing.
- **`katto_publish_clip(id, clip_index, platform, caption?, schedule_at?, ...)`** post a clip now or later to a social account connected in the Katto dashboard (YouTube, TikTok, LinkedIn, Instagram, Bluesky, Mastodon, Threads). Posts publicly: clients should confirm with the user first (annotated destructive). Paid plans; scheduling on Creator.
- **`katto_list_scheduled_posts(status?, limit?, cursor?)`** the scheduled posts, newest first, with their status and error.
- **`katto_cancel_scheduled_post(scheduled_post_id)`** cancel a post that has not gone out yet (annotated destructive).

Feedback:
- **`katto_rate_clip(id, clip_index, rating, reason?)`** record the user's good/bad verdict on a clip, like the thumbs on the results page.

Account and reference:
- **`katto_get_usage()`** your plan and remaining monthly video quota.
- **`katto_get_account()`** the connected account, this key's scopes, and quota.
- **`katto_get_brand_kit()`** your saved brand kits (colors, caption font, layout, watermark).
- **`katto_get_webhook_secret()`** your webhook signing secret and how to verify signed callbacks (returns a secret — treat it like a credential).
- **`katto_list_sources()`** the link sources Katto can clip from, with an example url each.
- **`katto_list_clip_lengths()`** the valid target clip-length buckets.
- **`katto_list_caption_styles()`** the caption-style presets you can pass as `caption_style` when creating a job or re-rendering a clip.

Jobs draw from your Katto plan's monthly video quota (25 on Creator, 10 on Solo, 2 on Free), with source videos up to 90, 60 and 30 minutes respectively. The underlying REST API also supports `Idempotency-Key` safe retries, read-only scoped keys, and signed HMAC webhooks. See the [docs](https://katto.tech/docs/api).

## Env

| var | required | default |
| --- | --- | --- |
| `KATTO_API_KEY` | yes | (none) |
| `KATTO_API_URL` | no | `https://katto.tech` |

Full docs: **[katto.tech/docs/api](https://katto.tech/docs/api)**

## Security & data

- **Hosted auth is OAuth 2.1** — the API key is never written to your disk, and you can revoke a connected client anytime from your Katto account settings.
- **Local auth uses a scoped `sk_live_` key** you create yourself; keys can be read-only, and the npx server only sends it to `KATTO_API_URL` (default `katto.tech`) over HTTPS.
- `katto_get_webhook_secret` returns a signing secret — handle it like any credential; it is only needed to verify inbound webhook signatures.

## Also listed on

- npm: [katto-mcp](https://www.npmjs.com/package/katto-mcp)
- GitHub: [miracleweasel/katto-mcp](https://github.com/miracleweasel/katto-mcp)
- [mcp.so](https://mcp.so/servers/katto) · [Smithery](https://smithery.ai/servers/dev-4lue/katto-mcp) · [Glama](https://glama.ai/mcp/servers/@miracleweasel/katto-mcp)
- Official MCP Registry: `io.github.miracleweasel/katto-mcp`

## Public Discovery

Katto – AI video clipping MCP server: turn long videos and podcasts into scored, captioned, reframed 9:16 clips, from any MCP client (Claude, Cursor, ChatGPT). Hosted, OAuth 2.1, no API key on disk.

Intents this server covers: *AI video clipping MCP server*, *MCP server for short-form video*, *MCP to turn podcasts into clips*, *video clipping for AI agents (Claude / Cursor / ChatGPT)*.

Example prompts:

1. "Clip the best moments from this podcast episode and reframe them for TikTok: `https://youtube.com/watch?v=…`"
2. "Check the status of my last clipping job and give me the download links for the finished clips."
3. "Take clip 2 from that job, dub it into Spanish and re-render it with the Bold caption style."

## License

MIT — see [LICENSE](./LICENSE).
