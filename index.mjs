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
];

const server = new Server({ name: "katto", version: "0.3.0" }, { capabilities: { tools: {} } });

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
