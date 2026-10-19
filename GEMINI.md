# Katto (video clipping MCP server)

Katto turns a long video into scored, captioned 9:16 short clips in its cloud. Nothing renders locally.

## First run
The server is hosted at `https://mcp.katto.tech/mcp` and uses OAuth. If tool calls fail with an auth error, tell the user to run `/mcp auth katto` and sign in to their Katto account in the browser. `tools/list` works before sign-in.

## Core flow
1. `katto_create_clip_job({ url })` with a YouTube, Twitch, Kick, Vimeo, Zoom, Google Drive, Dropbox, Loom… link, or `katto_upload_video` first for a local file. This spends **1 video** of the user's monthly quota (2 on Free, 10 on Solo, 25 on Creator), so confirm before starting several jobs, and pass `idempotency_key` if you might retry.
2. Poll `katto_get_job({ id })` every 30–60 s until `status` is `completed` (a long video takes several minutes).
3. `katto_get_clips({ id })` returns the MP4 + SRT urls, titles and a 0–100 score per clip. Present the best-scored ones first.

## Follow-ups that don't spend a video
`katto_more_clips`, `katto_create_clip` (any time range), `katto_rerender_clip` (layout / caption style), `katto_adjust_clip` (trim / extend), `katto_retitle_clip` (AI titles have a monthly allowance), `katto_translate_captions` and `katto_dub_clip` (Creator plan). Check remaining quota with `katto_get_usage`.

## Publishing
`katto_publish_clip` posts to the social accounts the user connected in Katto. **Always get the user's explicit go-ahead first** (which clip, which platform, the caption).

Full tool reference: https://katto.tech/mcp/tools
