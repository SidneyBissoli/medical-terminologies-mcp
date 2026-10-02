/**
 * Impressão digital da superfície DECLARADA (@sbissoli/mcp-surface): mudou sem
 * subir a versão = vermelho, e o deploy não roda (deploy-worker.yml roda os
 * testes antes do wrangler). Captura o `createServer` do stdio; o Worker monta
 * o SEU servidor separadamente (`worker/src/server.ts`), e
 * `worker/tests/surface-lock.test.ts` prova que ele serve esta mesma
 * superfície — além de medir quem responde sem token.
 *
 * A superfície depende de AMBIENTE: as 6 tools SNOMED só se registram com
 * `ENABLE_SNOMED_TOOLS=true`, lido na carga do módulo. A trava é a da
 * configuração publicada (flag desligada); rodar esta suíte com a flag ligada
 * mediria outra superfície, então o teste se recusa.
 *
 * Ao mudar a superfície: `npm version <nível> --no-git-tag-version` e
 * `npm run surface:lock`. A trava recusa regravar sob a versão antiga.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { capturarSuperficie, conferirSecao } from '@sbissoli/mcp-surface';
import { describe, expect, it } from 'vitest';

import { createServer } from './register.js';
import { SNOMED_TOOLS_ENABLED } from './utils/feature-flags.js';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const versao = (JSON.parse(readFileSync(`${raiz}package.json`, 'utf8')) as { version: string }).version;

describe('surface.lock.json — superfície declarada', () => {
  it('é medida na configuração publicada (SNOMED desligado)', () => {
    expect(SNOMED_TOOLS_ENABLED, 'rode sem ENABLE_SNOMED_TOOLS=true: a trava é a da configuração publicada').toBe(false);
  });

  it('bate com a trava, ou a versão subiu junto', async () => {
    const v = conferirSecao(`${raiz}surface.lock.json`, 'declarada', await capturarSuperficie(createServer()), versao);
    expect(v.ok, v.mensagem).toBe(true);
  });
});
