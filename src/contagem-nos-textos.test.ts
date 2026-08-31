/**
 * Toda contagem de ferramentas escrita em texto para HUMANO bate com a
 * superfície real do servidor — e o texto em português, quando existir, cita as
 * mesmas ferramentas que o texto em inglês.
 *
 * POR QUE ESTE ARQUIVO EXISTE. A superfície padrão deste servidor é de 31
 * tools; 37 só com `ENABLE_SNOMED_TOOLS=true`. O `README.md` e o `package.json`
 * dizem as duas coisas, e certo. O `server.json` dizia **37** seco, sem a
 * ressalva — e ficou assim até 2026-08-31. É o arquivo de maior alcance do
 * repositório: é o que o MCP Registry publica e o que os diretórios copiam.
 * Nada quebrou e nenhum teste reprovou, porque contagem em prosa não tem quem
 * a confira.
 *
 * A mesma classe apareceu no portfólio inteiro no mesmo dia (a landing do ibge
 * dizia 22 com 21; o README traduzido do bcb dizia 8 com 15 e listava 9).
 *
 * O teste NÃO pode ser "todo número igual ao total": aqui há três contagens
 * legítimas e diferentes — a padrão, a com SNOMED, e as por terminologia
 * ("5 tools" do ICD-11). Cada uma é conferida contra a sua própria fonte, e as
 * duas primeiras são derivadas do registro real, montado duas vezes com a flag
 * nos dois estados ([[verificacao-deriva-da-fonte]]).
 */

import { describe, expect, it, beforeAll, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { toolRegistry } from './server-core.js';
import './register.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leia = (f: string) => readFileSync(join(raiz, f), 'utf8');
const existe = (f: string) => existsSync(join(raiz, f));

const PT = 'README.pt-BR.md';
const nomes = toolRegistry.getTools().map((t) => t.name);
const padrao = nomes.length;

/** Superfície com a flag ligada — montada num grafo de módulos limpo. */
let comSnomed = 0;

beforeAll(async () => {
  const anterior = process.env.ENABLE_SNOMED_TOOLS;
  process.env.ENABLE_SNOMED_TOOLS = 'true';
  vi.resetModules();
  try {
    const core = (await import('./server-core.js')) as typeof import('./server-core.js');
    await import('./register.js');
    comSnomed = core.toolRegistry.getTools().length;
  } finally {
    if (anterior === undefined) delete process.env.ENABLE_SNOMED_TOOLS;
    else process.env.ENABLE_SNOMED_TOOLS = anterior;
    vi.resetModules();
  }
});

describe('contagem de ferramentas nos textos públicos', () => {
  it('o registro real é a fonte das duas contagens', () => {
    expect(padrao).toBeGreaterThan(0);
    expect(comSnomed, 'a flag ENABLE_SNOMED_TOOLS não acrescentou tool nenhuma').toBeGreaterThan(
      padrao
    );
  });

  it('a descrição do server.json anuncia a superfície PADRÃO', () => {
    // É o arquivo que o MCP Registry publica: o número aqui é o que o usuário
    // vê antes de instalar, e o que ele instala é o padrão, sem a flag.
    const { description } = JSON.parse(leia('server.json')) as { description: string };
    const m = description.match(/(\d+)\s+tools/i);
    expect(m, 'server.json não diz quantas tools o servidor tem').not.toBeNull();
    expect(
      Number(m![1]),
      `server.json anuncia "${m![0]}"; a superfície padrão tem ${padrao} (${comSnomed} com SNOMED)`
    ).toBe(padrao);
  });

  it('o package.json anuncia as duas superfícies, e as duas certas', () => {
    const { description } = JSON.parse(leia('package.json')) as { description: string };
    const m = description.match(/(\d+)\s+tools by default\s*\((\d+)\s+with SNOMED/i);
    expect(m, 'package.json não declara "N tools by default (M with SNOMED…)"').not.toBeNull();
    expect(Number(m![1]), 'contagem padrão no package.json').toBe(padrao);
    expect(Number(m![2]), 'contagem com SNOMED no package.json').toBe(comSnomed);
  });

  it('o README explica a diferença entre as duas com os números certos', () => {
    const m = leia('README.md').match(/registers\s+(\d+)\s+tools\s+instead of\s+(\d+)/i);
    expect(m, 'README.md não explica a superfície gated').not.toBeNull();
    expect(Number(m![1]), 'contagem padrão no README').toBe(padrao);
    expect(Number(m![2]), 'contagem com SNOMED no README').toBe(comSnomed);
  });
});

describe('paridade entre o README em inglês e o em português', () => {
  it('o README em português existe', () => {
    expect(existe(PT), `${PT} ausente — metade da superfície em pt`).toBe(true);
  });

  it('cita exatamente as mesmas ferramentas que o README em inglês', () => {
    // Os nomes vêm do REGISTRO, não de um prefixo: aqui eles são heterogêneos
    // (icd11_*, loinc_*, map_*, validate_codes…) e um regex de prefixo deixaria
    // famílias inteiras de fora sem avisar.
    const citadas = (f: string) => {
      const texto = leia(f);
      return nomes.filter((n) => texto.includes(`\`${n}\``)).sort();
    };
    const en = citadas('README.md');
    const pt = existe(PT) ? citadas(PT) : [];
    expect(
      en.filter((n) => !pt.includes(n)),
      'ferramentas no README em inglês e ausentes do português'
    ).toEqual([]);
  });

  it('tem o mesmo esqueleto de seções', () => {
    const secoes = (f: string) => (leia(f).match(/^#{2,3} /gm) ?? []).length;
    expect(existe(PT) ? secoes(PT) : 0, 'número de seções divergente entre os dois READMEs').toBe(
      secoes('README.md')
    );
  });
});
