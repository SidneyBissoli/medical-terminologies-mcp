/**
 * O vocabulário da pergunta contra o da fonte (CID-10, DataSUS V2008).
 *
 * Os casos são os MEDIDOS no dataset embarcado em 2026-09-16 (2.045
 * categorias + 12.451 subcategorias): "câncer", "ataque cardíaco", "AVC",
 * "pressão alta", "dor de cabeça", "suicídio", "atropelamento", "aids",
 * "convulsão", "tabagismo", "maconha", "burnout" e "cachorro" devolviam ZERO,
 * com o código existindo sob a grafia da CID-10. A fixture é o próprio
 * dataset: cada código esperado é conferido por `lookup`, então nada aqui
 * prova uma tabela contra si mesma.
 */

import { describe, it, expect } from 'vitest';
import { getCID10Client } from './cid10-client.js';
import { askedWordsFor, expandQuery, normalize, vocabularyNotes } from './cid10-vocabulary.js';

const client = getCID10Client();
const codes = (q: string) => client.search(q, 'all', 500).hits.map((h) => h.display);
const patterns = (q: string) => expandQuery(q).map((e) => e.patterns);

describe('os códigos esperados existem no dataset', () => {
  it.each(['C50', 'I21', 'I64', 'I10', 'R51', 'X70', 'V01', 'N20', 'B20', 'R56', 'F17', 'F12', 'F14', 'Z73.0', 'E66', 'N48.4', 'M54.5', 'E54', 'W54', 'B01', 'B26'])(
    '%s',
    (code) => {
      expect(client.lookup(code), `código ausente do dataset: ${code}`).not.toBeNull();
    },
  );
});

describe('expansão de termo', () => {
  it('sinônimo medido: câncer → neoplasia maligna', () => {
    expect(patterns('câncer')[0]).toContain('neoplasia maligna');
  });

  it('frase da tabela vira UM termo: "pressão alta" não morre no "alta"', () => {
    const e = expandQuery('pressão alta');
    expect(e).toHaveLength(1);
    expect(e[0].patterns).toContain('hipertens');
  });

  it('o próprio termo vem primeiro — expandir nunca perde o que já casava', () => {
    expect(patterns('infarto')[0][0]).toBe('infarto');
  });

  it('stopword não entra no AND: "infarto do miocárdio" → infarto, miocardio', () => {
    expect(expandQuery('infarto do miocárdio').map((e) => e.term)).toEqual(['infarto', 'miocardio']);
  });

  it('plural do português: convulsões → convulsao → convuls', () => {
    expect(patterns('convulsões')[0]).toContain('convuls');
  });

  it('normaliza acento e caixa', () => {
    expect(normalize('Hipertensão Essencial')).toBe('hipertensao essencial');
  });
});

describe('busca com o vocabulário do usuário', () => {
  it('câncer acha neoplasia maligna; câncer de mama acha C50', () => {
    expect(client.search('câncer', 'all', 5).totalCount).toBeGreaterThan(400);
    expect(codes('câncer de mama')).toContain('C50');
  });

  it('ataque cardíaco acha infarto agudo do miocárdio', () => {
    expect(codes('ataque cardíaco')).toContain('I21');
  });

  it('AVC acha acidente vascular cerebral', () => {
    expect(codes('avc')).toContain('I64');
  });

  it('pressão alta acha hipertensão essencial', () => {
    expect(codes('pressão alta')).toContain('I10');
  });

  it('dor de cabeça acha cefaleia', () => {
    expect(codes('dor de cabeça')).toContain('R51');
  });

  it('suicídio acha lesão autoprovocada', () => {
    expect(codes('suicídio enforcamento')).toContain('X70');
  });

  it('atropelamento acha pedestre traumatizado', () => {
    expect(codes('atropelamento')).toContain('V01');
  });

  it('pedra nos rins e cálculo renal acham calculose do rim', () => {
    expect(codes('pedra nos rins')).toContain('N20');
    expect(codes('cálculo renal')).toContain('N20');
  });

  it('aids acha doença pelo HIV', () => {
    expect(codes('aids micobacterianas')).toContain('B20.0');
  });

  it('convulsão acha convulsões', () => {
    expect(codes('convulsão')).toContain('R56');
  });

  it('tabagismo, maconha e crack acham fumo, canabinóides e cocaína', () => {
    expect(codes('tabagismo')).toContain('F17');
    expect(codes('maconha')).toContain('F12');
    expect(codes('crack')).toContain('F14');
  });

  it('burnout acha esgotamento; obeso acha obesidade', () => {
    expect(codes('burnout')).toContain('Z73.0');
    expect(codes('obeso')).toContain('E66');
  });

  it('disfunção erétil, dor nas costas, escorbuto e cachorro', () => {
    expect(codes('disfunção erétil')).toContain('N48.4');
    expect(codes('dor nas costas')).toContain('M54.5');
    expect(codes('escorbuto')).toContain('E54');
    expect(codes('cachorro mordedura')).toContain('W54');
  });

  it('o que já funcionava continua funcionando: a frase inteira ainda casa', () => {
    expect(codes('infarto agudo do miocárdio')).toContain('I21');
    expect(codes('varicela')).toContain('B01');
    expect(codes('caxumba')).toContain('B26');
  });

  it('termo sem correspondência nenhuma segue devolvendo zero — expandir não inventa código', () => {
    expect(client.search('covid', 'all', 5).totalCount).toBe(0);
    expect(client.search('zika', 'all', 5).totalCount).toBe(0);
    expect(client.search('criptomoeda', 'all', 5).totalCount).toBe(0);
  });
});

describe('a tradução é dita, não é silenciosa', () => {
  it('a nota nomeia o termo e a grafia da CID-10', () => {
    const { notes } = client.search('câncer', 'all', 5);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('"cancer"');
    expect(notes[0]).toContain('neoplasia maligna');
  });

  it('termo que já é o da CID-10 não gera nota, nem o mero plural', () => {
    expect(client.search('infarto', 'all', 5).notes).toEqual([]);
    expect(vocabularyNotes(expandQuery('fraturas'))).toEqual([]);
  });
});

describe('a ponta inversa, para o índice de search (Deep Research)', () => {
  it('um código de neoplasia maligna é encontrável por câncer', () => {
    expect(askedWordsFor('Neoplasia maligna da mama')).toContain('cancer');
  });

  it('um código de hipertensão é encontrável por pressão alta', () => {
    expect(askedWordsFor('Hipertensão essencial (primária)')).toContain('pressao alta');
  });

  it('título sem palavra da tabela não ganha keyword', () => {
    expect(askedWordsFor('Cólera devida a Vibrio cholerae 01, biótipo cholerae')).toEqual([]);
  });
});
