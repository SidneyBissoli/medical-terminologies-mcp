# Security Policy

## Supported Versions

Only the latest published version receives security fixes. The package
has no long-term-support branches — upgrade to the most recent release
to stay patched.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| older   | ❌        |

## Reporting a Vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/SidneyBissoli/medical-terminologies-mcp/security/advisories/new)
— do **not** open a public issue for security problems.

If you cannot use GitHub, email **sbissoli76@gmail.com** with
`[SECURITY]` in the subject line.

What to expect:

- **Acknowledgment** within 7 days.
- **Assessment and fix timeline** communicated after triage. Fixes ship
  as a patch release to npm and the hosted Cloudflare Workers endpoint.
- **Credit** in the release notes, unless you prefer to remain anonymous.

## Scope notes

- This server is a read-only proxy over public medical-terminology APIs
  (WHO ICD-11, NLM Clinical Tables, RxNav, MeSH, optional Snowstorm) plus
  bundled static datasets. It stores no user data and requires no
  credentials except the operator's own WHO OAuth2 client (and optional
  SNOMED endpoint configuration).
- Reports about upstream API behavior (WHO, NLM, NIH) should go to the
  respective upstream maintainers; this project can only mitigate, not
  fix, upstream issues.
- The hosted endpoint at
  `https://medical.sidneybissoli.com` is
  covered by this policy.
