/**
 * Impressão digital da superfície DECLARADA (@sbissoli/mcp-surface): mudou sem
 * subir a versão = vermelho, e o deploy não roda (deploy-worker.yml roda os
 * testes antes do wrangler). Captura o `createServer` do stdio; o Worker monta
 * o SEU servidor separadamente (`worker/src/server.ts`), e
 * `worker/tests/surface-lock.test.ts` prova que ele serve esta mesma
 * superfície — além de medir quem responde sem token.
 *
 * Até a 1.18.x a superfície dependia de AMBIENTE (as 6 tools SNOMED só se
 * registravam com `ENABLE_SNOMED_TOOLS=true`). Desde a 2.0.0, com o SNOMED
 * aposentado, há uma superfície só.
 *
 * Ao mudar a superfície: `npm version <nível> --no-git-tag-version` e
 * `npm run surface:lock`. A trava recusa regravar sob a versão antiga.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { capturarSuperficie, conferirSecao } from '@sbissoli/mcp-surface';
import { describe, expect, it } from 'vitest';

import { createServer } from './register.js';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const versao = (JSON.parse(readFileSync(`${raiz}package.json`, 'utf8')) as { version: string }).version;

describe('surface.lock.json — superfície declarada', () => {
  it('bate com a trava, ou a versão subiu junto', async () => {
    const v = conferirSecao(`${raiz}surface.lock.json`, 'declarada', await capturarSuperficie(createServer()), versao);
    expect(v.ok, v.mensagem).toBe(true);
  });
});
