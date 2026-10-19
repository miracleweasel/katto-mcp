---
name: katto-clip
description: Turn a long video (a YouTube / Twitch / Kick / Vimeo / Zoom / Google Drive / Dropbox / Loom / LinkedIn / Facebook / Rumble / Dailymotion / Medal.tv link, a direct video-file link, or a local file) into scored, captioned, 9:16 short clips using Katto's cloud pipeline. Use when the user wants to clip, repurpose, or make shorts from long-form video, to dub / re-render / retitle / translate an existing clip, or to publish it to a connected social account.
---

# Katto clipping skill

Katto runs the whole pipeline in its cloud — download → transcript → moment scoring →
cut → captions → reframe → optional dub. You trigger it; nothing renders on the local
machine. `katto_publish_clip` posts to the social accounts the user connected in the Katto
app: **always get the user's explicit go-ahead first** (clip, platform, caption).
Local files: `katto_upload_video` → PUT the file → `katto_create_clip_job({ upload_id })`.

## Connect
- **Hosted MCP (recommended, zero-install):** point the client at `https://mcp.katto.tech/mcp`
  (OAuth 2.1 + Dynamic Client Registration; no key on disk).
- **Local:** `npx -y katto-mcp` with `KATTO_API_KEY=sk_live_...` (Cursor, CI, cron).
- Tools are prefixed `katto_`. `tools/list` works without a key; every tool **call** needs a key.

## Core flow
1. `katto_create_clip_job({ url, config? })` → returns a `job_id`. Spends **1 video** from the
   monthly quota. Pass `idempotency_key` (e.g. a UUID) when you might retry, so a retry never
   double-spends; pass `webhook_url` to be notified instead of polling.
2. Poll `katto_get_job({ id })` every 30–60 s until `status` is `"completed"`.
3. `katto_get_clips({ id })` → finished clips (MP4 url + SRT + title + score 0–100).

## More clips from the same video — never counts against quota
- `katto_more_clips({ id, count? })` → renders the next best moments Katto scored but skipped.
- `katto_create_clip({ id, start_seconds, end_seconds })` → a clip from any range (source seconds,
  3–180 s, up to 10 per video, within 7 days of the job). Poll `katto_get_clips`.

## Editing — never counts against quota
- `katto_rerender_clip({ id, clip_index, layout_mode?, caption_style? })`, then `katto_get_rerender(...)`.
- `katto_dub_clip({ id, clip_index, languages })` → dub into any of **19 languages**: en, es, fr, it, pt, hi, ja, zh, de, ko, nl, pl, ru, tr, id, vi, th, uk, ar.
- `katto_translate_captions({ id, clip_index, language })` → same 19 languages, captions only (Creator).
- `katto_retitle_clip({ id, clip_index, style? })` → new AI title (monthly allowance), or `{ title }` to set one.
- `katto_adjust_clip({ id, clip_index, start_offset_seconds?, end_offset_seconds? })` → trim (negative) or extend
  (positive) relative to the clip's original bounds, 3–180 s; extending only within 7 days of the job. Poll `katto_get_rerender`.
- `katto_add_hook({ id, clip_index, text?, position?, duration? })` → hook text over the first seconds (AI-written if no text).
- `katto_rate_clip({ id, clip_index, rating: "good"|"bad", reason? })` → only when the user gave a verdict.

## Publishing (paid plans; scheduling on Creator)
- First `katto_list_connected_accounts` → which platforms are connected (and `reconnect_required`).
- `katto_generate_post_text({ id, clip_index, platform? })` → AI caption / title / hashtags to show the user.
- `katto_publish_clip({ id, clip_index, platform, caption?, schedule_at? })` — YouTube, TikTok, LinkedIn,
  Instagram, Bluesky, Mastodon, Threads. Not connected → error with a `connect_url`: ask the user to
  connect it in the dashboard. TikTok needs `privacy_level` chosen by the user.
- `katto_list_scheduled_posts({ status? })` and `katto_cancel_scheduled_post({ scheduled_post_id })` (not yet published only).

## Reference / account
- `katto_get_usage`, `katto_get_account` — remaining quota, plan, this key's scopes.
- `katto_list_sources` (accepted platforms), `katto_list_clip_lengths` (valid length buckets).
- `katto_get_transcript` (timestamped), `katto_get_brand_kit`, `katto_get_webhook_secret` (treat as a credential).

## Rules of the road
- **One quota**, shared with the app and the API: Free = 2 videos/month (≤30 min each),
  Solo = 10 (≤60 min), Creator = 25 (≤90 min). Re-renders are free; dubbing is Creator only.
- If a call fails on quota, tell the user and give them the upgrade link included in the error.
- Captions: **99 languages** (word-timed in 41, sentence-level in the rest). Dubbing: **19**.
- **Don't invent timings.** The only measured figure is ~5 minutes for 8 clips on a 20-minute video;
  longer sources take longer. Say that, not a number you'd like.

## Example
User: *"Clip this podcast, then dub clip 2 in Spanish."*
→ `katto_create_clip_job({ url, idempotency_key })` → poll `katto_get_job` → `katto_get_clips`
(Katto decides how many clips the video holds: there is no clip-count parameter.)
→ `katto_dub_clip(id, 2, ["es"])` → `katto_get_rerender`.

Full reference: https://katto.tech/docs/api · OpenAPI: https://katto.tech/openapi.json
