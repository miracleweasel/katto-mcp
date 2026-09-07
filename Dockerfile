# Container image for the katto-mcp stdio server.
# Used by Glama (and anyone who wants to run the server in a container) to
# build, boot and inspect the server. Tool discovery (tools/list) works with
# no credentials; a KATTO_API_KEY is only needed to actually run clip jobs.
#   docker build -t katto-mcp .
#   docker run --rm -i -e KATTO_API_KEY=sk_live_... katto-mcp
FROM node:20-alpine

WORKDIR /app

# Install runtime deps first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# App code (the whole server is a single ESM entrypoint).
COPY index.mjs ./

ENV NODE_ENV=production

# stdio MCP server — clients speak JSON-RPC over stdin/stdout.
ENTRYPOINT ["node", "index.mjs"]
