/**
 * Esquema de entrada de `icd11_hierarchy`, depois de 13/09/2026.
 *
 * O que está sendo pinado: a tool passou a aceitar `uri` (e `language`)
 * porque a própria resposta de `parents` devolve blocos com `code` vazio e só
 * `uri`/`code_range` — sem `uri` não havia como seguir navegando a partir do
 * que a tool acabou de entregar. O esquema continua estrito: chave
 * desconhecida é recusada, e é obrigatório nomear a entidade por `code` OU
 * `uri`.
 */

import { describe, it, expect } from 'vitest';
import { ICD11HierarchyParamsSchema } from './index.js';

describe('ICD11HierarchyParamsSchema', () => {
  it('aceita código de folha', () => {
    const p = ICD11HierarchyParamsSchema.parse({ code: '5A11', direction: 'parents' });
    expect(p.code).toBe('5A11');
    expect(p.language).toBe('en');
  });

  it('aceita intervalo de bloco como código', () => {
    expect(() =>
      ICD11HierarchyParamsSchema.parse({ code: '5A10-5A2Y', direction: 'children' }),
    ).not.toThrow();
  });

  it('aceita uri no lugar do código', () => {
    const p = ICD11HierarchyParamsSchema.parse({
      uri: 'http://id.who.int/icd/release/11/2026-01/mms/465177735',
      direction: 'children',
    });
    expect(p.uri).toContain('465177735');
    expect(p.code).toBeUndefined();
  });

  it('recusa quando nem código nem uri vêm', () => {
    // o zod serializa as issues em JSON, com as aspas da mensagem escapadas
    expect(() => ICD11HierarchyParamsSchema.parse({ direction: 'parents' })).toThrow(
      /Either .{1,3}code.{1,3} or .{1,3}uri.{1,3} must be provided/,
    );
  });

  it('recusa uri que não é URL', () => {
    expect(() =>
      ICD11HierarchyParamsSchema.parse({ uri: 'nao-e-url', direction: 'parents' }),
    ).toThrow();
  });

  it('continua recusando parâmetro que não existe', () => {
    expect(() =>
      ICD11HierarchyParamsSchema.parse({ code: '5A11', direction: 'parents', codigo: 'x' }),
    ).toThrow();
  });

  it('aceita language oficial e recusa idioma fora da lista', () => {
    expect(
      ICD11HierarchyParamsSchema.parse({ code: '5A11', direction: 'parents', language: 'pt' }).language,
    ).toBe('pt');
    expect(() =>
      ICD11HierarchyParamsSchema.parse({ code: '5A11', direction: 'parents', language: 'xx' }),
    ).toThrow();
  });
});
