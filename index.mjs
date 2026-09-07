#!/usr/bin/env node
/**
 * Katto MCP server — exposes the Katto clipping API as MCP tools so agents
 * (Claude, Cursor, ...) can turn long videos into scored 9:16 clips. Runs
 * locally over stdio and calls https://katto.tech/api/v1 with your API key.
 *
 * Config:
 *   KATTO_API_KEY  (required)  — create at https://katto.tech/dashboard/api-keys
 *   KATTO_API_URL  (optional)  — defaults to https://katto.tech
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API_URL = (process.env.KATTO_API_URL || "https://katto.tech").replace(/\/$/, "");
const API_KEY = process.env.KATTO_API_KEY;

// NOTE: we intentionally do NOT exit when the key is missing. The server must be
// able to start and answer tools/list WITHOUT a key so that MCP directory/aggregator
// sandboxes (Glama, mcp.so, ...) can enumerate the tools — otherwise they show
// "0 tools". Nothing runs unauthenticated: the key is enforced at call time in api()
// below, so tools/list is public but every tool CALL still requires a valid key.
if (!API_KEY) {
  console.error("[katto-mcp] No KATTO_API_KEY set — tools/list works, but calling any tool requires a key. Create one at https://katto.tech/dashboard/api-keys");
}

async function api(path, init = {}) {
  if (!API_KEY) {
    throw new Error("KATTO_API_KEY is required to call Katto tools. Create one at https://katto.tech/dashboard/api-keys and set it in your MCP client config.");
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const TOOLS = [
  {
    name: "katto_create_clip_job",
    description:
      "Submit a long video (YouTube, Twitch, Vimeo, Rumble, Zoom, Dailymotion) to Katto. Returns a job id; " +
      "the clips finish asynchronously. Poll katto_get_job with the id until status is 'completed'.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public video URL to clip." },
        config: {
          type: "object",
          description: "Optional pre-clip settings.",
          properties: {
            genre: { type: "string", description: "e.g. podcast, gaming, sports, interview" },
            clipLength: { type: "string", enum: ["lt30", "30_60", "60_90", "90_180"] },
            customPrompt: { type: "string" },
            topics: { type: "string" },
          },
        },
      },
      required: ["url"],
    },
  },
  {
    name: "katto_get_job",
    description:
      "Get the status and clips of a Katto job by id. When status is 'completed', 'clips' holds the finished " +
      "9:16 MP4 urls and caption (SRT) urls.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Job id from katto_create_clip_job." } },
      required: ["id"],
    },
  },
  {
    name: "katto_list_jobs",
    description:
      "List your recent Katto jobs, newest first. Paginate with 'cursor' (pass the previous next_cursor) and " +
      "optionally filter by 'status'. Returns { jobs: [{id, status, source, created_at, completed_at}], next_cursor }.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many jobs to return (1-100, default 20)." },
        cursor: { type: "string", description: "Pass the previous response's next_cursor for the next page." },
        status: { type: "string", description: "Optional filter, e.g. 'completed', 'queued', 'failed'." },
      },
    },
  },
  {
    name: "katto_get_clips",
    description:
      "Convenience: fetch just the finished clips of a job (9:16 MP4 urls + caption SRT urls). " +
      "Returns an empty list while the job is still processing.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Job id from katto_create_clip_job." } },
      required: ["id"],
    },
  },
  {
    name: "katto_get_usage",
    description:
      "Get your current plan and monthly video quota: { plan, videos_used, videos_limit, videos_remaining }.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "katto_get_transcript",
    description:
      "Get the compact transcript of a completed job as timestamped segments " +
      "[{ start, end, text }]. Returns 404 while the job is still processing.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Job id from katto_create_clip_job." } },
      required: ["id"],
    },
  },
  {
    name: "katto_cancel_job",
    description:
      "Cancel a still-running job (queued/processing) and refund the monthly video slot. " +
      "Returns an error if the job already finished, failed, or was cancelled.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Job id from katto_create_clip_job." } },
      required: ["id"],
    },
  },
  {
    name: "katto_get_account",
    description:
      "Get the account behind this key: plan, this key's scopes, and monthly quota " +
      "{ videos_used, videos_limit, videos_remaining }.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "katto_list_sources",
    description:
      "List the video platforms Katto can clip from, with an example URL for each. Use this to confirm a " +
      "URL is supported before calling katto_create_clip_job.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "katto_list_clip_lengths",
    description:
      "List the valid values for the optional config.clipLength on katto_create_clip_job (target clip " +
      "duration buckets). Note: clipLength is fixed at job creation and cannot be changed by re-render.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "katto_list_caption_styles",
    description:
      "List the valid caption_style preset names for katto_rerender_clip (e.g. 'hormozi' for bold " +
      "word-by-word highlight). Call this before re-rendering so you pass a real preset, not a guess.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "katto_rerender_clip",
    description:
      "Re-render one finished clip with a new reframe layout and/or caption style. Does NOT use video quota. " +
      "Returns a rerender_id; poll katto_get_rerender for the new clip url.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Job id from katto_create_clip_job." },
        clip_index: { type: "number", description: "0-based index of the clip to re-render." },
        layout_mode: {
          type: "string",
          enum: ["face_tracking", "wide", "split_screen", "stacked", "passthrough", "grid_3", "grid_4"],
        },
        caption_style: {
          type: "string",
          // Keep in sync with CAPTION_STYLES below (katto_list_caption_styles).
          enum: ["default", "hormozi", "yellowPop", "redAlert", "skyline", "bubblegum", "aqua", "violet", "headline", "centerPop", "topLime", "impactMax", "bebasGold", "robotoBold", "montserratClean", "poppinsSoft", "robotoDoc", "broadcast", "wideClean", "mono", "bebasWhite", "rainbow", "multicolor"],
          description: "A caption style preset name. See katto_list_caption_styles for the labels.",
        },
      },
      required: ["id", "clip_index"],
    },
  },
  {
    name: "katto_dub_clip",
    description:
      "Re-render one finished clip dubbed into one or more languages (en, es, fr, it, pt, hi, ja, zh). Does " +
      "NOT use video quota. Returns a rerender_id; poll katto_get_rerender for the result.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Job id." },
        clip_index: { type: "number", description: "0-based clip index." },
        languages: {
          type: "array",
          items: { type: "string", enum: ["en", "es", "fr", "it", "pt", "hi", "ja", "zh"] },
        },
      },
      required: ["id", "clip_index", "languages"],
    },
  },
  {
    name: "katto_get_rerender",
    description:
      "Poll a re-render started by katto_rerender_clip or katto_dub_clip. Returns { status, clip_url, captions_url }.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Job id." },
        rerender_id: { type: "string", description: "The rerender_id returned by rerender/dub." },
      },
      required: ["id", "rerender_id"],
    },
  },
  {
    name: "katto_get_brand_kit",
    description:
      "Get your saved brand kits (colors, caption font and position, default layout, watermark url).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "katto_get_webhook_secret",
    description:
      "Get your webhook signing secret and how to verify Katto's signed completion callbacks " +
      "(HMAC-SHA256 of {timestamp}.{body}). Pass webhook_url on a job to receive them.",
    inputSchema: { type: "object", properties: {} },
  },
];

// Tool behaviour hints (MCP annotations). Required by the Claude Connectors
// Directory review: every tool must declare read-only vs write, plus
// destructive / idempotent / open-world semantics, so a client can gate calls.
// All four hints are declared on every tool (explicit > omitted for reviewers).
// Read tools: read-only, non-destructive, idempotent, closed-world. Writes flip
// readOnlyHint. create_clip_job fetches a user URL (openWorld) + spends 1 quota
// slot (not idempotent). rerender/dub each spawn a NEW render (not idempotent —
// unsafe to blindly retry). cancel_job is the only destructive tool.
const ANNOTATIONS = {
  katto_create_clip_job: { title: "Create clip job", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  katto_get_job: { title: "Get job status & clips", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  katto_list_jobs: { title: "List jobs", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  katto_get_clips: { title: "Get finished clips", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  katto_get_usage: { title: "Get plan & quota", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  katto_get_transcript: { title: "Get transcript", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  katto_cancel_job: { title: "Cancel job & refund slot", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  katto_get_account: { title: "Get account", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  katto_list_sources: { title: "List supported sources", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  katto_list_clip_lengths: { title: "List clip-length options", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  katto_list_caption_styles: { title: "List caption styles", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  katto_rerender_clip: { title: "Re-render a clip", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  katto_dub_clip: { title: "Dub a clip", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  katto_get_rerender: { title: "Poll a re-render", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  katto_get_brand_kit: { title: "Get brand kits", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  katto_get_webhook_secret: { title: "Get webhook signing secret", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

// Agent-facing descriptions (when to call, returns, errors, quota cost). Served
// on tools/list — identical across all sources, enriching the terser inline text.
const DESCRIPTIONS = {
  katto_create_clip_job: "Submit a long video (YouTube, Twitch, Vimeo, Rumble, Zoom, Dailymotion) for clipping. Consumes 1 video from your monthly quota — check katto_get_usage first. Clips are produced asynchronously; returns a job id, then poll katto_get_job until status is 'completed'. Fails if the URL is unsupported or the video is over 90 minutes.",
  katto_get_job: "Read-only. Get the status, progress and clips of a job by id. Clips come ranked by virality score (0-100, highest first; ties broken by clip_index). Each clip is { url, captions_url, title, score, clip_index, hd }: when status is 'completed' every url is a finished, downloadable clip; hd is true once the 1080p high-quality render is ready. hd=false does NOT mean broken — the url already works, the 1080p is just still rendering in the background (and stays the standard render on the free plan). The job-level hd_ready flag turns true once every clip is hd, i.e. the URLs are final and won't be swapped again (status='completed' fires earlier). Returns 404 for an unknown id.",
  katto_list_jobs: "Read-only. List your recent jobs, newest first. Paginate with 'cursor' (pass the previous next_cursor); optional 'status' filter. Returns { jobs: [{id, status, source, created_at, completed_at}], next_cursor }.",
  katto_get_clips: "Read-only convenience: the clips of a job as { url, captions_url, title, score, clip_index, hd }, ranked by score (highest first). hd=true means the 1080p render is ready; hd=false means the url is the standard render (HD still finishing, or the free plan). Empty until the first clip is ready.",
  katto_get_usage: "Read-only. Your current plan and monthly video quota: { plan, videos_used, videos_limit, videos_remaining }. Call before katto_create_clip_job to confirm remaining quota.",
  katto_get_transcript: "Read-only. The transcript of a completed job as timestamped segments [{ start, end, text }]. Returns 404 while the job is still processing.",
  katto_cancel_job: "Cancel a still-running job (queued/processing) and refund the video back to your monthly quota. Safe to retry (idempotent). Returns an error if the job already finished, failed, or was cancelled.",
  katto_get_account: "Read-only. The account behind this key: plan, this key's scopes (read/write), and monthly quota { videos_used, videos_limit, videos_remaining }.",
  katto_list_sources: "Read-only. The video platforms Katto can clip from, each with an example URL. Use it to confirm a URL is supported before calling katto_create_clip_job.",
  katto_list_clip_lengths: "Read-only. The valid values for the optional config.clipLength on katto_create_clip_job (target clip-duration buckets). Note: clipLength is fixed at creation and cannot be changed by re-render.",
  katto_list_caption_styles: "Read-only. The valid caption_style preset names for katto_rerender_clip (id + label), e.g. 'hormozi' for bold word-by-word highlight. Call this before re-rendering so you pass a real preset instead of guessing.",
  katto_rerender_clip: "Re-render one already-finished clip with a new reframe layout and/or caption style (get valid caption_style values from katto_list_caption_styles). Free — does NOT use video quota. Each call starts a new render (not idempotent); the original clip is kept. Returns a rerender_id; poll katto_get_rerender for the new clip url.",
  katto_dub_clip: "Re-render one finished clip dubbed into one or more of 8 languages (en, es, fr, it, pt, hi, ja, zh). Free — does NOT use video quota. Each call starts a new render (not idempotent). Returns a rerender_id; poll katto_get_rerender for the result.",
  katto_get_rerender: "Read-only. Poll a re-render started by katto_rerender_clip or katto_dub_clip. Returns { status, clip_url, captions_url } — clip_url is null until status is 'completed'.",
  katto_get_brand_kit: "Read-only. Your saved brand kits (colors, caption font and position, default layout, watermark url).",
  katto_get_webhook_secret: "Read-only. Returns your webhook signing SECRET — treat it as a credential (do not display or log it) — plus how to verify Katto's signed completion callbacks (HMAC-SHA256 of {timestamp}.{body}). Pass webhook_url on a job to receive them.",
};

// TOOLS enriched with agent descriptions + annotations — served on tools/list.
const TOOLS_LISTED = TOOLS.map((t) => ({
  ...t,
  description: DESCRIPTIONS[t.name] ?? t.description,
  ...(ANNOTATIONS[t.name] ? { annotations: ANNOTATIONS[t.name] } : {}),
}));

// Static reference data — returned by the list_* tools without an API call.
const SOURCES = [
  { id: 'youtube', example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  { id: 'twitch', example: 'https://www.twitch.tv/videos/123456789' },
  { id: 'vimeo', example: 'https://vimeo.com/123456789' },
  { id: 'rumble', example: 'https://rumble.com/v1a2b3c-title.html' },
  { id: 'zoom', example: 'https://zoom.us/rec/share/abc123' },
  { id: 'dailymotion', example: 'https://www.dailymotion.com/video/x8abcde' },
];
const CLIP_LENGTHS = [
  { value: 'lt30', label: 'Under 30 seconds' },
  { value: '30_60', label: '30 to 60 seconds' },
  { value: '60_90', label: '60 to 90 seconds' },
  { value: '90_180', label: '90 to 180 seconds' },
];
// Valid values for caption_style on katto_rerender_clip. Mirrors the editor's
// named presets. Keep in sync with mcp-worker/src/index.js CAPTION_STYLES.
const CAPTION_STYLES = [
  { value: 'default', label: 'Default' },
  { value: 'hormozi', label: 'Hormozi (bold word-by-word highlight)' },
  { value: 'yellowPop', label: 'Yellow Pop' },
  { value: 'redAlert', label: 'Red Alert' },
  { value: 'skyline', label: 'Skyline' },
  { value: 'bubblegum', label: 'Bubblegum' },
  { value: 'aqua', label: 'Aqua' },
  { value: 'violet', label: 'Violet' },
  { value: 'headline', label: 'Headline' },
  { value: 'centerPop', label: 'Center Pop' },
  { value: 'topLime', label: 'Top Lime' },
  { value: 'impactMax', label: 'Impact Max' },
  { value: 'bebasGold', label: 'Bebas Gold' },
  { value: 'robotoBold', label: 'Roboto Bold' },
  { value: 'montserratClean', label: 'Montserrat' },
  { value: 'poppinsSoft', label: 'Poppins' },
  { value: 'robotoDoc', label: 'Roboto Doc' },
  { value: 'broadcast', label: 'Broadcast' },
  { value: 'wideClean', label: 'Wide Clean' },
  { value: 'mono', label: 'Mono' },
  { value: 'bebasWhite', label: 'Bebas' },
  { value: 'rainbow', label: 'Rainbow (per-word colour cycle)' },
  { value: 'multicolor', label: 'Multicolor' },
];

const server = new Server({ name: "katto", version: "0.5.5" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS_LISTED }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let data;
    if (name === "katto_create_clip_job") {
      data = await api("/api/v1/jobs", {
        method: "POST",
        body: JSON.stringify({ url: args.url, config: args.config }),
      });
    } else if (name === "katto_get_job") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}`);
    } else if (name === "katto_list_jobs") {
      const qs = new URLSearchParams();
      if (args.limit != null) qs.set("limit", String(args.limit));
      if (args.cursor) qs.set("cursor", String(args.cursor));
      if (args.status) qs.set("status", String(args.status));
      const q = qs.toString();
      data = await api(`/api/v1/jobs${q ? `?${q}` : ""}`);
    } else if (name === "katto_get_clips") {
      const job = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}`);
      data = { id: job.id, status: job.status, clips: job.clips || [] };
    } else if (name === "katto_get_usage") {
      data = await api("/api/v1/usage");
    } else if (name === "katto_get_transcript") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/transcript`);
    } else if (name === "katto_cancel_job") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}`, { method: "DELETE" });
    } else if (name === "katto_get_account") {
      data = await api("/api/v1/me");
    } else if (name === "katto_list_sources") {
      data = { sources: SOURCES, note: "You can also clip a local file via the REST API (POST /v1/uploads)." };
    } else if (name === "katto_list_clip_lengths") {
      data = { clip_lengths: CLIP_LENGTHS };
    } else if (name === "katto_list_caption_styles") {
      data = { caption_styles: CAPTION_STYLES };
    } else if (name === "katto_rerender_clip") {
      const b = {};
      if (args.layout_mode) b.layout_mode = args.layout_mode;
      if (args.caption_style) b.caption_style = args.caption_style;
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/clips/${encodeURIComponent(args.clip_index)}/rerender`, { method: "POST", body: JSON.stringify(b) });
    } else if (name === "katto_dub_clip") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/clips/${encodeURIComponent(args.clip_index)}/rerender`, { method: "POST", body: JSON.stringify({ dub: args.languages || [] }) });
    } else if (name === "katto_get_rerender") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/rerenders/${encodeURIComponent(args.rerender_id)}`);
    } else if (name === "katto_get_brand_kit") {
      data = await api("/api/v1/brand-kit");
    } else if (name === "katto_get_webhook_secret") {
      data = await api("/api/v1/webhook");
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[katto-mcp] ready");
