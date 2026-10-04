/**
 * Toda contagem de ferramentas escrita em texto para HUMANO bate com a
 * superfície real do servidor — e o texto em português, quando existir, cita as
 * mesmas ferramentas que o texto em inglês.
 *
 * POR QUE ESTE ARQUIVO EXISTE. O `server.json` disse **37** seco até
 * 2026-08-31, quando a superfície padrão era de 31 — é o arquivo de maior
 * alcance do repositório (o que o MCP Registry publica e os diretórios
 * copiam). Nada quebrou e nenhum teste reprovou, porque contagem em prosa não
 * tem quem a confira. A mesma classe apareceu no portfólio inteiro no mesmo dia
 * (a landing do ibge dizia 22 com 21; o README traduzido do bcb dizia 8 com 15).
 *
 * Até a 1.18.x havia DUAS superfícies (padrão e com SNOMED) e este teste
 * conferia as duas. Com o SNOMED aposentado na 2.0.0 há uma só, derivada do
 * registro real ([[verificacao-deriva-da-fonte]]). Contagens por terminologia
 * ("5 tools" do ICD-11) não são conferidas aqui.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { toolRegistry } from './server-core.js';
import './register.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leia = (f: string) => readFileSync(join(raiz, f), 'utf8');
const existe = (f: string) => existsSync(join(raiz, f));

const PT = 'LEIA-ME.md';
const nomes = toolRegistry.getTools().map((t) => t.name);
const total = nomes.length;

/** A primeira contagem "N tools" do texto, ou falha dizendo onde faltou. */
function contagem(texto: string, arquivo: string, padrao = /(\d+)\s+tools/i): number {
  const m = texto.match(padrao);
  expect(m, `${arquivo} não diz quantas tools o servidor tem`).not.toBeNull();
  return Number(m![1]);
}

describe('contagem de ferramentas nos textos públicos', () => {
  it('o registro real tem ferramentas e nenhuma SNOMED (aposentado na 2.0.0)', () => {
    expect(total).toBeGreaterThan(0);
    expect(nomes.filter((n) => /snomed/i.test(n)), 'tool SNOMED de volta ao registro').toEqual([]);
  });

  it('a descrição do server.json anuncia a superfície real', () => {
    const { description } = JSON.parse(leia('server.json')) as { description: string };
    expect(contagem(description, 'server.json')).toBe(total);
  });

  it('o package.json anuncia a superfície real', () => {
    const { description } = JSON.parse(leia('package.json')) as { description: string };
    expect(contagem(description, 'package.json')).toBe(total);
  });

  it('a landing do Worker anuncia a superfície real', () => {
    // `worker/src/config.ts` é o texto da página inicial do endpoint hospedado.
    expect(contagem(leia('worker/src/config.ts'), 'worker/src/config.ts')).toBe(total);
  });

  it('o título "Available Tools (N)" do README e o do LEIA-ME batem com o registro', () => {
    expect(contagem(leia('README.md'), 'README.md', /## Available Tools \((\d+)\)/)).toBe(total);
    expect(contagem(leia(PT), PT, /## Ferramentas disponíveis \((\d+)\)/)).toBe(total);
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
