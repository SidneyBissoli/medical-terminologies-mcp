# syntax=docker/dockerfile:1.7
# Multi-stage build for the Streamable HTTP transport. The bundle inlines
# everything except @modelcontextprotocol/sdk (esbuild --external), so the
# runtime image only needs that one runtime dep + the bundled dist file.
#
# Built and run by Smithery in container mode (smithery.yaml). Listens on
# the PORT env var that Smithery sets (default 8081) and binds 0.0.0.0
# so the container's network can route in.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# Production deps only — esbuild bundles everything except the SDK.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# HOST=0.0.0.0 so Docker port mapping works; PORT is read from the env at
# startup (defaults to 3000 in CLI, but Smithery overrides to 8081).
ENV HOST=0.0.0.0
EXPOSE 8081

# stdio is the npm default; for hosted deployments we always run --http.
CMD ["node", "dist/index.js", "--http"]
