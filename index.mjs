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
      "Submit a long video to Katto by public link (YouTube, Twitch, Kick, Vimeo, Zoom, Google Drive, Dropbox, Loom, LinkedIn, Facebook, Rumble, Dailymotion, Medal.tv, or a direct https link to a video file) " +
      "or as a file uploaded with katto_upload_video (pass upload_id). Returns a job id; the clips finish asynchronously. " +
      "Poll katto_get_job with the id until status is 'completed'.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public video URL to clip (YouTube, Twitch, Kick, Vimeo, Zoom, Google Drive, Dropbox, Loom, LinkedIn, Facebook, Rumble, Dailymotion, Medal.tv, or a direct https link to a video file). Pass url OR upload_id." },
        upload_id: { type: "string", description: "Instead of url: the upload_id returned by katto_upload_video, once the file has been PUT to its upload_url. Starts clipping that file." },
        webhook_url: { type: "string", description: "Optional https URL that receives a signed POST when the job finishes, so you do not have to poll. Verify the signature with the secret from katto_get_webhook_secret. Private and local addresses are refused." },
        idempotency_key: { type: "string", description: "Optional unique string (max 255 chars). Retrying with the same key returns the original job instead of creating a second one and spending another video. Use one per intended job, e.g. a UUID." },
        config: {
          type: "object",
          description: "Optional pre-clip settings.",
          properties: {
            genre: { type: "string", description: "e.g. podcast, gaming, sports, interview" },
            clipLength: { type: "string", enum: ["lt30", "30_60", "60_90", "90_180"], description: "Target length band for the clips, in seconds. Guides candidate selection by setting a minimum and maximum duration; it is a preference, not a hard cut. Omit to let the model decide." },
            customPrompt: { type: "string", description: "Free-text hint about what matters in this video. Its keywords nudge selection toward matching moments. It does not filter: a clip that matches nothing can still be selected if it scores well." },
            topics: { type: "string", description: "Comma-separated topics to favour. Merged with customPrompt into a single keyword hint, so both bias the ranking rather than restrict it." },
          },
        },
      },
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
          description: "Force a reframing layout instead of letting detection choose one. Omit for automatic, which is what produces the best result on most clips.",
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
      "Re-render one finished clip dubbed into one or more of 19 languages (en, es, fr, it, pt, hi, ja, zh, de, ko, nl, pl, ru, tr, id, vi, th, uk, ar). Does " +
      "NOT use video quota. Returns a rerender_id; poll katto_get_rerender for the result.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Job id." },
        clip_index: { type: "number", description: "0-based clip index." },
        languages: {
          type: "array",
          description: "Target languages for the dub, as ISO 639-1 codes. Nineteen are available; the clip keeps its original audio for any language not listed here.",
          items: { type: "string", enum: ["en", "es", "fr", "it", "pt", "hi", "ja", "zh", "de", "ko", "nl", "pl", "ru", "tr", "id", "vi", "th", "uk", "ar"] },
        },
      },
      required: ["id", "clip_index", "languages"],
    },
  },
  {
    name: "katto_get_rerender",
    description:
      "Poll a re-render started by katto_rerender_clip or katto_dub_clip. Returns { status, clip_url, captions_url, dub_urls } — dub_urls is { lang: url } and is where a DUB lands (clip_url stays the undubbed re-render), null otherwise.",
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
  {
    name: "katto_create_clip",
    description:
      "Create a NEW clip from a time range of a completed job's source video (start/end in source seconds). " +
      "Does not use video quota. Returns expected_clip_index; poll katto_get_clips until it appears.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Job id of a completed job (from katto_create_clip_job)." },
        start_seconds: { type: "number", description: "Start of the clip, in seconds of the SOURCE video (read timestamps from katto_get_transcript)." },
        end_seconds: { type: "number", description: "End of the clip, in seconds of the source video. The clip must last 3 to 180 seconds." },
        aspect: { type: "string", enum: ["9:16", "1:1", "16:9"], description: "Output aspect ratio. Omit to keep the job's setting (9:16 by default)." },
        auto_reframe: { type: "boolean", description: "false = plain center crop instead of following the speaker. Omit for automatic reframing." },
      },
      required: ["id", "start_seconds", "end_seconds"],
    },
  },
  {
    name: "katto_more_clips",
    description:
      "Render more clips from a job's reserve (moments that were scored but not rendered). Does not use video quota. " +
      "New clips are appended to the job; poll katto_get_clips.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Job id from katto_create_clip_job." },
        count: { type: "number", description: "How many extra clips to render (1-10, default 5). Capped by what is left in the reserve." },
      },
      required: ["id"],
    },
  },
  {
    name: "katto_upload_video",
    description:
      "Start clipping a LOCAL video file: returns a presigned upload_url to PUT the file to, then call " +
      "katto_create_clip_job with upload_id. Use this when the video is a file, not a public link.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "The file's name, e.g. episode-12.mp4 (display only)." },
        content_type: { type: "string", enum: ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"], description: "MIME type of the file: mp4, mov (quicktime), webm or mkv (x-matroska)." },
        size: { type: "number", description: "Exact file size in bytes. Checked against your plan's upload limit before anything is reserved." },
      },
      required: ["filename", "content_type", "size"],
    },
  },
  {
    name: "katto_translate_captions",
    description:
      "Translate a finished clip's burned-in captions into another language and re-render it (the audio is unchanged; " +
      "use katto_dub_clip for voice). Returns a rerender_id; poll katto_get_rerender.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Job id." },
        clip_index: { type: "number", description: "0-based clip index." },
        language: {
          type: "string",
          description: "Target caption language, ISO 639-1.",
          enum: ["en", "es", "fr", "it", "pt", "hi", "ja", "zh", "de", "ko", "nl", "pl", "ru", "tr", "id", "vi", "th", "uk", "ar"],
        },
      },
      required: ["id", "clip_index", "language"],
    },
  },
  {
    name: "katto_retitle_clip",
    description:
      "Give a clip a new title: AI-regenerate one (optionally in a style), or save a title you pass. Returns { title }.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Job id." },
        clip_index: { type: "number", description: "0-based clip index." },
        style: { type: "string", enum: ["energetic", "descriptive", "fun", "shocking"], description: "Tone of the AI-generated title. Ignored when title is given." },
        title: { type: "string", description: "Save this exact title instead of generating one (max 200 characters). Costs nothing." },
      },
      required: ["id", "clip_index"],
    },
  },
  {
    name: "katto_publish_clip",
    description:
      "Publish (or schedule) a finished clip to one of the user's connected social accounts. Public and irreversible: " +
      "get the user's explicit confirmation of the clip, platform and caption first. Call katto_list_connected_accounts first.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Job id." },
        clip_index: { type: "number", description: "0-based clip index." },
        platform: { type: "string", enum: ["youtube", "tiktok", "linkedin", "instagram", "bluesky", "mastodon", "threads"], description: "Where to post. The account must already be connected in the Katto dashboard." },
        caption: { type: "string", description: "Post text. On YouTube it is used as the title and description unless title/description are given." },
        title: { type: "string", description: "YouTube video title (max 100 characters). Defaults to the caption, then the clip's title." },
        description: { type: "string", description: "YouTube description. Defaults to the caption." },
        tags: { type: "array", items: { type: "string" }, description: "YouTube tags." },
        privacy_status: { type: "string", enum: ["public", "unlisted", "private"], description: "YouTube visibility (defaults to public)." },
        schedule_at: { type: "string", description: "Optional ISO 8601 date-time to publish later instead of now (future, at most 7 days ahead). Scheduling is a Creator feature." },
        privacy_level: { type: "string", enum: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"], description: "TikTok only, REQUIRED for TikTok: who can see the post. Must be chosen by the user, never assumed." },
        disable_comment: { type: "boolean", description: "TikTok only: turn comments off." },
        disable_duet: { type: "boolean", description: "TikTok only: turn duets off." },
        disable_stitch: { type: "boolean", description: "TikTok only: turn stitches off." },
        brand_content: { type: "boolean", description: "TikTok only: the post is a paid partnership (labelled 'Paid partnership'; cannot be SELF_ONLY)." },
        brand_organic: { type: "boolean", description: "TikTok only: the post promotes the user's own business (labelled 'Promotional content')." },
      },
      required: ["id", "clip_index", "platform"],
    },
  },
  {
    name: "katto_list_connected_accounts",
    description:
      "List which social platforms (YouTube, TikTok, LinkedIn, Instagram, Bluesky, Mastodon, Threads) the user connected in Katto, " +
      "with the account name and whether a reconnect is needed. Call before katto_publish_clip.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "katto_list_scheduled_posts",
    description:
      "List the user's scheduled social posts, newest first: { scheduled_posts: [{ id, job_id, clip_index, platform, scheduled_at, status, error }], next_cursor }.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "posting", "posted", "failed"], description: "Optional filter: pending (waiting for its time), posting, posted, failed." },
        limit: { type: "number", description: "How many posts to return (1-100, default 20)." },
        cursor: { type: "string", description: "Pass the previous response's next_cursor for the next page." },
      },
    },
  },
  {
    name: "katto_cancel_scheduled_post",
    description:
      "Cancel a scheduled post that has not been published yet (pending or failed). Get its id from katto_list_scheduled_posts.",
    inputSchema: {
      type: "object",
      properties: {
        scheduled_post_id: { type: "string", description: "The scheduled post id (scheduled_post_id from katto_publish_clip, or id from katto_list_scheduled_posts)." },
      },
      required: ["scheduled_post_id"],
    },
  },
  {
    name: "katto_generate_post_text",
    description:
      "Write platform-ready post text for a clip (title, description/caption, hashtags) with AI, per platform. Returns text only; nothing is posted.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Job id." },
        clip_index: { type: "number", description: "0-based clip index." },
        platform: { type: "string", enum: ["youtube", "tiktok", "linkedin", "instagram", "bluesky", "mastodon", "threads"], description: "Platform to write for. Omit to get text for all seven." },
      },
      required: ["id", "clip_index"],
    },
  },
  {
    name: "katto_adjust_clip",
    description:
      "Make a clip shorter or longer by moving its start and/or end, then re-render it. Returns a rerender_id; poll katto_get_rerender.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Job id." },
        clip_index: { type: "number", description: "0-based clip index." },
        start_offset_seconds: { type: "number", description: "Seconds to move the START: positive starts earlier (extends), negative starts later (trims). Relative to the clip's original start." },
        end_offset_seconds: { type: "number", description: "Seconds to move the END: positive ends later (extends), negative ends earlier (trims). Relative to the clip's original end." },
      },
      required: ["id", "clip_index"],
    },
  },
  {
    name: "katto_add_hook",
    description:
      "Burn a hook (big text over the first seconds) into a clip and re-render it. Without text, Katto's AI writes one. Returns a rerender_id; poll katto_get_rerender.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Job id." },
        clip_index: { type: "number", description: "0-based clip index." },
        text: { type: "string", description: "The hook to display (max 80 characters; 3-7 words reads best). Omit to let Katto write one from the clip." },
        position: { type: "string", enum: ["top", "center"], description: "Where the hook sits on the frame (default top)." },
        duration: { type: "number", description: "How many seconds the hook stays on screen, 1-10 (default 4)." },
      },
      required: ["id", "clip_index"],
    },
  },
  {
    name: "katto_rate_clip",
    description:
      "Record the user's verdict on a clip (good or bad, optional reason), like the thumbs up/down on the results page. Helps Katto pick better clips.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Job id." },
        clip_index: { type: "number", description: "0-based clip index." },
        rating: { type: "string", enum: ["good", "bad"], description: "The user's verdict on the clip." },
        reason: { type: "string", description: "Optional: why, in the user's words (max 2000 characters)." },
      },
      required: ["id", "clip_index", "rating"],
    },
  },
];

// Tool behaviour hints (MCP annotations). Required by the Claude Connectors
// Directory review: every tool must declare read-only vs write, plus
// destructive / idempotent / open-world semantics, so a client can gate calls.
// All four hints are declared on every tool (explicit > omitted for reviewers).
// Read tools: read-only, non-destructive, idempotent, closed-world. Writes flip
// readOnlyHint. create_clip_job fetches a user URL (openWorld) + spends 1 quota
// slot (not idempotent). rerender/dub each spawn a NEW render (not idempotent —
// unsafe to blindly retry), as are create_clip / more_clips / translate / retitle /
// upload. publish_clip posts publicly on the user's account (destructive, open-world,
// never idempotent) and cancel_job refunds a running job. cancel_scheduled_post removes a
// pending post (destructive, idempotent). generate_post_text / adjust_clip / add_hook each
// spend an AI call or a render (not idempotent); rate_clip records a verdict (idempotent).
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
  katto_create_clip: { title: "Create a clip from a time range", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  katto_more_clips: { title: "Render more clips from the reserve", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  katto_upload_video: { title: "Upload a local video", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  katto_translate_captions: { title: "Translate a clip's captions", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  katto_retitle_clip: { title: "Retitle a clip", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  katto_publish_clip: { title: "Publish a clip to social media", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  katto_list_connected_accounts: { title: "List connected social accounts", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  katto_list_scheduled_posts: { title: "List scheduled posts", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  katto_cancel_scheduled_post: { title: "Cancel a scheduled post", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  katto_generate_post_text: { title: "Write post text for a clip", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  katto_adjust_clip: { title: "Trim or extend a clip", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  katto_add_hook: { title: "Add a hook to a clip", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  katto_rate_clip: { title: "Rate a clip", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

// Agent-facing descriptions (when to call, returns, errors, quota cost). Served
// on tools/list — identical across all sources, enriching the terser inline text.
const DESCRIPTIONS = {
  katto_create_clip_job: "Submit a long video for clipping, either by public link in url (YouTube, Twitch, Kick, Vimeo, Zoom, Google Drive, Dropbox, Loom, LinkedIn, Facebook, Rumble, Dailymotion, Medal.tv, or a direct https link to a video file; Google Drive and Dropbox links must be shared publicly) or, for a local file, by upload_id after katto_upload_video and the PUT of the file. Pass exactly one of url or upload_id. Consumes 1 video from your monthly quota — check katto_get_usage first. Clips are produced asynchronously; returns a job id, then poll katto_get_job every 30-60 s until status is 'completed', or pass webhook_url to be notified (url jobs only). Pass idempotency_key when you might retry a url job, so a retry never spends a second video (an upload can only be started once anyway). Fails if the URL is unsupported, the uploaded file is missing, or the video is longer than your plan allows.",
  katto_get_job: "Read-only. Get the status, progress and clips of a job by id. Clips come ranked by virality score (0-100, highest first; ties broken by clip_index). Each clip is { url, captions_url, title, score, clip_index, hd }: when status is 'completed' every url is a finished, downloadable clip; hd is true once the 1080p high-quality render is ready. hd=false does NOT mean broken — the url already works, the 1080p is just still rendering in the background (and stays the standard render on the free plan). The job-level hd_ready flag turns true once every clip is hd, i.e. the URLs are final and won't be swapped again (status='completed' fires earlier). Returns 404 for an unknown id.",
  katto_list_jobs: "Read-only. List your recent jobs, newest first. Paginate with 'cursor' (pass the previous next_cursor); optional 'status' filter. Returns { jobs: [{id, status, source, created_at, completed_at}], next_cursor }.",
  katto_get_clips: "Read-only convenience: the clips of a job as { url, captions_url, title, score, clip_index, hd }, ranked by score (highest first). hd=true means the 1080p render is ready; hd=false means the url is the standard render (HD still finishing, or the free plan). Empty until the first clip is ready.",
  katto_get_usage: "Read-only. Your current plan and monthly video quota: { plan, videos_used, videos_limit, videos_remaining }. Call before katto_create_clip_job to confirm remaining quota.",
  katto_get_transcript: "Read-only. The transcript of a completed job as timestamped segments [{ start, end, text }]. Returns 404 while the job is still processing.",
  katto_cancel_job: "Cancel a still-running job (queued/processing) and refund the video back to your monthly quota. Safe to retry (idempotent). Returns an error if the job already finished, failed, or was cancelled.",
  katto_get_account: "Read-only. The account behind this key: plan, this key's scopes (read/write), and monthly quota { videos_used, videos_limit, videos_remaining }.",
  katto_list_sources: "Read-only. The link sources Katto can clip from (YouTube, Twitch, Kick, Vimeo, Zoom, Google Drive, Dropbox, Loom, LinkedIn, Facebook, Rumble, Dailymotion, Medal.tv, or a direct https link to a video file), each with an example URL. Use it to confirm a URL is supported before calling katto_create_clip_job; for a local file use katto_upload_video instead.",
  katto_list_clip_lengths: "Read-only. The valid values for the optional config.clipLength on katto_create_clip_job (target clip-duration buckets). Note: clipLength is fixed at creation and cannot be changed by re-render.",
  katto_list_caption_styles: "Read-only. The valid caption_style preset names for katto_rerender_clip (id + label), e.g. 'hormozi' for bold word-by-word highlight. Call this before re-rendering so you pass a real preset instead of guessing.",
  katto_rerender_clip: "Re-render one already-finished clip with a new reframe layout and/or caption style (get valid caption_style values from katto_list_caption_styles). Free — does NOT use video quota. Each call starts a new render (not idempotent); the original clip is kept. Returns a rerender_id; poll katto_get_rerender for the new clip url.",
  katto_dub_clip: "Re-render one finished clip dubbed into one or more of 19 languages (en, es, fr, it, pt, hi, ja, zh, de, ko, nl, pl, ru, tr, id, vi, th, uk, ar). Creator feature (requires an active subscription); does NOT use your monthly video quota. Each call starts a new render (not idempotent). Returns a rerender_id; poll katto_get_rerender for the result.",
  katto_get_rerender: "Read-only. Poll a re-render started by katto_rerender_clip or katto_dub_clip. Returns { status, clip_url, captions_url, dub_urls } — dub_urls is { lang: url } and is where a DUB lands (clip_url stays the undubbed re-render), null otherwise — clip_url is null until status is 'completed'.",
  katto_get_brand_kit: "Read-only. Your saved brand kits (colors, caption font and position, default layout, watermark url).",
  katto_get_webhook_secret: "Read-only. Returns your webhook signing SECRET — treat it as a credential (do not display or log it) — plus how to verify Katto's signed completion callbacks (HMAC-SHA256 of {timestamp}.{body}). Pass webhook_url on a job to receive them.",
  katto_create_clip: "Create a NEW clip from any time range of a completed job's source video, when the user wants a moment Katto did not pick. start_seconds/end_seconds are SOURCE-video seconds (take them from katto_get_transcript segments); the clip must last 3-180 s. Does NOT use video quota. Limits: at most 10 created clips per video, one clip in preparation at a time (409 'Another clip is being prepared' = wait and retry), and only within 7 days of the job (410 after that: the source is no longer kept). Captions come from the words Katto already timed; has_captions=false means that range had none and the clip renders without captions. Not idempotent: each call queues another clip. Returns expected_clip_index; poll katto_get_clips every 15-30 s until a clip with that clip_index appears.",
  katto_more_clips: "Render more clips from a job's reserve: moments Katto scored but did not render, best first. Use when the user wants more clips from the same video. Does NOT use video quota. count is 1-10 (default 5), capped by what is left. Returns { status: 'queued'|'pending'|'empty', requested, remaining }: 'pending' means a request is already running (do not call again), 'empty' means the reserve is used up. New clips are appended to the job; poll katto_get_clips.",
  katto_upload_video: "Step 1 of clipping a LOCAL file (when the user has a file, not a public link). Pass the exact filename, MIME type and size in bytes; the size is checked against the plan's upload limit and the monthly quota is checked (not yet spent). Returns { upload_id, upload_url, headers, expires_in, next_steps }. Then: (2) HTTP PUT the raw file bytes to upload_url with exactly the returned Content-Type header (e.g. curl -X PUT -H 'Content-Type: video/mp4' --upload-file ./file.mp4 '<upload_url>'), before expires_in seconds; (3) call katto_create_clip_job with upload_id: that verifies the file arrived, spends 1 video of quota and starts clipping; (4) poll katto_get_job with id = upload_id. You need a tool that can make an HTTP PUT with a file body (shell, code execution); if you have none, give the user the upload_url and the curl command.",
  katto_translate_captions: "Translate one finished clip's burned-in captions into one of 19 languages and re-render it with them; word timings are kept and the original clip is preserved. Only the captions change: for a translated VOICE use katto_dub_clip. Creator feature (requires an active Creator subscription; otherwise an error with code upgrade_required and a pricing link to give the user). Does NOT use video quota. Not idempotent: each call starts a new render. Returns a rerender_id; poll katto_get_rerender until status is 'completed' for the new clip_url.",
  katto_retitle_clip: "Change a clip's title. Without 'title', Katto's AI writes a new scroll-stopping title in the clip's language (optional style: energetic, descriptive, fun, shocking); each AI regeneration uses one unit of the plan's monthly title-regeneration allowance (an error with 'limit' when it is used up). With 'title', that exact text is saved and nothing is spent. Synchronous: returns { title, clip_index, regenerated }. Does NOT use video quota.",
  katto_publish_clip: "Publish a finished clip to one of the user's connected social accounts (YouTube, TikTok, LinkedIn, Instagram, Bluesky, Mastodon, Threads), now or at schedule_at (future, at most 7 days ahead). Call katto_list_connected_accounts first to see which platforms are connected (and not in need of a reconnect); katto_generate_post_text can draft the caption. This posts PUBLICLY on the user's behalf and cannot be undone from Katto: before calling, show the user the clip, the platform, the caption (and TikTok privacy level) and get their explicit confirmation; never publish on your own initiative or retry a publish blindly (each call is a new post). Requires a paid plan; scheduling requires Creator. If the platform is not connected you get an error with code platform_not_connected and a connect_url: ask the user to connect it in the Katto dashboard, then retry. TikTok requires privacy_level chosen by the user (no default) and disclosure of commercial content (brand_content / brand_organic); until Katto's TikTok app is audited, TikTok only accepts posts to a private account. Returns { status: 'published', result } or { status: 'scheduled', scheduled_post_id, scheduled_at }.",
  katto_list_connected_accounts: "Read-only. Which of the 7 publishable platforms (youtube, tiktok, linkedin, instagram, bluesky, mastodon, threads) the user has connected in the Katto dashboard: { connections: [{ platform, connected, display_name, reconnect_required, connected_at }], connect_url }. Call it BEFORE katto_publish_clip to pick a platform that will work: if the one the user wants shows connected=false or reconnect_required=true, ask them to (re)connect it at connect_url instead of attempting the publish. Never returns tokens.",
  katto_list_scheduled_posts: "Read-only. The user's scheduled social posts (from katto_publish_clip with schedule_at, or the dashboard calendar), newest first: { scheduled_posts: [{ id, job_id, clip_index, platform, scheduled_at, status, title, error, posted_at, created_at }], next_cursor }. status: pending = waiting for its time, posting = being published, posted = done, failed = see error. Paginate with cursor = the previous next_cursor; optional status filter.",
  katto_cancel_scheduled_post: "Cancel a scheduled post before it goes out: it is removed from the calendar and will not be published (same as deleting it in the dashboard calendar). Only pending or failed posts can be cancelled; one already posting or posted returns an error (a published post cannot be taken down from Katto). Confirm with the user which post (platform, clip, time) before cancelling. Safe to retry: a second call returns 'not found'. Returns { id, status: 'cancelled', previous_status }.",
  katto_generate_post_text: "Write publish-ready post text for one clip with AI, tailored to each platform's tone and character limits, in the clip's language: { clip_index, posts: { [platform]: { title, description, hashtags } } }. title is only filled for YouTube (for the other platforms the caption is description, hashtags included). Omit platform to get all seven at once. Nothing is posted or saved and no video quota is used: show the text to the user, then pass it to katto_publish_clip (caption, or title/description for YouTube). Each call is a new AI generation (identical requests within an hour return the cached text).",
  katto_adjust_clip: "Trim or extend one finished clip by moving its start and/or end, then re-render it. Offsets are in seconds, relative to the clip's ORIGINAL bounds (two calls do not add up): positive extends (start earlier / end later), negative trims. The result must last 3-180 s and stay inside the source video. Extending re-cuts from the source, which Katto keeps 7 days: after that only trimming works (410). Captions for an extended part come from words Katto already timed or the transcript sentence. Does NOT use video quota; the original clip is kept. Not idempotent: each call starts a new render. Returns { rerender_id, status_url, start_seconds, end_seconds, duration_seconds, extended }; poll katto_get_rerender for the new clip_url.",
  katto_add_hook: "Add a hook, big bold text over the first seconds that stops the scroll, to one finished clip and re-render it. Pass text to use your own (max 80 characters, 3-7 words reads best) or omit it and Katto's AI writes one from the clip in its language. position: top (default) or center; duration: 1-10 s (default 4). Styled like the editor's AI Hook (white, boxed, pop-in). Does NOT use video quota; the original clip is kept. Not idempotent: each call starts a new render, and a re-render starts from the original clip, so calling it again replaces the hook rather than stacking two. Returns { rerender_id, hook_text, generated, status_url }; poll katto_get_rerender for the new clip_url.",
  katto_rate_clip: "Record the user's verdict on a clip: rating good or bad, with an optional reason in their words. Same signal as the thumbs up/down on the Katto results page; it is used to improve which moments Katto picks. Only rate when the user expressed an opinion, never on your own. Rating again records the new verdict (the latest one counts). Returns { ok, clip_index, rating }.",
};

// TOOLS enriched with agent descriptions + annotations — served on tools/list.
const TOOLS_LISTED = TOOLS.map((t) => ({
  ...t,
  description: DESCRIPTIONS[t.name] ?? t.description,
  ...(ANNOTATIONS[t.name] ? { annotations: ANNOTATIONS[t.name] } : {}),
}));

// Static reference data — returned by the list_* tools without an API call.
const SOURCES = [
  { id: "youtube", example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  { id: "twitch", example: "https://www.twitch.tv/videos/123456789" },
  { id: "kick", example: "https://kick.com/xqc/videos/0b5c3a7e-1234-4cde-9f00-123456789abc" },
  { id: "vimeo", example: "https://vimeo.com/123456789" },
  { id: "zoom", example: "https://zoom.us/rec/share/abc123", note: "Public share link without a passcode." },
  { id: "gdrive", example: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view", note: "Shared as 'Anyone with the link'." },
  { id: "dropbox", example: "https://www.dropbox.com/scl/fi/abc123def456/video.mp4?rlkey=xyz789&dl=0" },
  { id: "loom", example: "https://www.loom.com/share/0123456789abcdef0123456789abcdef" },
  { id: "linkedin", example: "https://www.linkedin.com/posts/janedoe_activity-7123456789012345678-AbCd" },
  { id: "facebook", example: "https://www.facebook.com/reel/1234567890123456" },
  { id: "rumble", example: "https://rumble.com/v1a2b3c-title.html" },
  { id: "dailymotion", example: "https://www.dailymotion.com/video/x8abcde" },
  { id: "medal", example: "https://medal.tv/games/valorant/clips/abc123XYZ" },
  { id: "url", example: "https://example.com/media/episode-12.mp4", note: "Direct https link to a .mp4, .mov, .m4v, .webm or .mkv file on a public host." },
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

// Lues par le client au demarrage, avant tout appel : le deroule type, la
// cadence de sondage et quoi faire d'un quota epuise. Meme texte dans les 3 sources.
const SERVER_INSTRUCTIONS = "Katto turns a long video into short vertical clips. Typical flow: katto_get_usage (each new job spends 1 video from the monthly quota) -> katto_create_clip_job with the public URL -> poll katto_get_job every 30-60 seconds until status is 'completed' (a 20-minute video took about 5 minutes for 8 clips; longer sources take longer) -> katto_get_clips, and show each clip's title and score rather than only ids. Do not download, open or transcribe the video yourself: Katto fetches it. If a call fails with a quota error, tell the user and give them the upgrade link included in the message. Re-renders and dubbing are separate jobs: start one, then poll katto_get_rerender; do not start the same re-render twice in a loop. For a local file: katto_upload_video, PUT the file to the returned upload_url, then katto_create_clip_job with upload_id. Never call katto_publish_clip without the user's explicit confirmation of the clip, platform and caption: it posts publicly on their account.";

// katto_upload_video: the REST response plus the exact next steps, because an
// agent that only sees "upload_url" tends to stop there. upload_id = job_id.
function uploadNextSteps(up) {
  const ct = (up.headers && up.headers["Content-Type"]) || "video/mp4";
  return {
    ...up,
    upload_id: up.job_id,
    next_steps: [
      `1. HTTP PUT the raw file bytes to upload_url with the header Content-Type: ${ct}, within ${up.expires_in} seconds. Example: curl -X PUT -H "Content-Type: ${ct}" --upload-file ./your-file "<upload_url>"`,
      `2. Call katto_create_clip_job with upload_id "${up.job_id}" (optional config). It checks the file arrived, spends 1 video of quota and starts clipping. Calling it before the PUT finishes returns an error you can retry.`,
      `3. Poll katto_get_job with id "${up.job_id}" every 30-60 s until status is 'completed'.`,
    ],
  };
}

// katto_publish_clip: forward only the fields the REST endpoint knows.
const PUBLISH_FIELDS = ["platform", "caption", "title", "description", "tags", "privacy_status", "schedule_at", "privacy_level", "disable_comment", "disable_duet", "disable_stitch", "brand_content", "brand_organic"];
function publishBody(args) {
  const b = {};
  for (const k of PUBLISH_FIELDS) if (args[k] !== undefined && args[k] !== null && args[k] !== "") b[k] = args[k];
  return b;
}

// katto_adjust_clip / katto_add_hook: forward only the fields that were given.
function adjustBody(args) {
  const b = {};
  if (typeof args.start_offset_seconds === "number") b.start_offset_seconds = args.start_offset_seconds;
  if (typeof args.end_offset_seconds === "number") b.end_offset_seconds = args.end_offset_seconds;
  return b;
}
function hookBody(args) {
  const b = {};
  if (args.text) b.text = args.text;
  if (args.position) b.position = args.position;
  if (typeof args.duration === "number") b.duration = args.duration;
  return b;
}

const server = new Server({ name: "katto", version: "0.6.1" }, { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS_LISTED }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let data;
    if (name === "katto_create_clip_job" && args.upload_id) {
      // An uploaded file: the complete step verifies the bytes, charges the quota and enqueues.
      data = await api(`/api/v1/uploads/${encodeURIComponent(args.upload_id)}/complete`, { method: "POST", body: JSON.stringify(args.config ? { config: args.config } : {}) });
    } else if (name === "katto_create_clip_job") {
      if (!args.url) throw new Error("Pass url (a public video link) or upload_id (from katto_upload_video).");
      data = await api("/api/v1/jobs", {
        method: "POST",
        body: JSON.stringify({ url: args.url, config: args.config, ...(args.webhook_url ? { webhook_url: args.webhook_url } : {}) }),
      ...(args.idempotency_key ? { headers: { "Idempotency-Key": String(args.idempotency_key) } } : {}),
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
      data = { id: job.id, status: job.status, clips: job.clips || [], dropped_clip_indices: job.dropped_clip_indices || [], dropped_clips: job.dropped_clips || [] };
    } else if (name === "katto_get_usage") {
      data = await api("/api/v1/usage");
    } else if (name === "katto_get_transcript") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/transcript`);
    } else if (name === "katto_cancel_job") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}`, { method: "DELETE" });
    } else if (name === "katto_get_account") {
      data = await api("/api/v1/me");
    } else if (name === "katto_list_sources") {
      data = { sources: SOURCES, note: "To clip a local file instead of a link, use katto_upload_video, then katto_create_clip_job with upload_id." };
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
    } else if (name === "katto_create_clip") {
      const b = { start_seconds: args.start_seconds, end_seconds: args.end_seconds };
      if (args.aspect) b.aspect = args.aspect;
      if (typeof args.auto_reframe === "boolean") b.auto_reframe = args.auto_reframe;
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/clips`, { method: "POST", body: JSON.stringify(b) });
    } else if (name === "katto_more_clips") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/more`, { method: "POST", body: JSON.stringify(args.count != null ? { count: args.count } : {}) });
    } else if (name === "katto_upload_video") {
      data = uploadNextSteps(await api("/api/v1/uploads", { method: "POST", body: JSON.stringify({ filename: args.filename, content_type: args.content_type, size: args.size }) }));
    } else if (name === "katto_translate_captions") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/clips/${encodeURIComponent(args.clip_index)}/translate-captions`, { method: "POST", body: JSON.stringify({ language: args.language }) });
    } else if (name === "katto_retitle_clip") {
      const b = {};
      if (args.title) b.title = args.title;
      else if (args.style) b.style = args.style;
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/clips/${encodeURIComponent(args.clip_index)}/retitle`, { method: "POST", body: JSON.stringify(b) });
    } else if (name === "katto_publish_clip") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/clips/${encodeURIComponent(args.clip_index)}/publish`, { method: "POST", body: JSON.stringify(publishBody(args)) });
    } else if (name === "katto_list_connected_accounts") {
      data = await api("/api/v1/connections");
    } else if (name === "katto_list_scheduled_posts") {
      const qs = new URLSearchParams();
      if (args.status) qs.set("status", String(args.status));
      if (args.limit != null) qs.set("limit", String(args.limit));
      if (args.cursor) qs.set("cursor", String(args.cursor));
      const q = qs.toString();
      data = await api(`/api/v1/scheduled-posts${q ? `?${q}` : ""}`);
    } else if (name === "katto_cancel_scheduled_post") {
      data = await api(`/api/v1/scheduled-posts/${encodeURIComponent(args.scheduled_post_id)}`, { method: "DELETE" });
    } else if (name === "katto_generate_post_text") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/clips/${encodeURIComponent(args.clip_index)}/post-text`, { method: "POST", body: JSON.stringify(args.platform ? { platform: args.platform } : {}) });
    } else if (name === "katto_adjust_clip") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/clips/${encodeURIComponent(args.clip_index)}/adjust`, { method: "POST", body: JSON.stringify(adjustBody(args)) });
    } else if (name === "katto_add_hook") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/clips/${encodeURIComponent(args.clip_index)}/hook`, { method: "POST", body: JSON.stringify(hookBody(args)) });
    } else if (name === "katto_rate_clip") {
      data = await api(`/api/v1/jobs/${encodeURIComponent(args.id)}/clips/${encodeURIComponent(args.clip_index)}/feedback`, { method: "POST", body: JSON.stringify(args.reason ? { rating: args.rating, reason: args.reason } : { rating: args.rating }) });
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
