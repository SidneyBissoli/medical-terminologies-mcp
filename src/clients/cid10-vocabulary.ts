/**
 * O vocabulário da PERGUNTA contra o vocabulário da FONTE (CID-10, DataSUS V2008).
 *
 * `cid10_search` casava o que o usuário escreveu contra o TÍTULO do código por
 * substring contígua (sem acento, sem caixa — isso já estava certo). Quem
 * pergunta com a palavra de todo dia não recebia um resultado ruim: recebia
 * ZERO, sem dizer por quê. Medido nas 2.045 categorias + 12.451 subcategorias
 * do dataset embarcado (título + título curto, sem acento) em 2026-09-16:
 *
 *   perguntado            n     a CID-10 escreve                         n
 *   câncer                0     neoplasia maligna / carcinoma       439 / 58
 *   ataque cardíaco       0     infarto                                 42
 *   AVC                   0     acidente vascular cerebral / derrame  4 / 7
 *   pressão alta          0     hipertensão                             44
 *   dor de cabeça         0     cefaleia                                10
 *   suicídio              0     lesão autoprovocada                    167
 *   atropelamento         0     pedestre traumatizado                   97
 *   pedra nos rins        0     calculose / litíase                  16 / 3
 *   cálculo renal         0     calculose do rim                        16
 *   aids                  0     doença pelo HIV                         40
 *   convulsão             0     convulsões / convulsiva                 41
 *   hemofilia             0     hemofílica                               1
 *   tabagismo             0     uso de fumo / tabaco / nicotina   14 / 3 / 1
 *   maconha               0     canabinóides / cannabis             11 / 1
 *   crack                 0     cocaína                                 13
 *   burnout               0     esgotamento                              1
 *   overdose              0     intoxicação / envenenamento       506 / 209
 *   obeso                 0     obesidade                                6
 *   disfunção erétil      0     impotência                               1
 *   lombalgia             0     dor lombar / dorsalgia                1 / 3
 *   dor nas costas        0     dor lombar / dorsalgia                1 / 3
 *   hérnia de disco       0     disco intervertebral                     7
 *   escorbuto             0     deficiência de ácido ascórbico           2
 *   cachorro              0     provocado por cão                       11
 *   colesterol alto       0     hipercolesterolemia                      1
 *   diabetes tipo 2       0     diabetes mellitus não-insulino-dependente 9
 *
 * "câncer" é o caso mais caro: a palavra que todo mundo usa devolvia zero no
 * dataset inteiro, e "câncer de mama" idem — a CID-10 diz "neoplasia maligna
 * da mama". Também por isso a busca deixa de ser frase contígua: cada palavra
 * casa em AND, e a frase "neoplasia maligna da mama" continua casando.
 *
 * Regra desta tabela: só entra par MEDIDO — a palavra perguntada ausente do
 * dataset e a palavra da fonte presente. Nada de sinônimo plausível sem
 * contagem; termo que a V2008 não tem fica de fora, porque inventar apelido
 * para código inexistente é prometer o que a fonte não tem. Medido e deixado
 * de fora em 2026-09-16: covid (0 — U07.1 é de 2020, a V2008 não o traz),
 * zika (0), TPM (0), LER/DORT (0 como sigla; "LER" casa 109 por substring de
 * "esclerose" etc.), magreza (0 — desnutrição é outra coisa).
 *
 * Vale para os dois caminhos de busca, pelas duas pontas da mesma tabela:
 * `cid10_search` expande o TERMO (OR dentro do termo, AND entre termos —
 * expandir só aumenta o recall, nunca perde casamento que já havia) e o índice
 * de `search` (Deep Research) recebe a palavra perguntada como KEYWORD do
 * código cujo título traz a palavra da fonte.
 *
 * Mesma receita de `src/ilostat/vocabulary.ts` (ilo 0.6.0), `src/uis/vocabulary.ts`
 * (uis 0.3.0) e `src/vocabulario.ts` (ibge 5.1.0).
 */

export interface VocabularyEntry {
  /** Como o usuário escreve — normalizado (sem acento, minúsculo); pode ser frase. */
  readonly asked: string;
  /** Como a CID-10 escreve — substrings normalizadas, podendo ser frase. */
  readonly source: readonly string[];
}

export const VOCABULARY: readonly VocabularyEntry[] = [
  { asked: 'cancer', source: ['neoplasia maligna', 'carcinoma'] },
  { asked: 'canceres', source: ['neoplasia maligna', 'carcinoma'] },
  { asked: 'ataque cardiaco', source: ['infarto'] },
  { asked: 'avc', source: ['acidente vascular', 'derrame'] },
  { asked: 'pressao alta', source: ['hipertens'] },
  { asked: 'dor de cabeca', source: ['cefaleia'] },
  { asked: 'suicidio', source: ['autoprovocada'] },
  { asked: 'atropelamento', source: ['pedestre'] },
  { asked: 'atropelado', source: ['pedestre'] },
  { asked: 'pedra nos rins', source: ['calculose', 'litiase'] },
  { asked: 'pedra no rim', source: ['calculose', 'litiase'] },
  { asked: 'calculo renal', source: ['calculose do rim', 'calculose', 'litiase'] },
  { asked: 'aids', source: ['hiv'] },
  { asked: 'convulsao', source: ['convuls'] },
  { asked: 'hemofilia', source: ['hemofil'] },
  { asked: 'tabagismo', source: ['fumo', 'tabaco', 'nicotina'] },
  { asked: 'maconha', source: ['canabinoide', 'cannabis'] },
  { asked: 'crack', source: ['cocaina'] },
  { asked: 'burnout', source: ['esgotamento'] },
  { asked: 'overdose', source: ['intoxicacao', 'envenenamento'] },
  { asked: 'obeso', source: ['obesidade'] },
  { asked: 'obesa', source: ['obesidade'] },
  { asked: 'disfuncao eretil', source: ['impotencia'] },
  { asked: 'lombalgia', source: ['dor lombar', 'dorsalgia'] },
  { asked: 'dor nas costas', source: ['dor lombar', 'dorsalgia'] },
  { asked: 'hernia de disco', source: ['disco intervertebral'] },
  { asked: 'escorbuto', source: ['ascorbic'] },
  { asked: 'cachorro', source: ['por cao'] },
  { asked: 'colesterol alto', source: ['hipercolesterolemia', 'colesterol'] },
  { asked: 'tipo 2', source: ['tipo 2', 'nao-insulino-dependente'] },
  { asked: 'tipo 1', source: ['tipo 1', 'insulino-dependente'] },
];

const BY_ASKED: ReadonlyMap<string, readonly string[]> = new Map(VOCABULARY.map((e) => [e.asked, e.source]));

/** As frases da tabela (com espaço), da mais longa para a mais curta — casam antes da quebra em palavras. */
const PHRASES: readonly string[] = VOCABULARY.map((e) => e.asked)
  .filter((a) => a.includes(' '))
  .sort((a, b) => b.length - a.length);

/**
 * Palavras que não carregam significado num título da CID-10 e, em AND,
 * excluem resultado certo ("infarto do miocárdio" não pode morrer no "do").
 * Só saem quando sobra algum termo.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'ao', 'aos', 'por', 'para', 'com', 'sem', 'que', 'ou',
]);

/** Sem acento, caixa baixa, espaços colapsados — o mesmo `deburr` do cliente. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Forma singular de um termo já normalizado — a substring mais curta casa o
 * plural também. Só as regras do português que não fabricam caco.
 */
function singulars(term: string): string[] {
  if (term.length > 4 && (term.endsWith('oes') || term.endsWith('aes'))) return [`${term.slice(0, -3)}ao`];
  if (term.length > 4 && /(ais|eis|ois)$/.test(term)) return [`${term.slice(0, -2)}l`];
  if (term.length > 3 && term.endsWith('s') && !term.endsWith('ss')) return [term.slice(0, -1)];
  return [];
}

export interface ExpandedTerm {
  readonly term: string;
  readonly patterns: readonly string[];
  /** A tabela (não a mera flexão de plural) mudou o que se procura. */
  readonly translated: boolean;
}

function expandOne(term: string): ExpandedTerm {
  const patterns = [
    term,
    ...(BY_ASKED.get(term) ?? []),
    ...singulars(term).flatMap((s) => [s, ...(BY_ASKED.get(s) ?? [])]),
  ];
  const translated = BY_ASKED.has(term) || singulars(term).some((s) => BY_ASKED.has(s));
  return { term, patterns: [...new Set(patterns)], translated };
}

/**
 * A consulta inteira, termo a termo. Uma frase da tabela ("pressão alta",
 * "dor de cabeça") vira UM termo antes da quebra em palavras — senão "alta"
 * e "cabeca" entrariam no AND e matariam o resultado. O que sobra é
 * quebrado em palavras, sem stopword, cada uma expandida.
 */
export function expandQuery(query: string): ExpandedTerm[] {
  let rest = ` ${normalize(query)} `;
  const out: ExpandedTerm[] = [];
  for (const phrase of PHRASES) {
    const needle = ` ${phrase} `;
    if (rest.includes(needle)) {
      out.push(expandOne(phrase));
      rest = rest.replace(needle, ' ');
    }
  }
  const words = rest.split(' ').filter(Boolean);
  const kept = words.filter((w) => !STOPWORDS.has(w));
  for (const w of kept.length || out.length ? kept : words) out.push(expandOne(w));
  return out;
}

/**
 * A frase que conta ao chamador que a palavra dele não é a da CID-10 — sem
 * isto a tradução é invisível e o resultado parece vir do que ele escreveu.
 */
export function vocabularyNotes(expanded: readonly ExpandedTerm[]): string[] {
  return expanded
    .filter((e) => e.translated)
    .map((e) => {
      const others = e.patterns.filter((p) => p !== e.term);
      return `"${e.term}" também foi buscado como ${others.join(', ')} — a palavra que a CID-10 usa.`;
    });
}

/** Um título (já normalizado) casa TODOS os termos expandidos? */
export function matchesQuery(normalizedTitle: string, expanded: readonly ExpandedTerm[]): boolean {
  return expanded.every((e) => e.patterns.some((p) => normalizedTitle.includes(p)));
}

/**
 * A ponta inversa da tabela: as palavras com que se PERGUNTA por este título —
 * keywords do índice de `search`, que ranqueia por relevância em vez de casar
 * substring.
 */
export function askedWordsFor(title: string): string[] {
  const n = normalize(title);
  const out = VOCABULARY.filter((e) => e.source.some((s) => n.includes(s))).map((e) => e.asked);
  return [...new Set(out)];
}
