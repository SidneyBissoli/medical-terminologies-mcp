# syntax=docker/dockerfile:1.7
# Multi-stage build for the Streamable HTTP transport. The bundle inlines
# everything except @modelcontextprotocol/sdk (esbuild --external), so the
# runtime image only needs that one runtime dep + the bundled dist file.
#
# Used by any container host (Fly.io, Cloud Run, Render, plain Docker).
# The container reads PORT and HOST from env at startup; the platform sets
# PORT, and we default HOST to 0.0.0.0 so the network can route in.

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

# HOST=0.0.0.0 so the container's port can be reached from outside.
# PORT comes from the platform env (Fly: 8080, Cloud Run: 8080, Render: 10000,
# arbitrary in raw Docker). EXPOSE here is just documentation — the actual
# listening port is whatever PORT resolves to at runtime.
ENV HOST=0.0.0.0
EXPOSE 8080

CMD ["node", "dist/index.js", "--http"]
