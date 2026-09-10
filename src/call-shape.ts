/**
 * A FORMA da chamada, nunca o conteúdo dela.
 *
 * Por que existe. Em 10/09/2026 o painel do portfólio passou a medir erro por
 * chamada e apontou cinco ferramentas quebradas, uma delas aqui:
 * `icd11_hierarchy`, com 42 erros em 58 chamadas. Diagnosticar custou vinte
 * minutos de chamadas manuais porque a telemetria dizia QUE falhou e não DIZIA
 * por quê. No senado, onde o mesmo campo foi ligado primeiro, uma linha
 * respondeu o que a sonda levou meia hora para achar. Atenção a um limite que
 * vale aqui também: erro de validação de esquema NÃO chega a esta camada — o
 * SDK o responde antes do handler, e a chamada não é contada nem como chamada
 * nem como erro.
 *
 * Por que não gravar os argumentos. O dado que este servidor serve é público; a
 * PERGUNTA não é, e aqui menos ainda: uma busca repetida pelo nome de uma
 * doença rara, vinda de uma rede pequena, é quase uma impressão digital de
 * quem perguntou — e o registro já guarda país e organização de rede. Parte dos
 * parâmetros é texto livre (`query`, `term`), onde cabe qualquer coisa que a
 * pessoa digitou. E ligar isso mudaria o que o serviço coleta sem
 * mudar o que a página pública diz que ele coleta.
 *
 * O meio-termo: NOMES de parâmetro (que são o esquema publicado, não dado de
 * ninguém) e a CLASSE do erro (vocabulário fechado, derivado da nossa própria
 * mensagem). Isso separa "chamou sem o parâmetro obrigatório" de "chamou certo
 * com um valor que não existe" — que é a bifurcação do conserto.
 */

/** Vocabulário FECHADO. Nada aqui carrega valor vindo do usuário. */
export type ErrorClass =
  /** Regra de contrato checada no código (o esquema não a expressa): parâmetro que falta, combinação proibida. */
  | "contrato"
  /** A fonte respondeu, e respondeu que não existe: 404, vazio, sem registros. */
  | "nao_encontrado"
  /** A fonte falhou ou demorou: 5xx, timeout, payload grande demais. */
  | "fonte"
  /** Falhou por outro motivo — se esta classe crescer, é sinal de que falta uma classe. */
  | "outro";

/**
 * Classifica pela mensagem de erro, que é NOSSA. A ordem importa: "não
 * encontrado" e "vazio" são mais específicos que "erro da fonte", e um 404
 * casaria com os dois.
 *
 * O vocabulário foi ampliado depois de passar o classificador por TODAS as
 * mensagens de erro do bcb e do senado (a varredura virou a guarda em
 * `call-shape.test.ts`): 13 de 18 aqui e 12 de 18 lá caíam em `outro`, ou
 * seja, a telemetria não responderia nada nestes dois servidores. As famílias
 * que faltavam eram "Informe X ou Y", "só existe para", "desconhecido",
 * "recusada", "não retornou dados" e "não publica" — nenhuma exótica; a versão
 * inicial foi escrita a partir das mensagens do senado que eu já tinha lido.
 */
export function classifyError(message: string): ErrorClass {
  const m = message.toLowerCase();
  // A fronteira de palavra vai só no INÍCIO. Os padrões são RADICAIS
  // ("vazi", "obrigatóri", "indisponív") justamente porque a flexão muda o
  // fim: `\bvazi\b` não casa "vazia", e foi assim que "Resposta upstream
  // vazia" caiu em `fonte` na primeira versão — a palavra que casava era
  // "upstream". Ordem também importa: "não encontrado" é mais específico que
  // "erro da fonte", e a mensagem real do senado tem sinal das duas famílias.
  // "desconhecido" só é sinal de contrato quando qualifica um VALOR que o
  // chamador passou ("Índice de preços desconhecido: X. Aceitos: ..."). O
  // "Erro desconhecido ao consultar o calendário do IBGE" é o oposto — é
  // justamente o caso sem classe — e a primeira versão desta ampliação o
  // classificava como contrato.
  const valorDesconhecido = /\bdesconhecid/.test(m) && !/\berro desconhecid/.test(m);
  if (
    valorDesconhecido ||
    /\b(obrigatóri|obrigatori|exige|requer|required|inválid|invalid|validation error|não aceita|nao aceita|no máximo|no maximo|só existe|so existe|recusad)/.test(
      m,
    )
  ) {
    return "contrato";
  }
  if (
    /\b(não encontrad|nao encontrad|não existe|nao existe|not.?found|inexistent|vazi|empty|sem registros|não retornou dados|nao retornou dados|não publica|nao publica|404)/.test(
      m,
    ) ||
    // "Nenhum evento encontrado", "nenhuma reunião", "nenhum registro": a forma
    // varia com o substantivo de cada servidor, então case pelo padrão.
    /\bnenhum[ao]?s?\b[\s\S]{0,40}\b(encontrad|resultado|registro|dado)/.test(m)
  ) {
    return "nao_encontrado";
  }
  // "Informe X ou Y" é a mensagem canônica de parâmetro que falta — dez delas
  // no senado, com e sem qualificador na frente ("Para por=senador, informe
  // 'codigoSenador'"). Fica DEPOIS de "não encontrado" de propósito: é o sinal
  // mais fraco dos dois, e um "informe um código válido" fechando uma mensagem
  // de não encontrado não pode sequestrar a classe. Hoje nenhuma mensagem dos
  // quatro servidores casa com as duas famílias — a ordem existe para a
  // mensagem que alguém escrever amanhã.
  if (/\binforme\b/.test(m)) return "contrato";
  // `\b5\d\d\b` e não `5\d\d`: sem a fronteira final, qualquer número com um 5
  // seguido de dois dígitos casava — um código de reunião "591234" citado na
  // mensagem virava "erro 5xx". A intenção sempre foi o status HTTP.
  if (
    /\b(timeout|tempo esgotado|indisponív|indisponiv|upstream|\b5\d\d\b|payload|too large|grande demais|limite de tamanho)/.test(
      m,
    )
  ) {
    return "fonte";
  }
  return "outro";
}

/**
 * Nomes dos parâmetros que a chamada trouxe, em ordem, separados por vírgula.
 * Só os nomes de PRIMEIRO nível e só quando o argumento é objeto simples — o
 * conteúdo nunca entra. Cortado em 200 caracteres porque blob do Analytics
 * Engine tem teto de tamanho e um nome de parâmetro longo não vale a linha.
 */
export function paramNames(args: unknown): string {
  const a = Array.isArray(args) ? args[0] : args;
  if (!a || typeof a !== "object" || Array.isArray(a)) return "";
  const nomes = Object.keys(a as Record<string, unknown>)
    .filter((k) => (a as Record<string, unknown>)[k] !== undefined)
    .sort();
  return nomes.join(",").slice(0, 200);
}

/**
 * Texto de erro de um resultado de tool, para classificar. Vazio quando não há.
 *
 * Lê o CAMPO `error` do envelope, não o payload serializado inteiro. O envelope
 * padrão é `{ error, retryable, hint }`, e o `hint` de erro não recuperável
 * termina com "a fonte oficial pode estar indisponível" — texto de formulário,
 * igual em todos. Classificando o payload inteiro, esse "indisponível"
 * arrastava TODO erro não recuperável para a classe `fonte`. Visto na produção
 * do senado em 10/09/2026: a mensagem "Não existe reunião com o código X",
 * que é `nao_encontrado` por definição, foi gravada como `fonte`.
 */
export function errorText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as { content?: Array<{ text?: unknown }>; structuredContent?: { error?: unknown } };
  const estruturado = r.structuredContent?.error;
  if (typeof estruturado === "string") return estruturado;
  const t = Array.isArray(r.content) ? r.content[0]?.text : undefined;
  if (typeof t !== "string") return "";
  try {
    const j = JSON.parse(t) as { error?: unknown };
    if (typeof j.error === "string") return j.error;
  } catch {
    // Não é o envelope JSON — vale o texto cru (é o caso de outros servidores).
  }
  return t;
}
