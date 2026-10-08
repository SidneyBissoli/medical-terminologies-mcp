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

import { capturarSuperficie, conferirMetaDoServerJson, conferirSecao, modoEscrita } from '@sbissoli/mcp-surface';
import { describe, expect, it } from 'vitest';

import { createServer } from './register.js';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const versao = (JSON.parse(readFileSync(`${raiz}package.json`, 'utf8')) as { version: string }).version;

describe('surface.lock.json — superfície declarada', () => {
  it('bate com a trava, ou a versão subiu junto', async () => {
    const v = conferirSecao(`${raiz}surface.lock.json`, 'declarada', await capturarSuperficie(createServer()), versao);
    expect(v.ok, v.mensagem).toBe(true);
  });

  // A impressão digital vai ao MCP Registry com a versão (_meta publisher-provided,
  // SPEC.md do pacote), para o CLIENTE conferir na primeira conexão. Sem este teste,
  // `surface:lock` regravaria a trava e o server.json seguiria publicando o sha
  // antigo: o registro mentiria justamente sob a versão nova. A chamada é a mesma
  // tool sem rede que o deploy-worker.yml usa no `mcp-surface verificar`.
  // Fora do modo de escrita: no `surface:lock` este arquivo roda ANTES do
  // `mcp-surface registro`, que é quem grava o bloco a partir da trava nova.
  it.skipIf(modoEscrita())('o server.json publica a impressão digital da trava (o que o registro mostra ao cliente)', () => {
    const v = conferirMetaDoServerJson(`${raiz}server.json`, `${raiz}surface.lock.json`, {
      chamada: { name: 'cid10_chapters', arguments: {} },
    });
    expect(v.ok, v.mensagem).toBe(true);
  });
});
