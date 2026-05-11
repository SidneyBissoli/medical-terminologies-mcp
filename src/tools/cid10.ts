/**
 * CID-10 Tools (Brazilian translation of ICD-10, DataSUS V2008)
 *
 * - cid10_search:    Portuguese text search across categories/subcategories
 * - cid10_lookup:    Exact code lookup ("A00", "A00.1", "A001")
 * - cid10_chapters:  List the 22 chapters
 * - cid10_chapter:   Get one chapter with its constituent groups
 *
 * Backed by `src/data/cid10.json`, bundled into the build. No HTTP calls.
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toolRegistry } from '../server-core.js';
import { getCID10Client } from '../clients/cid10-client.js';
import {
  CID10SearchParamsSchema,
  CID10LookupParamsSchema,
  CID10ChapterParamsSchema,
  CID10SearchOutputSchema,
  CID10LookupOutputSchema,
  CID10ChaptersOutputSchema,
  CID10ChapterDetailOutputSchema,
  CID10SearchOutput,
  CID10LookupOutput,
  CID10ChaptersOutput,
  CID10ChapterDetailOutput,
} from '../types/index.js';
import {
  buildInputSchema,
  buildOutputSchema,
  handleToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
} from '../utils/zod-schema.js';
import { z } from 'zod';

// ============================================================================
// Tool Definitions
// ============================================================================

const cid10SearchTool: Tool = {
  name: 'cid10_search',
  description: `Search the Brazilian CID-10 (Classificação Estatística Internacional de Doenças, 10ª Revisão) by Portuguese text.

Use this tool to:
- Find CID-10 codes for Brazilian SUS / ANVISA contexts ("infarto", "diabetes", "tuberculose")
- Look up the official Portuguese (CBCD/USP) translation of a clinical term
- Locate codes for billing, epidemiology, and clinical documentation in Brazil

Returns matches from CID-10 categories (3-char) and/or subcategories (4-char). Search is diacritic-insensitive: typing "infeccoes" matches "infecções". This tool searches the Brazilian Portuguese CID-10 V2008 — for the international ICD-11 (current WHO revision, in English by default), use icd11_search.`,
  inputSchema: buildInputSchema(CID10SearchParamsSchema),
  outputSchema: buildOutputSchema(CID10SearchOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const cid10LookupTool: Tool = {
  name: 'cid10_lookup',
  description: `Look up a specific CID-10 code and return its Portuguese name.

Use this tool to:
- Resolve a code to its Brazilian description ("I21" → "Infarto agudo do miocárdio")
- Confirm a 3-char category or 4-char subcategory exists in CID-10
- Retrieve gender / cause-of-death restriction flags when applicable

Accepts both dotted ("A00.1") and undotted ("A001") forms; returns the canonical display.`,
  inputSchema: buildInputSchema(CID10LookupParamsSchema),
  outputSchema: buildOutputSchema(CID10LookupOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const cid10ChaptersTool: Tool = {
  name: 'cid10_chapters',
  description: `List the 22 chapters of CID-10 with their code ranges and Portuguese titles.

Use this tool to:
- See the top-level structure of CID-10 (chapters I-XXII, e.g., "I. Algumas doenças infecciosas e parasitárias", "IX. Doenças do aparelho circulatório")
- Map a code to its chapter by code range (e.g., I00-I99 → chapter IX)
- Build a navigable table of contents for downstream tooling

Returns 22 entries — CID-10 V2008 has not been updated since 2008.`,
  inputSchema: buildInputSchema(z.object({})),
  outputSchema: buildOutputSchema(CID10ChaptersOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const cid10ChapterTool: Tool = {
  name: 'cid10_chapter',
  description: `Get one CID-10 chapter and its constituent groups (e.g., "Chapter IX → I00-I02 Febre reumática aguda, I05-I09 Doenças reumáticas crônicas do coração, ...").

Use this tool to:
- Drill from a chapter into its groups
- Build hierarchical browsers
- Find which group contains a code range

Provide a chapter number (1-22).`,
  inputSchema: buildInputSchema(CID10ChapterParamsSchema),
  outputSchema: buildOutputSchema(CID10ChapterDetailOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

// ============================================================================
// Formatters
// ============================================================================

function formatHit(h: CID10SearchOutput['hits'][number]): string {
  const lines: string[] = [];
  const tag = h.level === 'category' ? '3-char' : '4-char';
  lines.push(`**${h.display}** (${tag}) — ${h.title}`);
  const meta: string[] = [];
  if (h.chapter_num !== null) meta.push(`Chapter ${h.chapter_num}`);
  if (h.group_range) meta.push(`Group ${h.group_range}`);
  if (h.classif) meta.push(`classif: ${h.classif}`);
  if (h.restr_sexo) meta.push(`gender: ${h.restr_sexo}`);
  if (h.causa_obito) meta.push(`cause-of-death: ${h.causa_obito}`);
  if (meta.length > 0) lines.push(`  ${meta.join(' | ')}`);
  return lines.join('\n');
}

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleCID10Search(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = CID10SearchParamsSchema.parse(args);
    const client = getCID10Client();
    const { totalCount, hits } = client.search(
      params.query,
      params.level,
      params.max_results,
    );

    const structured: CID10SearchOutput = {
      query: params.query,
      level: params.level,
      total_count: totalCount,
      shown_count: hits.length,
      hits,
    };

    if (hits.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `Nenhum código CID-10 encontrado para "${params.query}".`,
          },
        ],
        structuredContent: structured,
      };
    }

    const header =
      `## Resultados CID-10 para "${params.query}"\n\n` +
      `Total: ${totalCount} (mostrando ${hits.length}, escopo: ${params.level}).\n\n`;
    const body = hits.map((h, i) => `${i + 1}. ${formatHit(h)}`).join('\n\n');

    return {
      content: [{ type: 'text', text: header + body }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleCID10Lookup(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = CID10LookupParamsSchema.parse(args);
    const client = getCID10Client();
    const hit = client.lookup(params.code);

    const structured: CID10LookupOutput = {
      code: params.code,
      found: hit !== null,
      hit,
    };

    if (!hit) {
      return {
        content: [
          {
            type: 'text',
            text: `# CID-10 ${params.code}\n\nCódigo não encontrado em CID-10 V2008.`,
          },
        ],
        structuredContent: structured,
      };
    }

    const lines: string[] = [];
    lines.push(`# CID-10 ${hit.display} — ${hit.title}`);
    lines.push('');
    lines.push(`**Nível:** ${hit.level === 'category' ? 'categoria (3 caracteres)' : 'subcategoria (4 caracteres)'}`);
    if (hit.chapter_num !== null) lines.push(`**Capítulo:** ${hit.chapter_num}`);
    if (hit.group_range) lines.push(`**Grupo:** ${hit.group_range}`);
    if (hit.classif) lines.push(`**Classificação:** ${hit.classif}`);
    if (hit.restr_sexo) lines.push(`**Restrição de sexo:** ${hit.restr_sexo}`);
    if (hit.causa_obito) lines.push(`**Causa de óbito:** ${hit.causa_obito}`);
    if (hit.refer) {
      lines.push('');
      lines.push(`**Referências:** ${hit.refer}`);
    }
    if (hit.excluidos) {
      lines.push('');
      lines.push(`**Exclusões:** ${hit.excluidos}`);
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleCID10Chapters(_args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const client = getCID10Client();
    const chapters = client.listChapters();

    const structured: CID10ChaptersOutput = { chapters };

    const lines: string[] = [];
    lines.push('# CID-10 — Capítulos');
    lines.push('');
    lines.push('| # | Faixa | Título |');
    lines.push('|---|-------|--------|');
    for (const ch of chapters) {
      lines.push(
        `| ${ch.num} | ${ch.code_start}-${ch.code_end} | ${ch.title} |`,
      );
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleCID10Chapter(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = CID10ChapterParamsSchema.parse(args);
    const client = getCID10Client();
    const { chapter, groups } = client.getChapter(params.num);

    const structured: CID10ChapterDetailOutput = {
      num: params.num,
      found: chapter !== null,
      chapter,
      groups,
    };

    if (!chapter) {
      return {
        content: [
          {
            type: 'text',
            text: `Capítulo ${params.num} não encontrado.`,
          },
        ],
        structuredContent: structured,
      };
    }

    const lines: string[] = [];
    lines.push(`# CID-10 — Capítulo ${chapter.num}: ${chapter.title}`);
    lines.push('');
    lines.push(`**Faixa de códigos:** ${chapter.code_start}-${chapter.code_end}`);
    lines.push('');
    lines.push(`## Grupos (${groups.length})`);
    lines.push('');
    if (groups.length === 0) {
      lines.push('_Nenhum grupo encontrado neste capítulo._');
    } else {
      lines.push('| Faixa | Título |');
      lines.push('|-------|--------|');
      for (const g of groups) {
        lines.push(`| ${g.code_start}-${g.code_end} | ${g.title} |`);
      }
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

// ============================================================================
// Tool Registration
// ============================================================================

toolRegistry.register(cid10SearchTool, handleCID10Search);
toolRegistry.register(cid10LookupTool, handleCID10Lookup);
toolRegistry.register(cid10ChaptersTool, handleCID10Chapters);
toolRegistry.register(cid10ChapterTool, handleCID10Chapter);
