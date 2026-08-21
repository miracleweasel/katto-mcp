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

if (!API_KEY) {
  console.error("[katto-mcp] KATTO_API_KEY is required. Create one at https://katto.tech/dashboard/api-keys");
  process.exit(1);
}

async function api(path, init = {}) {
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
      "the clips finish asynchronously in ~5-7 min. Poll katto_get_job with the id until status is 'completed'.",
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
      "duration buckets).",
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
        caption_style: { type: "string", description: "A caption style preset name." },
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

const server = new Server({ name: "katto", version: "0.5.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

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
