# Glama Dockerfile reference

This is the Dockerfile pasted into the Glama admin UI for
`medical-terminologies-mcp` to pass Glama's automated safety and
quality checks. **It is not used by this repository's build or
deploy** — Glama stores it on their side; we keep a copy here so the
content is findable when the package version pin needs bumping.

Glama re-runs the safety check on each Dockerfile change. The version
pin (`@1.2.1` below) is the trigger for fresh quality grading after
each release, so bump it when shipping a new version of the package.

## Current Dockerfile

```dockerfile
# Dockerfile for Glama's automated safety + quality checks.
# Installs the published medical-terminologies-mcp npm package and
# launches the stdio bin entry. Bump the version pin on each release.

FROM node:20-alpine

# Install the published MCP server. Pinned to the current release so
# Glama's safety check is reproducible.
RUN npm install -g medical-terminologies-mcp@1.2.1

# Drop privileges — node:20-alpine ships a non-root "node" user. The
# globally-installed binary at /usr/local/bin/medical-terminologies-mcp
# remains readable from PATH.
USER node

# Default to stdio transport. The 23 non-ICD-11 tools (LOINC, RxNorm,
# MeSH, ATC, CID-10) work without any credentials. The 5 ICD-11 tools
# throw AUTH_CONFIG_ERROR on first call when WHO_CLIENT_ID/SECRET are
# unset — documented behavior; safe to surface to Glama's quality scan.
CMD ["medical-terminologies-mcp"]
```

## Design notes

- **Base image `node:20-alpine`** — ~120 MB, smallest stable Node 20.
  All this project's deps are pure JS (axios, pino, etc.); no native
  modules that would clash with musl.
- **Install via npm, not source checkout** — uses the published
  package, matching the install path real users follow. Pin avoids
  non-reproducible scans.
- **Non-root user (`USER node`)** — Glama scores safety; running as
  root would dock points. The `node` user is built into the base
  image and has read access to `/usr/local/bin` and
  `/usr/local/lib/node_modules`.
- **No `ENV WHO_CLIENT_ID=""`** — empty string and unset are
  functionally identical for `getEnv()` (`src/utils/env.ts`), and
  unset is cleaner. The CLAUDE.md-documented behavior ("server still
  starts without them; ICD-11 tool calls throw `AUTH_CONFIG_ERROR` at
  first use") is exactly what Glama's scan will encounter, and is
  safe.

## Release procedure

When publishing a new version:

1. Bump `package.json` version.
2. `npm publish` (the `prepublishOnly` script builds the bundle).
3. Sign in to https://glama.ai/mcp/servers/SidneyBissoli/medical-terminologies-mcp
   admin UI.
4. Edit the Dockerfile in the admin UI — update the
   `medical-terminologies-mcp@X.Y.Z` pin to match the new version.
5. Save. Glama re-runs the safety/quality checks against the new
   pinned version. Verify the listing's grade hasn't regressed.
6. Update the version pin in this file (`docs/glama-dockerfile.md`)
   to keep the reference current.

## Why this file exists in the repo

The Dockerfile is owned by Glama; this is a documentation artifact,
not source. Keeping the reference here means:

- Version bumps don't require digging through chat logs or Glama's
  admin UI history.
- Any future maintainer who needs to update the Glama listing can
  read this and reproduce the exact content.
- The design rationale is preserved alongside the code it describes
  (rather than rotting in an external admin UI no one else can read).
