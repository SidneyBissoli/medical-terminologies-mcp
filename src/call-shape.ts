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
 */
export function classifyError(message: string): ErrorClass {
  const m = message.toLowerCase();
  // A fronteira de palavra vai só no INÍCIO. Os padrões são RADICAIS
  // ("vazi", "obrigatóri", "indisponív") justamente porque a flexão muda o
  // fim: `\bvazi\b` não casa "vazia", e foi assim que "Resposta upstream
  // vazia" caiu em `fonte` na primeira versão — a palavra que casava era
  // "upstream". Ordem também importa: "não encontrado" é mais específico que
  // "erro da fonte", e a mensagem real do senado tem sinal das duas famílias.
  if (/\b(obrigatóri|obrigatori|exige|requer|required|inválid|invalid|não aceita|nao aceita|no máximo|no maximo)/.test(m)) {
    return "contrato";
  }
  if (/\b(não encontrad|nao encontrad|not.?found|inexistent|vazi|empty|sem registros|nenhum resultado|404)/.test(m)) {
    return "nao_encontrado";
  }
  if (/\b(timeout|tempo esgotado|indisponív|indisponiv|upstream|5\d\d|payload|too large|grande demais|limite de tamanho)/.test(m)) {
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

/** Texto de erro de um resultado de tool, para classificar. Vazio quando não há. */
export function errorText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as { content?: Array<{ text?: unknown }> };
  const t = Array.isArray(r.content) ? r.content[0]?.text : undefined;
  return typeof t === "string" ? t : "";
}
