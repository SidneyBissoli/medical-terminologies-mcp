# Notice — Medical Terminology Licenses and Attributions

This software is MIT-licensed (see [LICENSE](./LICENSE)). **The MIT
license applies only to the server code and server-maintained metadata,
not to the medical terminology content accessed through it** — and, in
particular, **not to the two datasets bundled with the server**
(`src/data/cid10.json` and `src/data/icd10-to-icd11.json`), which remain
under their own terms as described below.

Every successful tool response carries a machine-readable provenance
block (source, canonical URL, data vintage, extraction instant, citation,
license) so downstream users can honor these terms per response.

## 1. ICD-11 (World Health Organization)

ICD-11 content is licensed under the
[Creative Commons Attribution-NoDerivatives 3.0 IGO license (CC BY-ND 3.0 IGO)](https://creativecommons.org/licenses/by-nd/3.0/igo/),
under the terms of the
[ICD-11 Terms of Use and License Agreement](https://icd.who.int/en/docs/icd11-license.pdf).

- Required citation (license §1.3): *"International Classification of
  Diseases, Eleventh Revision (ICD-11), World Health Organization (WHO)
  2019 https://icd.who.int/browse11. Licensed under the Creative Commons
  Attribution-NoDerivatives 3.0 IGO licence (CC BY-ND 3.0 IGO)."*
- This server serves ICD-11 content verbatim and always preserves the
  entity **code, title, and URI** together (license §1.2.2–1.2.3).
- Portuguese and other non-English labels served by this server are
  **WHO's own official translations**, requested through the API's
  language parameter — never machine-translated (license §1.2.4 reserves
  translation rights to WHO).
- The WHO name and emblem are not used to imply endorsement (§4.1).
- WHO may terminate the license at any time by notice (§4.7); if that
  happens, the ICD-11 tools of this server will be discontinued.
- API access requires free OAuth credentials from https://icd.who.int/icdapi.

## 2. WHO ICD-10 → ICD-11 transition tables (bundled dataset)

`src/data/icd10-to-icd11.json` is a format conversion (TSV → JSON,
content unaltered) of the transition tables that WHO publishes within
the ICD-11 release (release 2025-01,
https://icdcdn.who.int/static/releasefiles/2025-01/mapping.zip). The
dataset remains **© World Health Organization** under the ICD-11 Terms
of Use above — it is **not** covered by this project's MIT license. The
ICD-10 codes and titles it contains remain © WHO under WHO's ICD-10
licensing regime. Per WHO's own guidance: *"Mapping tables show the
correspondence between ICD-10 and ICD-11 codes. They are not intended
for directly converting data from one revision to the other."*

## 3. CID-10 V2008 (DataSUS / CBCD — bundled dataset)

`src/data/cid10.json` is built from the CID-10 V2008 electronic files
published by DataSUS (Ministério da Saúde do Brasil,
http://www2.datasus.gov.br/cid10/V2008/). Rights chain, as declared by
DataSUS: the CID-10 copyright belongs to the **World Health
Organization**; the Brazilian Portuguese translation rights belong to
the **CBCD (Centro Colaborador da OMS para a Classificação de Doenças
em Português) / Faculdade de Saúde Pública da USP**.

The governing permission (DataSUS copyright page, V2008, confirmed
verbatim on the CBCD's own page): system developers may use these files
**provided due credit is given and no charge is made for their use**.
This server complies: the dataset is served free of charge, with credit
in every response's provenance block. The dataset is **not** covered by
this project's MIT license.

## 4. LOINC (Regenstrief Institute, via NLM Clinical Tables)

This material contains content from LOINC (http://loinc.org). LOINC is
copyright © Regenstrief Institute, Inc. and the Logical Observation
Identifiers Names and Codes (LOINC) Committee and is available at no
cost under the license at http://loinc.org/license. LOINC® is a
registered United States trademark of Regenstrief Institute, Inc.

- Every LOINC code served by this server is accompanied by its official
  display name (LONG_COMMON_NAME), as the license requires.
- LOINC terms that carry third-party copyright (e.g. survey instruments)
  are served with their `EXTERNAL_COPYRIGHT_NOTICE` passed through
  verbatim.
- LOINC display names are never translated by this server (translations
  are derivative works reserved to Regenstrief).

## 5. RxNorm (U.S. National Library of Medicine)

RxNorm content served via the NLM RxNav API is non-proprietary,
public-domain content, free of charge
([RxNav Terms of Service](https://lhncbc.nlm.nih.gov/RxNav/TermsofService.html)).

Required statement: *"This product uses publicly available data from the
U.S. National Library of Medicine (NLM), National Institutes of Health,
Department of Health and Human Services; NLM is not responsible for the
product and does not endorse or recommend this or any other product."*
The NLM name and logo are not used.

## 6. ATC (WHO Collaborating Centre, via NLM RxClass)

ATC classification © WHO Collaborating Centre for Drug Statistics
Methodology (https://atcddd.fhi.no/). This server retrieves ATC codes
and names via the NLM RxClass API, under the NLM Terms of Service, and
serves them verbatim. This server never redistributes the WHOCC ATC/DDD
index itself. The NLM statement in section 5 applies to the RxClass
channel as well.

## 7. MeSH (U.S. National Library of Medicine)

MeSH content is a U.S. government work served under the
[NLM Terms and Conditions](https://www.nlm.nih.gov/databases/download/terms_and_conditions.html),
free of charge. Credit: **Courtesy of the U.S. National Library of
Medicine.** No endorsement by NLM is implied.

## 8. SNOMED CT (SNOMED International)

SNOMED CT requires a SNOMED International (IHTSDO) license. This server
does **not** bundle or redistribute SNOMED CT content: the SNOMED tools
are disabled by default and only work against a Snowstorm instance
configured by the operator (`ENABLE_SNOMED_TOOLS` / `SNOMED_BASE_URL`),
**under the operator's own license**. Member countries have national
licenses; in non-member countries (including Brazil) a license must be
requested from https://www.snomed.org/get-snomed. The SNOMED license
disclaimer is attached to every SNOMED tool result.

---

Per-response details are available in the provenance block of every tool
response and in the `info://licenses` MCP resource; this file is the
consolidated notice for the npm package.
