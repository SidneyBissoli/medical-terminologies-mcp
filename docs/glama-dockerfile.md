# Glama listing build configuration

Reference for the build configuration of the Glama listing at
https://glama.ai/mcp/servers/SidneyBissoli/medical-terminologies-mcp.
**None of this is used by this repository's build or deploy** — Glama
stores it on their side; we keep a copy here so the content is
findable when it needs changing.

## History: free-form Dockerfile → structured form

Until mid-2026 the Glama admin UI accepted a free-form Dockerfile
(this file used to hold one: `node:20-alpine`, `npm install -g
medical-terminologies-mcp@<pin>`, `USER node`). Glama retired that
field — the admin UI now exposes a structured form whose values
generate the Dockerfile on their side; the Dockerfile pane itself is
a read-only preview that only renders once the form validates. Two
properties of the old setup are no longer expressible and were
consciously given up:

- **Testing the published npm package.** Glama now always builds from
  a `git clone` of the repository, not from the npm artifact.
- **Running as non-root.** The generated Dockerfile runs as root;
  there is no field to change that. Same for every listed server, so
  it no longer differentiates the safety score.

The upside: no version pin to bump on each release anymore.

## Current form values (set 2026-06-10)

Fields marked *locked* are platform-fixed and not editable.

| Field | Value | Notes |
|---|---|---|
| Base image | `debian:trixie-slim` | Locked. |
| Node.js version | 24 (nodesource) | Locked. Satisfies `engines` (`>= 20`). |
| Python version | 3.13 (via uv) | Locked. Unused by this project; baked into their base setup. |
| Build steps | `["pnpm install", "pnpm run build"]` | Renders as `RUN (pnpm install) && (pnpm run build)`. |
| CMD arguments | `["pnpm", "run", "start"]` | Server start only — Glama prepends `mcp-proxy --` itself. |
| Pinned commit SHA | read-only | Glama manages it (shows the HEAD it last indexed). Not maintainer-controlled. |
| Placeholder parameters | empty | No required startup parameters. |

**Form gotcha:** the JSON-typed fields (build steps, CMD arguments,
env schema) want a JSON literal typed as text on a **single compact
line**. Pretty-printed multi-line JSON fails validation with a
misleading `invalid_type, expected string` / "Invalid JSON" error.

### Environment variables JSON schema

All optional — the server starts with none set (ICD-11 tools throw
`AUTH_CONFIG_ERROR` at first use without WHO creds; documented
behavior, safe for Glama's scan to encounter). Stored single-line in
the form; pretty-printed here for readability:

```json
{
  "type": "object",
  "properties": {
    "WHO_CLIENT_ID": {
      "type": "string",
      "description": "WHO ICD-API client ID. Required only for the 5 ICD-11 tools; all other tools work without credentials."
    },
    "WHO_CLIENT_SECRET": {
      "type": "string",
      "description": "WHO ICD-API client secret (pairs with WHO_CLIENT_ID)."
    },
    "ENABLE_SNOMED_TOOLS": {
      "type": "string",
      "description": "Set to 'true' to enable the 6 SNOMED tools. Requires SNOMED_BASE_URL."
    },
    "SNOMED_BASE_URL": {
      "type": "string",
      "description": "Base URL of a self-hosted Snowstorm instance."
    },
    "SNOMED_LANGUAGE": {
      "type": "string",
      "description": "Default Accept-Language for SNOMED requests."
    },
    "WHO_ICD11_RELEASE_ID": {
      "type": "string",
      "description": "ICD-11 release ID (default: 2024-01)."
    },
    "LOG_LEVEL": {
      "type": "string",
      "description": "pino log level (default: info)."
    }
  }
}
```

### Generated Dockerfile (preview captured 2026-06-10)

```dockerfile
FROM debian:trixie-slim
ENV DEBIAN_FRONTEND=noninteractive \
    GLAMA_VERSION="1.0.0" \
    PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y --no-install-recommends nodejs && npm install -g mcp-proxy@6.4.3 pnpm@10.14.0 && node --version && curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR="/usr/local/bin" sh && uv python install 3.13 --default --preview && ln -s $(uv python find) /usr/local/bin/python && python --version && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
WORKDIR /app
RUN git clone https://github.com/SidneyBissoli/medical-terminologies-mcp . && git checkout d349c8771ea76cb2e1024527c7ed8d9827a8003b
RUN (pnpm install) && (pnpm run build)
CMD ["mcp-proxy","--","pnpm","run","start"]
```

## Release procedure

Nothing Glama-specific anymore. Publishing a release (npm + MCP
Registry via `publish.yml`) needs no Glama admin step. After merging
changes that affect startup, env vars, or the build, glance at the
listing's build status; if the env var surface changed, update the
JSON schema in the admin form and mirror it here. The commit SHA the
build checks out is Glama-managed — after a significant push to
`main`, verify the listing eventually re-indexes (it is not under our
control).

## Operational notes

- **Build failures can be Glama-side.** A failed build whose logs
  stop at base-image metadata loading with an `AbortError` from their
  `createShutdownHandler` is their build worker being recycled, not a
  project error (seen 2026-06-10). Saving the admin form re-triggers
  the test; they also re-test periodically on their own.
- The admin "Dockerfile" page's `tests/<id>` sub-pages are read-only
  build records; the editable form is at `/admin/dockerfile` itself,
  logged in as the GitHub account listed in `glama.json`.
- "Make Release" is a maintainer-triggered action in the admin UI
  (not automatic — the build-success email explicitly asks for it)
  that publishes the built image for Glama's hosted-server feature.
  It does not affect the listing, score, or the canonical npm/`npx`
  install path. The release version shown is Glama's own counter
  (auto-bumped patch), so it can drift from the npm version — their
  "1.5.3" shipped while npm was at 1.5.2; it realigns on the next
  npm release.

## Why this file exists in the repo

The configuration is owned by Glama; this is a documentation
artifact, not source. Keeping the reference here means env-schema
changes don't require digging through chat logs or Glama's admin UI,
and the design rationale survives next to the code it describes.
