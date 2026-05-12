# Phase 12 outreach — resume plan

> Transient working document. Delete after Phase 12 outreach completes
> (when ≥3 channels are engaged or the day-60 review at 2026-07-10
> happens, whichever comes first). All durable status lives in
> `PROGRESS.md`; this file is the "pick up where you left off" snapshot.
>
> Last updated: 2026-05-11 (after 12.1 Medium + Dev.to publication).

## Where you are

✅ **12.1 long-form post published** on both canonical channels:

- Medium (canonical for all subsequent links):
  https://medium.com/@sbissoli76/seven-medical-terminologies-one-mcp-server-a-practical-walkthrough-for-clinical-and-research-use-a6c46de9c83b
- Dev.to:
  https://dev.to/sidneybissoli/seven-medical-terminologies-one-mcp-server-a-practical-walkthrough-for-clinical-and-research-use-5gia

Drafts for the next channels are ready in `outreach-templates.md`,
all refreshed with the Medium URL as the canonical read-more link.

## Next 48h — concrete copy-paste plan

The first 24-48h after a long-form post is the window where social
channels amplify hardest. Crosspost in this order, with the rationale
for each:

### 1. Mastodon (~30 min total) — do first, lowest friction

Three variants in `outreach-templates.md` section A.10 (~line 799).
Post each on the matching instance:

- **Variant A** (clinical use) → `academic.social`
- **Variant B** (research) → `fediscience.org`
- **Variant C** (developer) → `mastodon.social`

Optional 4th: Variant C on `infosec.exchange` (engineering angle).

**Why first:** no comments to moderate quickly, "post and forget"
mechanic, independent audience from LinkedIn/Reddit.

### 2. Bluesky (~10 min) — same audience, different algorithm

Bluesky version (Medium URL doesn't fit inline at 300 chars) is at
the bottom of A.10. Pattern: short post + pinned reply with the
Medium URL.

### 3. LinkedIn (~40 min posting + ongoing engagement) — highest-quality comments

Full draft in `outreach-templates.md` section A.8 (~line 605).

**Critical posting notes:**
- Paste exactly as drafted; the short paragraph breaks preserve
  LinkedIn's preview behavior.
- LinkedIn does NOT render markdown — the bullet emojis (🩺 💊 📚 ❌)
  and grouped hashtags at the end are intentional formatting.
- This is a **normal feed post**, not the "Create newsletter
  article" path.
- Respond to comments within 4-6h while the post is in the feed.
  LinkedIn's algorithm rewards author engagement in the first day.

**Why third:** LinkedIn's audience is clinical informatics + EMR +
healthcare execs — fewer comments than Reddit but each one is more
qualified and worth a thoughtful reply.

## After 48h — decision tree (depends on signals)

| If you observe… | Next channel |
|---|---|
| LinkedIn generates 5+ substantive comments | Show HN (12.5) — Tuesday or Wednesday 8-9h EST. You'll have feedback to incorporate into HN comment responses. |
| Mastodon/Bluesky give a real boost (≥200 boosts/reposts combined) | r/healthIT (12.3 variant C, `outreach-templates.md` line ~719). Less risky than r/medicine/r/medicalcoding which have strict self-promo rules. |
| Both are lukewarm (≤20 likes total, zero comments) | Individual emails (12.7) — start with 5 hand-picked targets (clinical informatics fellows, MCP server authors, health-tech bloggers). 1:1 outreach beats broadcast when broadcast doesn't convert. |
| External issues or stars start showing up (≥2 from outside immediate circle) | Hold further outreach for 3-5 days — let the inbound flow without diluting attention. Respond to issues within 24h. |

## Monitoring (5 min/day)

Daily quick checks while outreach is active:

```powershell
# GitHub stars + open issues
gh api repos/SidneyBissoli/medical-terminologies-mcp --jq '{stars:.stargazers_count, forks:.forks_count, open_issues:.open_issues_count}'

# npm downloads (yesterday)
curl -s https://api.npmjs.org/downloads/point/last-day/medical-terminologies-mcp
```

Then web checks:

- Medium dashboard: https://medium.com/me/stats (views, reads, claps)
- Dev.to dashboard: https://dev.to/dashboard (reactions, comments, page views)
- Open issues in repo (priority response: any issue from outside the
  immediate circle = strong adoption signal, respond within 24h)

## Reference — where the drafts live

| Channel | Section in `outreach-templates.md` | Approx line |
|---|---|---|
| LinkedIn post | A.8 | 605 |
| Reddit posts (3 versions) | A.9 | 670 |
| Mastodon + Bluesky | A.10 | 799 |
| GitHub Discussions crosspost | A.11 | 857 |
| Show HN | A.6 | 317 |
| Early-adopter emails | A.5 | 261 |

All drafts assume:
- Tool count: **31 default / 37 with SNOMED**
- Version: **v1.4.0**
- Tests: **313 unit + contract + 11 integration**
- Hosted endpoint: `https://medical-terminologies-mcp.sidneybissoli.workers.dev/mcp`
- Listings live: Glama ✅, Smithery ✅, mcpservers.org ✅ (LobeHub
  pending scanner re-run after v1.4.0)
- punkpeye PR #6208 still pending merge

## Skip / defer (don't spend time on these)

- **Anthropic MCP Catalog (12.10)** — low approval probability until
  the project has ≥10 stars + a third-party mention. Hold.
- **ResearchGate (12.9)** — low priority per original plan.
- **chat.fhir.org (12.6)** — reactive only, never proactive. Engage
  if a relevant question appears.
- **Discord MCP communities (12.8)** — do after Reddit/HN so you can
  reuse responses from those channels.

## When you have ≥3 channels engaged

Update `PROGRESS.md`:

- Flip the relevant 12.x rows to ✅ with URLs (mirror the 12.1 row
  format)
- The Phase 12 "channels engaged or skipped with rationale" checkbox
  becomes checkable once you have a clear pattern of engagement vs
  skip across the 11 channels

When you reach **2026-07-10** (60 days after baseline), do the day-60
review — the procedure is at the bottom of `metrics-baseline.txt`.
That's when you formally score against the 5 success criteria.

## Quick re-entry tomorrow

1. Open this file
2. Pick action 1 (Mastodon) — copy from `outreach-templates.md` A.10
3. Post the 3 Mastodon variants
4. Tell me the URLs so I can update `PROGRESS.md` (or update it
   yourself by mirroring the 12.1 row format)
5. Then Bluesky → then LinkedIn
6. After 48h, look at signals and pick the next channel from the
   decision tree above
