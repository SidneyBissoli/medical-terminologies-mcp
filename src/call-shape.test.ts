import { describe, it, expect } from 'vitest';
import { classifyError, classifyThrown } from './call-shape.js';
import { codigoIcd11NaoEncontrado } from './clients/who-client.js';

/**
 * `classifyThrown` nomeia a exceção que ESCAPOU do handler.
 *
 * Em 22/09/2026 o `ibge_cnae` respondia `Cannot read properties of undefined
 * (reading 'divisao')` — um `TypeError` — e nenhum padrão de `classifyError`
 * casava com essa frase: ia para `outro`, que já era 13 dos 23 erros da
 * ferramenta. O sinal é o TIPO do erro, não a frase, porque o texto do motor de
 * JS muda entre versões de Node.
 *
 * A guarda PROVA a diferença em vez de afirmá-la: a mesma mensagem que
 * `classifyError` só sabe chamar de `outro`, `classifyThrown` chama de
 * `defeito`, porque tem o objeto do erro em mãos.
 *
 * As mensagens do repasse saem da FONTE (`codigoIcd11NaoEncontrado`) ou são as
 * que os clientes realmente lançam, para a guarda não fossilizar um literal.
 */
describe('classifyThrown nomeia a exceção que escapou do handler', () => {
  it('TypeError vira `defeito`, e não o `outro` anônimo', () => {
    const erro = new TypeError("Cannot read properties of undefined (reading 'divisao')");
    expect(classifyError(erro.message)).toBe('outro');
    expect(classifyThrown(erro)).toBe('defeito');
  });

  it('as outras exceções de runtime também', () => {
    expect(classifyThrown(new RangeError('Invalid array length'))).toBe('defeito');
    expect(classifyThrown(new ReferenceError('x is not defined'))).toBe('defeito');
    expect(classifyThrown(new SyntaxError('Unexpected token'))).toBe('defeito');
  });

  it('erro que NÓS escrevemos continua classificado pela mensagem', () => {
    expect(classifyThrown(new Error(codigoIcd11NaoEncontrado('ZZZZ')))).toBe('nao_encontrado');
    expect(classifyThrown(new Error('Resource not found: /mms/codeinfo/E11'))).toBe(
      'nao_encontrado',
    );
    expect(classifyThrown(new Error('HTTP 503: Service Unavailable'))).toBe('fonte');
  });

  it('lida com o que foi lançado sem ser Error', () => {
    expect(classifyThrown('Resource not found')).toBe('nao_encontrado');
    expect(classifyThrown(undefined)).toBe('outro');
  });
});
