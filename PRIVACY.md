# Privacy Policy — medical-terminologies-mcp

**Effective date:** 2026-08-09 · **Service:** `https://medical.sidneybissoli.com` (remote MCP server)

This service provides read-only access to public medical terminology data
(ICD-11, ICD-10, CID-10 BR, LOINC, RxNorm, ATC, MeSH, and optionally SNOMED CT)
from official sources. It requires no account, no login, and no API key.

## What we collect

- **Nothing that identifies you.** The server does not log query content, tool
  parameters, request bodies, or any user data.
- **Aggregate usage metrics only:** event type (request, tool call, tool error,
  auth failure, rate-limited), tool or route name, and daily counts. These
  aggregates contain no IP addresses and no query content, and are publicly
  visible at `/metrics`.
- **Public tool-call counters** (`/stats` and the README badge at
  `/stats/badge`): total and per-tool call counts accumulated since
  2026-05-13. These are aggregate integers only — no IP addresses, no query
  content, no timestamps per call, no personal data.
- **Rate limiting** uses the client IP in ephemeral in-process memory only
  (token bucket). It is never persisted or logged by the application.

## Infrastructure

The service runs on Cloudflare Workers. Cloudflare, as hosting provider, may
process connection metadata (including IP addresses) per its own
[privacy policy](https://www.cloudflare.com/privacypolicy/).

## Upstream requests

Your queries are translated into requests to public terminology APIs. Only the
search terms and codes being looked up are forwarded — never your identity,
IP address, or any client metadata. Upstreams contacted at runtime:

- **WHO ICD-API** (`icd.who.int`) — ICD-11 (and OAuth token requests to
  `icdaccessmanagement.who.int`, sent with the server's own credentials,
  never yours)
- **NLM RxNav** (`rxnav.nlm.nih.gov`) — RxNorm and RxClass/ATC
- **NLM MeSH** (`id.nlm.nih.gov`) — MeSH descriptors
- **NLM Clinical Tables** (`clinicaltables.nlm.nih.gov`) — LOINC
- **SNOMED CT browser** (`browser.ihtsdotools.org`) — only when the
  SNOMED tools are explicitly enabled by the operator

CID-10 (DataSUS V2008) and the ICD-10→ICD-11 crosswalk are bundled datasets —
those lookups never leave the server.

The WHO API credentials used by this service exist only in the WHO API portal
and in the Worker's secret store; they are never present in responses, logs,
or the public repository.

## Data license

Terminology data returned by this service comes from the official sources
listed above, each under its own license or terms (see
[NOTICE.md](NOTICE.md) for the consolidated attributions). Every response
carries a provenance block (source, URL, retrieval date, license). This
service is not endorsed by WHO, NLM, Regenstrief, DataSUS, or SNOMED
International.

## STDIO (npm package)

The npm package `medical-terminologies-mcp` runs entirely on your machine.
It sends nothing to this service; it talks only to the upstream APIs above,
directly from your machine, with the same rule (only the queried terms are
sent). No telemetry.

## Contact

sbissoli76@gmail.com
