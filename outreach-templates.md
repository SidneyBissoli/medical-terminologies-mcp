# Outreach Templates

> Copy-paste-ready drafts for the channels still open in PROGRESS.md
> Phase 12 (Content & Outreach), sub-tasks 12.2–12.10. **Rewritten on
> 2026-11-20** for the server as it is today; the May/June 2026 drafts
> described v1.x (SNOMED behind a flag, 28–31 tools) and were no longer
> safe to paste. The directory submissions (12.x/11.x: awesome-mcp-servers,
> Glama, mcpservers.org, Smithery) and the long-form post (12.1, published
> 2026-05-11) are done; their templates live in git history
> (`git show 738ec7f:outreach-templates.md`).
>
> **Every channel section has three parts:** what was measured about the
> channel (with the page read and the date), the ready text, and what to do
> after posting (record the URL in PROGRESS.md, Phase 12 table).
>
> **Nothing here is posted by the assistant.** Each post goes out from the
> maintainer's own account, when and if he chooses. A channel he decides
> not to use is recorded in PROGRESS.md as skipped, with the reason.

---

## Verified facts (2026-11-20) — use only these, re-check if a month old

| Fact | Value | How it was checked |
|------|-------|--------------------|
| Version | 2.4.0 | `npm view`, `/health`, `/status` |
| Tools | 33: 31 terminology tools + `search`/`fetch` (ChatGPT Deep Research) | `/health` `tool_count`, `tools/list` on the hosted endpoint |
| Terminologies | ICD-11 (WHO ICD-API, release 2026-01), LOINC, RxNorm, MeSH (NLM), ATC (via NLM RxClass), Brazilian CID-10 (DataSUS V2008, bundled) | README; live calls |
| ICD-10 → ICD-11 | WHO transition tables, release 2025-01, bundled; returns the WHO primary map plus documented alternatives, and "no mapping" instead of a fuzzy guess | live call `map_icd10_to_icd11("A07.8")`: primary 1A3Z + 4 alternatives |
| Batch harmonization | `harmonize_terms`: up to 50 free-text terms → ICD-11 / RxNorm (+ATC) / LOINC, each with `exact` / `strong` / `needs_review` | live call (below) |
| Provenance | every successful response carries source, data vintage, real retrieval time, citation and license | live calls |
| Hosted endpoint | `https://medical.sidneybissoli.com/mcp` — Streamable HTTP, no account, no API key | `initialize` + `tools/list` |
| Local | `npx -y medical-terminologies-mcp` (stdio); the ICD-11 tools need free WHO API credentials locally | README |
| Annotations | all 33 tools have `title` and `readOnlyHint` | `tools/list` |
| Privacy | no query content logged; aggregate counters only | `PRIVACY.md` |
| License | MIT | GitHub API |

**Live examples you can quote (called on 2026-11-20 against the hosted server):**

- `harmonize_terms(["type 2 diabetes", "metformin", "hemoglobin a1c", "MI"])` →
  `type 2 diabetes` = ICD-11 **5A11**, exact; `metformin` = RxNorm **6809**,
  exact, with ATC **A10BA** (biguanides); `hemoglobin a1c` → LOINC **4548-4**,
  but marked `needs_review` (it is a lab name without specimen); `MI` →
  `needs_review`, because the two candidates are **mitral insufficiency** and
  **acute myocardial infarction**. The tool asks a person instead of picking.
- `map_icd10_to_icd11("A07.8")` → primary **1A3Z** plus four WHO alternatives
  (blastocystosis, sarcocystosis, *Entamoeba*, *Trichomonas*), with the WHO
  notice that the tables are not meant for direct data conversion.
- `cid10_search("pressão alta")` → **I10** Hipertensão essencial: everyday
  Portuguese is resolved to the CID-10's own wording, and the response says so.

**Do not put in any post:** download counts (raw npm is inflated by release
mirroring — see the 60-day review), star counts, third-party users or
catalogs (not re-verified for public text), anything about features not
shipped, or any suggestion of clinical-care use.

---

## 12.2 — LinkedIn (personal feed)

**Channel (measured):** high tolerance for self-promotion; likes are an
anti-metric in this phase. Post in English (the audience is international);
a Portuguese variant is optional.

**Text (~260 words):**

> Language models are good at sounding sure about medical codes. They are
> not good at being right about them.
>
> Ask one for the ICD-11 code of "MI" and it will answer. The honest answer
> is that "MI" is ambiguous: mitral insufficiency or acute myocardial
> infarction.
>
> I maintain an open-source MCP server (Model Context Protocol, the standard
> AI assistants use to call tools) that answers terminology questions from
> the official sources instead of from memory: ICD-11 (WHO), LOINC, RxNorm
> and MeSH (NLM), ATC, and the Brazilian CID-10.
>
> Three things it does that I care about:
>
> • It maps ICD-10 to ICD-11 with the WHO transition tables, alternatives
> included, and says "no mapping" when there is none.
> • It harmonizes a list of free-text terms (up to 50) to codes and labels
> each one exact, strong or needs review. "MI" comes back as needs review.
> • Every answer carries its provenance: source, version, retrieval time,
> citation and license.
>
> It is for researchers, public-health analysts, informatics developers and
> educators who need codes they can audit. It is not a clinical decision
> tool.
>
> It runs hosted, with no account or API key: medical.sidneybissoli.com/mcp
> (Streamable HTTP), or locally with npx. MIT licensed.
>
> Code and docs: https://github.com/SidneyBissoli/medical-terminologies-mcp
>
> If you work with coded health data, I'd like to hear what is missing.
>
> #HealthInformatics #MedicalCoding #ModelContextProtocol #OpenSource

**After posting:** record the post URL in PROGRESS.md 12.2. Crosspost to
groups only where the group rules allow tool announcements.

---

## 12.3 — Reddit (three subreddits)

**Channel (measured 2026-11-20 — incomplete):** Reddit refused every
automated read of the rules pages, so **read the rules by hand before each
post**:
<https://www.reddit.com/r/healthIT/about/rules>,
<https://www.reddit.com/r/MedicalCoding/about/rules>,
<https://www.reddit.com/r/medicine/about/rules>. A search snippet of
r/MedicalCoding lists "No advertising/self promotion"; r/medicine's current
rules could not be seen. Space the posts at least 48 h apart; if a post is
removed, do not repost. The official Claude community page also names
**r/ClaudeAI** as a place for project showcases (claude.com/community) — an
option if the medical subs are closed.

**Recommendation:** r/healthIT first. r/MedicalCoding and r/medicine only if
their rules, read by hand, allow it; otherwise record them as skipped.

### 12.3.a — r/healthIT

**Title:** *Open-source MCP server for ICD-11, LOINC, RxNorm, MeSH lookups — looking for feedback from people who work with coded data*

> I maintain an open-source MCP server (the protocol AI assistants use to
> call tools) that answers terminology lookups from the official APIs and
> bundled WHO/DataSUS tables instead of the model's memory: ICD-11, LOINC,
> RxNorm (+ATC), MeSH, and the Brazilian CID-10.
>
> The parts that might matter to health IT work:
>
> - ICD-10 → ICD-11 with the WHO transition tables (release 2025-01),
>   alternatives included; "no mapping" when the table has none.
> - `harmonize_terms`: a list of up to 50 free-text terms → codes, each
>   labelled exact / strong / needs_review. "MI" comes back needs_review
>   (mitral insufficiency vs myocardial infarction) instead of a guess.
> - Every response carries provenance: source, version, retrieval time,
>   citation, license.
> - Read-only, no PHI handling; terms you send go to the WHO/NLM APIs, so
>   de-identify first.
>
> Hosted endpoint, no account: https://medical.sidneybissoli.com/mcp — or
> `npx -y medical-terminologies-mcp`. MIT.
> Repo: https://github.com/SidneyBissoli/medical-terminologies-mcp
>
> Question for this sub: where does terminology lookup actually hurt in your
> pipelines — mapping between revisions, harmonizing legacy free text, or
> something else?

### 12.3.b — r/MedicalCoding (only if the rules allow)

**Title:** *Question: would an ICD-10→ICD-11 lookup that shows WHO's alternative codes be useful to you?*

> Not selling anything — it's a free, open-source tool. When ICD-10 codes
> are mapped to ICD-11, one code often splits into several. A07.8, for
> example, maps in WHO's 2025 transition tables to 1A3Z with four documented
> alternatives.
>
> I built a lookup (an MCP server for AI assistants) that returns the WHO
> primary map plus every alternative, and says "no mapping" when the table
> has none, instead of guessing. Repo:
> https://github.com/SidneyBissoli/medical-terminologies-mcp
>
> For people who code for a living: is ICD-11 on your horizon yet, and what
> would a mapping tool have to show for you to trust it?

### 12.3.c — r/medicine (only if the rules allow; default = skip)

> Same as 12.3.b, framed as a question, with the explicit line "This is not
> a clinical decision tool; it is for coding and research data." If the
> rules restrict posting to clinicians or forbid tools, record the channel
> as skipped.

**After posting:** record each post URL (or "skipped: rule X") in
PROGRESS.md 12.3.

---

## 12.4 — Mastodon + Bluesky

**Channel (measured 2026-11-20):** Bluesky allows **300 graphemes** per post
(atproto lexicon `app.bsky.feed.post`); mastodon.social allows **500
characters**, each URL counting as 23 (`/api/v2/instance`). Every variant
below fits both (≤ 300, URL included).

**Research angle:**

> Free-text diagnoses, drugs, lab names → ICD-11, RxNorm+ATC, LOINC, 50 at
> a time, each labelled exact / strong / needs review. "MI" comes
> back needs review: mitral insufficiency or myocardial infarction?
> Open-source MCP server, MIT:
> https://github.com/SidneyBissoli/medical-terminologies-mcp

**Informatics angle:**

> ICD-10 → ICD-11 from WHO's transition tables, alternatives included, and
> "no mapping" when there is none. One of 33 read-only tools in an
> open-source MCP server; every answer cites its source and version.
> https://github.com/SidneyBissoli/medical-terminologies-mcp

**Developer angle:**

> Remote MCP server for medical terminologies: ICD-11, LOINC, RxNorm, MeSH,
> ATC, Brazilian CID-10. No account, no key, provenance on every response.
> https://medical.sidneybissoli.com/mcp — MIT, repo on GitHub:
> SidneyBissoli/medical-terminologies-mcp

**After posting:** record the post URLs in PROGRESS.md 12.4.

---

## 12.5 — Show HN

**Channel (measured 2026-11-20, news.ycombinator.com/showhn.html):** for
something people can try, ideally without sign-up — the hosted endpoint and
`npx` both qualify. Title must start with "Show HN". Version-bump posts
don't qualify (this would be the project's first Show HN). Be around to
answer comments for the first hours; never ask anyone to upvote. Best
window per the original plan: Tuesday or Wednesday morning (US Eastern).

**Title:** *Show HN: Medical terminologies for AI assistants – ICD-11, LOINC, RxNorm, MeSH (MCP)*

**Text:**

> I maintain an open-source MCP server that lets AI assistants look up
> medical codes in the official sources instead of generating them: ICD-11
> (WHO ICD-API), LOINC, RxNorm and MeSH (NLM), ATC (via RxClass), and the
> Brazilian CID-10 (DataSUS, bundled).
>
> You can try it without signing up: point any MCP client at
> https://medical.sidneybissoli.com/mcp (Streamable HTTP, no key), or run
> `npx -y medical-terminologies-mcp` locally (ICD-11 then needs free WHO
> credentials).
>
> Things I tried to get right:
>
> - Saying "I don't know" honestly. ICD-10 → ICD-11 uses WHO's transition
>   tables and returns "no mapping" when there is none, instead of a fuzzy
>   search. `harmonize_terms` labels each free-text term exact / strong /
>   needs_review; "MI" is needs_review because it is either mitral
>   insufficiency or myocardial infarction.
> - Provenance on every response: source, data version, the real retrieval
>   time (cache hits keep the original), citation and license, in
>   structured content and in a text footer.
> - Typed output: every tool declares an outputSchema and returns
>   structuredContent; a test calls every tool through a real MCP client
>   and validates the result against the advertised schema.
> - Upstream drift: contract tests replay captured responses, and a daily
>   job calls the live APIs.
>
> It is not a clinical decision tool; the audience is research, public
> health, informatics and teaching. MIT licensed.
>
> Repo: https://github.com/SidneyBissoli/medical-terminologies-mcp
>
> I'd especially like to hear from people who harmonize coded health data:
> what would you need to trust a tool like this in a pipeline?

**After posting:** record the HN item URL in PROGRESS.md 12.5.

---

## 12.6 — chat.fhir.org (HL7 Zulip)

**Channel (measured 2026-11-20, "Chat.fhir.org Community Expectations",
HL7 Confluence, updated 2024-09-24):** "No unsolicited promotions,
marketing, or business solicitation"; disclose affiliation; open-source
community solutions are preferred; **product releases may be announced in
#social if concise and simple**. #terminology (stream 179202) is for
technical discussion of terminology services — answer there only when a
thread is about this exact problem. Never use @all.

**#social post (concise, the only proactive one):**

> Sharing an open-source (MIT) MCP server I maintain, in case it is useful
> to terminology folks: it gives AI assistants read-only lookup of ICD-11,
> LOINC, RxNorm, MeSH, ATC and the Brazilian CID-10, maps ICD-10 → ICD-11
> with the WHO transition tables, and returns provenance (source, version,
> license) with every answer. Not a FHIR terminology server. Disclosure: I'm
> the author. https://github.com/SidneyBissoli/medical-terminologies-mcp

**#terminology:** no proactive post. Reply only where a thread asks how to
give an LLM or agent access to these code systems; answer the question
first, mention the server last, disclose authorship.

**After posting:** record the #social message link in PROGRESS.md 12.6.

---

## 12.7 — Early-adopter emails (≤ 10, over three weeks)

**Channel:** direct email; the opener tied to something the person wrote or
built is mandatory. No more than 4 per day, one reminder at most, none if
there is no reply. The maintainer picks the recipients; the assistant can
then draft each email as a Gmail draft, never sends.

**Where to find recipients (public work only):** authors of open-source
health/terminology MCP servers or FHIR terminology tooling on GitHub;
authors of recent posts on LLMs and coded clinical data; clinical
informatics researchers who publish on ICD-11 transition.

**Template:**

**Subject:** *Question about [specific thing they wrote or built]*

> Hi [Name],
>
> [One specific line about their work — mandatory.]
>
> I maintain a small open-source MCP server that lets AI assistants look up
> ICD-11, LOINC, RxNorm, MeSH, ATC and the Brazilian CID-10 in the official
> sources, map ICD-10 to ICD-11 with WHO's transition tables, and label
> free-text terms exact / strong / needs review, with provenance on every
> answer.
>
> Given your work on [their topic], I'd value one honest reaction: would
> this fit a workflow you run, and what would be missing? Five minutes at
> most; no follow-up if you don't reply.
>
> https://github.com/SidneyBissoli/medical-terminologies-mcp
>
> Thanks,
> Sidney Bissoli

**After sending:** record count and date (not names) in PROGRESS.md 12.7.

---

## 12.8 — Discord

**Channel (measured 2026-11-20):** the **official MCP Discord is a
contributor server** (working groups, SDKs) and says "Do not market products
or services on the server" (modelcontextprotocol.io/community/communication)
— **do not post there**; that page points announcements to GitHub
Discussions. The **official Claude Discord** is listed on
claude.com/community as "real-time help, project sharing"; its channel list
and rules can only be seen after joining. The same page offers a form for
projects to be featured on Claude's channels.

**Recommendation:** join the Claude Discord, read its rules and post in the
project-sharing channel if there is one; otherwise record it as skipped.

**Text (short):**

> Built an open-source remote MCP server for medical terminologies: ICD-11,
> LOINC, RxNorm, MeSH, ATC and the Brazilian CID-10, with WHO ICD-10→ICD-11
> mapping and provenance on every answer. Add it as a custom connector with
> https://medical.sidneybissoli.com/mcp — no account or key. Feedback
> welcome: https://github.com/SidneyBissoli/medical-terminologies-mcp

**After posting:** record the channel and date in PROGRESS.md 12.8.

---

## 12.9 — ResearchGate

**Channel (measured 2026-11-20):** ResearchGate's help pages no longer
mention "Projects" (user reports since Aug 2023 say the feature was
removed). Software can be added as a **"Code"** research item, which
**requires an attached file** (help.researchgate.net, "How to add
research"). Low priority, as planned.

**What to attach:** the source archive of release v2.4.0
(<https://github.com/SidneyBissoli/medical-terminologies-mcp/releases/tag/v2.4.0>,
"Source code (zip)").

**Title:** *medical-terminologies-mcp: an MCP server for ICD-11, LOINC, RxNorm, MeSH, ATC and Brazilian CID-10 (v2.4.0)*

**Description:**

> Open-source (MIT) Model Context Protocol server that gives AI assistants
> read-only access to medical terminologies from their official sources:
> ICD-11 (WHO ICD-API), LOINC, RxNorm and MeSH (U.S. National Library of
> Medicine), ATC (via NLM RxClass) and the Brazilian CID-10 (DataSUS
> V2008). It maps ICD-10 to ICD-11 with the WHO transition tables (release
> 2025-01), harmonizes free-text terms to codes with an explicit review
> label, and returns a provenance record (source, version, retrieval time,
> citation, license) with every response. Intended for research,
> public-health analysis, health-informatics development and teaching; not
> a clinical decision tool. Code and documentation:
> https://github.com/SidneyBissoli/medical-terminologies-mcp

**After posting:** record the item URL in PROGRESS.md 12.9.

---

## 12.10 — Claude Connectors Directory (Anthropic)

**Channel (measured 2026-11-20, claude.com/docs/connectors/building/
submission.md and review-criteria.md):** open to third parties through the
portal **https://claude.ai/directory/manage** → "MCP connector"; any paid
Claude plan can submit. Remote HTTPS servers only (this one qualifies).
Requirements checked against the live server on 2026-11-20: every tool has
`title` and `readOnlyHint` ✅; public data may use no auth ✅; docs, privacy,
support and icon URLs exist ✅ (below). Listing goes out as "Community"
after an automated scan.

**Two points the maintainer must judge before submitting:**

1. **API ownership.** The criteria say the server "must call your own
   first-party APIs, or APIs you legitimately proxy". This server calls the
   WHO ICD-API (with registered client credentials) and NLM's public APIs
   under their terms of service. Whether that counts as "legitimately
   proxy" is the maintainer's call — read the WHO ICD-API and NLM terms
   first.
2. **Health data question.** The form asks whether the connector handles
   personal health data. Facts for the answer: it serves public reference
   vocabularies, logs no query content (PRIVACY.md), but the terms a user
   sends are forwarded to WHO/NLM APIs — the README and tool descriptions
   tell users to de-identify.

**Field values (limits: name 100, one-liner 200, description 2,000):**

- **Name:** Medical Terminologies
- **One-liner (≤ 200):** Look up ICD-11, LOINC, RxNorm, MeSH, ATC and Brazilian CID-10 codes in the official sources, map ICD-10 to ICD-11, and harmonize free-text terms, with provenance.
- **Server URL:** https://medical.sidneybissoli.com/mcp
- **Authentication:** none
- **Docs URL:** https://github.com/SidneyBissoli/medical-terminologies-mcp#readme
- **Privacy policy URL:** https://github.com/SidneyBissoli/medical-terminologies-mcp/blob/main/PRIVACY.md
- **Support:** https://github.com/SidneyBissoli/medical-terminologies-mcp/issues
- **Icon:** https://raw.githubusercontent.com/SidneyBissoli/medical-terminologies-mcp/main/assets/icon-light.png (512×512; dark variant `icon-dark.png`)
- **Description (≤ 2,000):**

> Medical Terminologies gives Claude read-only access to the standard
> medical code systems, answered from their official sources rather than
> from the model's memory.
>
> Code systems: ICD-11 (WHO ICD-API), LOINC, RxNorm and MeSH (U.S. National
> Library of Medicine), ATC (WHO Collaborating Centre, via NLM RxClass) and
> the Brazilian Portuguese CID-10 (DataSUS V2008).
>
> What it does:
> - Search and look up codes in each system, with hierarchy, answers and
>   panels where the source has them.
> - Map ICD-10 to ICD-11 with WHO's transition tables, including the
>   alternative codes WHO documents, and say "no mapping" when there is
>   none.
> - Harmonize up to 50 free-text diagnoses, drugs or lab names at once;
>   each term is labelled exact, strong or needs review, so ambiguous terms
>   go to a person.
> - Validate lists of existing codes and report which terminology versions
>   are in use.
>
> Every answer includes its provenance: source, data version, retrieval
> time, citation and license.
>
> Intended for researchers, public-health analysts, health-informatics
> developers and educators. It is not a clinical decision tool and does not
> store your queries. Terms you send are forwarded to the WHO and NLM APIs,
> so de-identify data first.

**After submitting:** record the submission date and status in PROGRESS.md
12.10.

---

## Risks and what NOT to do

1. **Never suggest clinical-care use.** "Useful for coding and research
   data" is fine; "ready for clinical use" is not. The README says so.
2. **No inflated language** ("revolutionary", "comprehensive",
   "enterprise-ready"). Say the specific thing: "33 read-only tools",
   "WHO transition tables, release 2025-01".
3. **No unverified numbers or third parties.** Re-check the facts table if
   it is more than a month old.
4. **Reddit:** rules by hand first; ≥ 48 h between subreddits; a removed
   post is not reposted.
5. **chat.fhir.org:** #social only, concise, with disclosure; #terminology
   only in reply to a relevant thread.
6. **MCP Discord:** contributor server — no product posts.
7. **Email:** mandatory specific opener, ≤ 4 per day, ≤ 1 reminder.
8. **Anti-metrics** (from PROGRESS.md): likes, boosts and hours spent are
   not success. The 60-day review (2026-10-03) already met 3 of 5 criteria;
   this round is about reaching the research and informatics audience, not
   volume.
