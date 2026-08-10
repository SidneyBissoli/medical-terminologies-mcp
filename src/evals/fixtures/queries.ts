/**
 * Tool-selection fixtures — 40 realistic queries in the personas of the
 * server's real users (clinical informaticists, health-data engineers,
 * researchers; usage baseline in medical/docs/00). English is the product
 * language; a deliberate pt-BR subset exercises the cid10 cluster and the
 * official-translation discoverability (D2-C: `language: "pt"` on
 * ICD-11/MeSH) without inflating the catalog.
 *
 * Fixture id prefix = cluster: `icd-` (ICD-11), `cid-` (CID-10 pt-BR),
 * `lnc-` (LOINC), `rx-` (RxNorm), `atc-` (ATC), `msh-` (MeSH),
 * `xw-` (crosswalk/unified search — includes the find_equivalent vs
 * dedicated-search discriminators), `ver-` (versioning).
 *
 * `expectedTools` = the acceptable FIRST tool call(s); more than one entry
 * only where two tools are genuinely defensible first steps.
 *
 * Decision rule (mcp-builder gap "prefix by terminology", registered in
 * medical/roadmap.md): high per-cluster top-1 → keep the current names
 * (renaming is breaking); systematic CROSS-cluster confusion → propose a
 * surgical rename of the confused cluster to the decision-maker.
 */

import type { EvalFixture } from '@sbissoli/mcp-evals';

export const FIXTURES: EvalFixture[] = [
  // ── icd11 — WHO ICD-11 (current international revision) ──────────────────
  {
    id: 'icd-01',
    query: 'What is the ICD-11 code for type 2 diabetes?',
    expectedTools: ['icd11_search'],
    note: 'Name → code in the CURRENT international revision is icd11_search; cid10_search is the Brazilian ICD-10, find_equivalent is multi-terminology.',
  },
  {
    id: 'icd-02',
    query: 'Give me the full definition and coding notes for ICD-11 code 5A11.',
    expectedTools: ['icd11_lookup'],
    note: 'A known code wanting detail is the lookup, not a new search.',
  },
  {
    id: 'icd-03',
    query: 'List the subcategories under ICD-11 code CA40 (pneumonia).',
    expectedTools: ['icd11_hierarchy'],
    note: 'Parent/children navigation is icd11_hierarchy.',
  },
  {
    id: 'icd-04',
    query: 'Show me the top-level chapter structure of ICD-11.',
    expectedTools: ['icd11_chapters'],
    note: 'Chapter overview has a dedicated tool; search would be noise.',
  },
  {
    id: 'icd-05',
    query: 'Can I add severity or laterality extensions to ICD-11 code ND56.2?',
    expectedTools: ['icd11_postcoordination'],
    note: 'Postcoordination axes are exclusive to icd11_postcoordination.',
  },
  {
    id: 'icd-06',
    query: 'Preciso do rótulo oficial em português da CID-11 para asma.',
    expectedTools: ['icd11_search'],
    note: 'pt-BR OFFICIAL content of the CURRENT revision = icd11_search with language "pt" (D2-C); cid10_search is the frozen Brazilian ICD-10, not ICD-11.',
  },
  // ── cid10 — DataSUS V2008 (Brazilian Portuguese ICD-10) ──────────────────
  {
    id: 'cid-01',
    query: 'Qual o código CID-10 de infarto agudo do miocárdio para faturamento no SUS?',
    expectedTools: ['cid10_search'],
    note: 'SUS billing context = the Brazilian CID-10 dataset, not ICD-11.',
  },
  {
    id: 'cid-02',
    query: 'O que significa o código I21 na CID-10 brasileira?',
    expectedTools: ['cid10_lookup'],
    note: 'Known CID-10 code → cid10_lookup resolves to the official Portuguese name.',
  },
  {
    id: 'cid-03',
    query: 'Liste os capítulos da CID-10.',
    expectedTools: ['cid10_chapters'],
    note: 'Explicit CID-10 chapter listing.',
  },
  {
    id: 'cid-04',
    query: 'Quais grupos de códigos compõem o capítulo IX da CID-10 (doenças do aparelho circulatório)?',
    expectedTools: ['cid10_chapter'],
    note: 'Drill into ONE chapter is cid10_chapter, not the chapters list.',
  },
  {
    id: 'cid-05',
    query: 'I need the Brazilian Portuguese ICD-10 code that SUS systems use for tuberculosis.',
    expectedTools: ['cid10_search'],
    note: 'English query, Brazilian target: the SUS/pt-BR qualifier must route to cid10_search, not icd11_search.',
  },
  // ── loinc — lab/clinical observations ────────────────────────────────────
  {
    id: 'lnc-01',
    query: 'Find the LOINC code for hemoglobin A1c.',
    expectedTools: ['loinc_search'],
    note: 'Lab-test name → LOINC code is loinc_search.',
  },
  {
    id: 'lnc-02',
    query: 'What are the component, property, and system of LOINC 2339-0?',
    expectedTools: ['loinc_details'],
    note: 'Known code, full attribute table → loinc_details.',
  },
  {
    id: 'lnc-03',
    query: 'What answer options are defined for the LOINC survey question 44250-9?',
    expectedTools: ['loinc_answers'],
    note: 'Answer lists of questionnaire items are exclusive to loinc_answers.',
  },
  {
    id: 'lnc-04',
    query: 'Which individual tests make up the lipid panel LOINC 24331-1?',
    expectedTools: ['loinc_panels'],
    note: 'Panel structure → loinc_panels.',
  },
  {
    id: 'lnc-05',
    query: 'Search LOINC for blood pressure observations.',
    expectedTools: ['loinc_search'],
    note: 'Vital-sign observation search stays in loinc_search (control).',
  },
  // ── rxnorm — drug concepts (top usage axis, docs/00) ─────────────────────
  {
    id: 'rx-01',
    query: 'Find the RxNorm concept for Lipitor.',
    expectedTools: ['rxnorm_search'],
    note: 'Brand name → RxCUI is rxnorm_search.',
  },
  {
    id: 'rx-02',
    query: 'Show the details and related concepts of RxCUI 161.',
    expectedTools: ['rxnorm_concept'],
    note: 'Known RxCUI → rxnorm_concept.',
  },
  {
    id: 'rx-03',
    query: 'What are the active ingredients of the combination product with RxCUI 861007?',
    expectedTools: ['rxnorm_ingredients'],
    note: 'Ingredient decomposition → rxnorm_ingredients.',
  },
  {
    id: 'rx-04',
    query: 'Which therapeutic classes does RxCUI 6809 belong to?',
    expectedTools: ['rxnorm_classes'],
    note: 'Classes BY RxCUI is rxnorm_classes; atc_classify takes a drug NAME.',
  },
  {
    id: 'rx-05',
    query: 'List the NDC codes for RxCUI 197361.',
    expectedTools: ['rxnorm_ndc'],
    note: 'RxCUI ↔ NDC mapping → rxnorm_ndc.',
  },
  {
    id: 'rx-06',
    query: 'What drug does the National Drug Code 00093-1048-01 correspond to?',
    expectedTools: ['rxnorm_ndc'],
    note: 'NDC → RxCUI is the other direction of rxnorm_ndc.',
  },
  // ── atc — WHO drug classification via RxClass ────────────────────────────
  {
    id: 'atc-01',
    query: 'What is the ATC code for metformin?',
    expectedTools: ['atc_classify'],
    note: 'Drug name → ATC code(s) is atc_classify.',
  },
  {
    id: 'atc-02',
    query: 'What class does the ATC code A10BA represent?',
    expectedTools: ['atc_lookup'],
    note: 'Known ATC code → its class name/level is atc_lookup.',
  },
  {
    id: 'atc-03',
    query: 'List every drug that belongs to ATC class C09AA (ACE inhibitors).',
    expectedTools: ['atc_members'],
    note: 'Class → member substances is atc_members.',
  },
  // ── mesh — literature indexing vocabulary ────────────────────────────────
  {
    id: 'msh-01',
    query: 'Find the right MeSH heading for my PubMed search about heart attacks.',
    expectedTools: ['mesh_search'],
    note: 'PubMed/indexing context routes to MeSH, not to a clinical coding system.',
  },
  {
    id: 'msh-02',
    query: 'Show the scope note and tree numbers of MeSH descriptor D009203.',
    expectedTools: ['mesh_descriptor'],
    note: 'Known descriptor ID → mesh_descriptor.',
  },
  {
    id: 'msh-03',
    query: 'Where does D003920 sit in the MeSH tree hierarchy?',
    expectedTools: ['mesh_tree', 'mesh_descriptor'],
    note: 'mesh_tree is the dedicated answer; mesh_descriptor also returns tree numbers, so it is a defensible first step.',
  },
  {
    id: 'msh-04',
    query: 'Which subheadings can I combine with Diabetes Mellitus (D003920) in an indexing query?',
    expectedTools: ['mesh_qualifiers'],
    note: 'Allowed qualifiers → mesh_qualifiers.',
  },
  {
    id: 'msh-05',
    query: 'O descritor MeSH D006973 tem tradução oficial em português? Quero o rótulo em pt.',
    expectedTools: ['mesh_descriptor'],
    note: 'pt-BR official MeSH labels come from mesh_descriptor with language "pt" (D2-C discoverability).',
  },
  // ── crosswalk / unified search ───────────────────────────────────────────
  {
    id: 'xw-01',
    query: 'Map ICD-10 code E11 to its ICD-11 equivalent.',
    expectedTools: ['map_icd10_to_icd11'],
    note: 'Authoritative ICD-10→ICD-11 mapping (WHO transition tables) — never a text search.',
  },
  {
    id: 'xw-02',
    query: 'How do I map LOINC 2339-0 to SNOMED CT?',
    expectedTools: ['map_loinc_to_snomed'],
    note: 'LOINC→SNOMED has a dedicated (guidance) tool.',
  },
  {
    id: 'xw-03',
    query: 'Validate this batch of legacy codes from our database: A00 (icd10), 2339-0 (loinc), 6809 (rxnorm).',
    expectedTools: ['validate_codes'],
    note: 'Mixed-terminology batch validation is exactly validate_codes.',
  },
  {
    id: 'xw-04',
    query: 'Find the equivalent of "myocardial infarction" across all the terminologies you cover.',
    expectedTools: ['find_equivalent'],
    note: 'Explicit cross-terminology equivalence → the ranked unified search.',
  },
  {
    id: 'xw-05',
    query: 'I already have the SNOMED concept for asthma; what are the matching codes in the other terminologies?',
    expectedTools: ['find_equivalent'],
    note: 'Source known, equivalents wanted elsewhere → find_equivalent with source_terminology.',
  },
  {
    id: 'xw-06',
    query: "What's the ICD-11 code for asthma?",
    expectedTools: ['icd11_search'],
    note: 'DISCRIMINATOR: single-terminology question must go to the dedicated search, not find_equivalent.',
  },
  {
    id: 'xw-07',
    query: 'Does ICD-10 code A09 still exist, and what replaced it in ICD-11?',
    expectedTools: ['map_icd10_to_icd11', 'validate_codes'],
    note: 'Both surface the ICD-11 replacement of a legacy ICD-10 code; either is a defensible first step.',
  },
  {
    id: 'xw-08',
    query: 'Compare how ICD-11 and MeSH represent hypertension.',
    expectedTools: ['find_equivalent'],
    note: 'Two-terminology comparison of one concept → find_equivalent with target_terminologies.',
  },
  {
    id: 'xw-09',
    query: 'Qual o equivalente do termo "hipertensão" nas outras terminologias? Busque em inglês se precisar.',
    expectedTools: ['find_equivalent'],
    note: 'pt-BR phrasing of the cross-terminology ask still routes to find_equivalent (which searches upstreams in English).',
  },
  // ── versioning — release metadata ────────────────────────────────────────
  {
    id: 'ver-01',
    query: 'Which release of each terminology is this server querying right now?',
    expectedTools: ['terminology_versions'],
    note: 'Version table across the 8 terminologies → terminology_versions.',
  },
  {
    id: 'ver-02',
    query: 'How many ICD-10 categories map 1:1 to ICD-11, and how many split?',
    expectedTools: ['terminology_diff'],
    note: 'Cross-revision statistics live in terminology_diff (icd10 case).',
  },
  {
    id: 'ver-03',
    query: 'Before my batch run: which LOINC version does the server use, and how often does it update?',
    expectedTools: ['terminology_versions'],
    note: 'Pipeline-maintainer version check → terminology_versions (optionally filtered).',
  },
];
