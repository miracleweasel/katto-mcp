---
name: katto-clip
description: Turn a long video (a YouTube / Twitch / Vimeo / Rumble / Zoom / Dailymotion link, or an upload) into scored, captioned, 9:16 short clips using Katto's cloud pipeline. Use when the user wants to clip, repurpose, or make shorts from long-form video, or to dub / re-render an existing clip.
---

# Katto clipping skill

Katto runs the whole pipeline in its cloud — download → transcript → moment scoring →
cut → captions → reframe → optional dub → publish. You trigger it; nothing renders on
the local machine.

## Connect
- **Hosted MCP (recommended, zero-install):** point the client at `https://mcp.katto.tech/mcp`
  (OAuth 2.1 + Dynamic Client Registration; no key on disk).
- **Local:** `npx -y katto-mcp` with `KATTO_API_KEY=sk_live_...` (Cursor, CI, cron).
- Tools are prefixed `katto_`. `tools/list` works without a key; every tool **call** needs a key.

## Core flow
1. `katto_create_clip_job({ url, config? })` → returns a `job_id`. Spends **1 video** from the
   monthly quota. Pass an idempotency key so a retry never double-spends.
2. Poll `katto_get_job({ id })` until `status` is `"completed"`.
3. `katto_get_clips({ id })` → finished clips (MP4 url + SRT + title + score 0–100).

## Editing — never counts against quota
- `katto_rerender_clip({ id, clip_index, layout_mode?, caption_style? })`, then `katto_get_rerender(...)`.
- `katto_dub_clip({ id, clip_index, languages })` → dub into any of **8 languages**: en, es, fr, it, pt, hi, ja, zh.

## Reference / account
- `katto_get_usage`, `katto_get_account` — remaining quota, plan, this key's scopes.
- `katto_list_sources` (accepted platforms), `katto_list_clip_lengths` (valid length buckets).
- `katto_get_transcript` (timestamped), `katto_get_brand_kit`, `katto_get_webhook_secret` (treat as a credential).

## Rules of the road
- **One quota**, shared with the app / API / CLI: Creator = 25 videos/month, ≤90 min each; Free = 2/month.
  Re-renders and dubs are free.
- Captions: **99 languages** (word-timed in 41, sentence-level in the rest). Dubbing: **8**. Publish: **7 platforms**.
- **Don't invent timings.** The only measured figure is ~5 minutes for 8 clips on a 20-minute video;
  longer sources take longer. Say that, not a number you'd like.

## Example
User: *"Clip the best 6 moments from this podcast, then dub clip 2 in Spanish."*
→ `katto_create_clip_job(url, { clips: 6 })` → poll `katto_get_job` → `katto_get_clips`
→ `katto_dub_clip(id, 2, ["es"])` → `katto_get_rerender`.

Full reference: https://katto.tech/docs/api · OpenAPI: https://katto.tech/openapi.json
