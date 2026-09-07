# Katto — 60-second quickstart

Turn a long video into captioned 9:16 short clips from your assistant, your terminal, or
your code. **One quota** (Creator: 25 videos/mo, ≤90 min each · Free: 2/mo), shared across
all three. Create a key at https://katto.tech/dashboard/api-keys (keys can be read-only).

## MCP — in Claude, Cursor, ChatGPT
Hosted, zero-install, OAuth 2.1:
```json
{ "mcpServers": { "katto": { "url": "https://mcp.katto.tech/mcp" } } }
```
Then just ask: *"Clip the best 6 moments from <url> and caption them."*
Prefer local? `npx -y katto-mcp` with `KATTO_API_KEY=sk_live_...`.

## CLI — in your terminal or a cron
```bash
npm i -g katto-cli
katto login                        # or set KATTO_API_KEY=sk_live_...
katto clip <url> --clips 6 --wait --json | jq '.clips[].url'
```

## REST API — in your product
```bash
curl -X POST https://katto.tech/api/v1/jobs \
  -H "Authorization: Bearer sk_live_..." \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtube.com/watch?v=..."}'
# → { "job_id": "..." }
# then poll GET /v1/jobs/{id}, or pass a "webhook_url" for a signed completion callback.
```

What comes back: finished clips (MP4 + SRT captions + a title and a 0–100 score), 9:16,
word-timed captions, reframed. Re-render the layout/caption style or dub into 8 languages
for free (no quota). Full reference: https://katto.tech/docs/api
