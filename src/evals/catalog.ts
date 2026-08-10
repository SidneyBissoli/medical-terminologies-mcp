/**
 * Live tool catalog for the tool-selection eval (`@sbissoli/mcp-evals`).
 *
 * Option (b) of the adoption design (medical/docs/03 §2): a single group
 * runs the real `registerAll` from `src/register.ts` — zero touch on the
 * production registration path — and the per-tool area is then reassigned
 * from the cluster map below, so the per-area accuracy report reflects
 * the terminology clusters instead of one monolithic "medical" area.
 *
 * Two medical-specific adaptations over the ibge recipe:
 *  - `registerAll` also wires prompts/resources → stubbed to no-ops on
 *    the capturing fake (same as ibge);
 *  - `registerAll` passes the SDK's `StandardSchemaWithJSON` wrappers as
 *    inputSchema (not zod), which the extractor's shape converter can't
 *    digest → the interposed `registerTool` strips the shape at capture
 *    time and the REAL advertised JSON Schemas are re-attached from
 *    `toolRegistry` below (they are the canonical wire schemas anyway).
 *
 * The catalog reflects the DEFAULT surface (31 tools — SNOMED flag off),
 * mirroring production; the 6 gated tools have no public endpoint and
 * stay out of the fixtures.
 */

import {
  buildCatalog,
  type Catalog,
  type CatalogGroup,
  type CapturingServer,
} from '@sbissoli/mcp-evals';
import { registerAll } from '../register.js';
import { toolRegistry } from '../server-core.js';

const GROUPS: CatalogGroup[] = [
  {
    area: 'medical',
    register: (server: CapturingServer) => {
      const stripSchema = (
        name: string,
        config: { description?: string },
        cb?: unknown,
      ): void => {
        server.captured.push({ name, description: config.description ?? '', shape: undefined });
        void cb;
      };
      const capturing = Object.assign(Object.create(server) as CapturingServer, {
        registerTool: stripSchema,
        registerResource: () => undefined,
        registerPrompt: () => undefined,
      });
      registerAll(capturing as never);
    },
  },
];

/**
 * Primary area per tool — a PARTITION of the 31 default tools by
 * terminology cluster (map of the `src/tools/` files). The per-cluster
 * top-1 of the paid run is the empirical criterion for the mcp-builder
 * premise "prefix by terminology" (renaming is breaking — only with
 * evidence of systematic cross-cluster confusion, never by reflex).
 */
export const AREA_BY_TOOL: Record<string, string> = {
  icd11_search: 'icd11',
  icd11_lookup: 'icd11',
  icd11_hierarchy: 'icd11',
  icd11_chapters: 'icd11',
  icd11_postcoordination: 'icd11',
  cid10_search: 'cid10',
  cid10_lookup: 'cid10',
  cid10_chapters: 'cid10',
  cid10_chapter: 'cid10',
  loinc_search: 'loinc',
  loinc_details: 'loinc',
  loinc_answers: 'loinc',
  loinc_panels: 'loinc',
  rxnorm_search: 'rxnorm',
  rxnorm_concept: 'rxnorm',
  rxnorm_ingredients: 'rxnorm',
  rxnorm_classes: 'rxnorm',
  rxnorm_ndc: 'rxnorm',
  atc_classify: 'atc',
  atc_lookup: 'atc',
  atc_members: 'atc',
  mesh_search: 'mesh',
  mesh_descriptor: 'mesh',
  mesh_tree: 'mesh',
  mesh_qualifiers: 'mesh',
  map_icd10_to_icd11: 'crosswalk',
  map_loinc_to_snomed: 'crosswalk',
  validate_codes: 'crosswalk',
  find_equivalent: 'crosswalk',
  terminology_versions: 'versioning',
  terminology_diff: 'versioning',
};

const base = buildCatalog(GROUPS);

/** The registry's JSON Schemas are the canonical advertised wire schemas. */
const registrySchemas = new Map(
  toolRegistry.getTools().map((t) => [t.name, t.inputSchema as Record<string, unknown>]),
);

function advertisedInputSchema(name: string): Catalog['tools'][number]['inputSchema'] {
  const raw = registrySchemas.get(name) ?? {};
  return {
    type: 'object',
    properties: (raw.properties as Record<string, unknown> | undefined) ?? {},
    required: (raw.required as string[] | undefined) ?? [],
    additionalProperties: false,
  };
}

export const CATALOG: Catalog = {
  tools: base.tools.map((t) => ({
    ...t,
    area: AREA_BY_TOOL[t.name] ?? t.area,
    inputSchema: advertisedInputSchema(t.name),
  })),
  toolNames: base.toolNames,
  areaByName: new Map(base.tools.map((t) => [t.name, AREA_BY_TOOL[t.name] ?? t.area])),
};
