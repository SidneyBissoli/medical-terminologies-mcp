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
 * A MECÂNICA (frases da tabela antes da quebra em palavras, stopwords do
 * pt-BR fora do AND, singular sem caco, OR das grafias da CID-10, a nota dita
 * e a ponta inversa para o índice de `search`) mora em `@sbissoli/mcp-search`
 * desde a 0.5.0 — cinco servidores a carregavam em cópia; aqui fica só a
 * tabela. Os nomes exportados são os de sempre, para quem chama não mudar.
 */

import { createVocabulary, type ExpandedTerm, type VocabularyEntry } from '@sbissoli/mcp-search';

export type { ExpandedTerm, VocabularyEntry };

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

const vocabulary = createVocabulary({ entries: VOCABULARY, locale: 'pt-BR', sourceName: 'a CID-10' });

/** Sem acento, caixa baixa, espaços colapsados — o mesmo `deburr` do cliente. */
export const normalize = vocabulary.normalize;
/** A consulta inteira, termo a termo (frases da tabela viram UM termo antes da quebra). */
export const expandQuery = vocabulary.expandQuery;
/** A frase que conta ao chamador que a palavra dele não é a da CID-10. */
export const vocabularyNotes = vocabulary.vocabularyNotes;
/** Um título (já normalizado) casa TODOS os termos expandidos? */
export const matchesQuery = vocabulary.matchesQuery;
/** A ponta inversa: as palavras com que se PERGUNTA por este título — keywords do índice de `search`. */
export const askedWordsFor = vocabulary.askedWordsFor;
