# CID-10, CID-11 e o que muda para quem trabalha com dados do SUS

*Publicado em 31 de agosto de 2026. As contagens deste texto foram extraídas dos
conjuntos oficiais que acompanham o servidor — a CID-10 V2008 publicada pelo
DataSUS e as tabelas de transição da OMS, release 2025-01 — e podem ser
reproduzidas por qualquer pessoa a partir das fontes citadas.*

Quem trabalha com dado de saúde no Brasil convive com duas classificações ao
mesmo tempo, e elas não são versões uma da outra no sentido em que se costuma
pensar. Este texto é sobre o que separa as duas, o que existe de oficial para
ligá-las, e onde estão os erros mais comuns de quem faz essa ponte na mão.

## O que é a CID-10 que o SUS usa

O SUS opera sobre a **CID-10, versão V2008**, traduzida para o português pelo
Centro Brasileiro de Classificação de Doenças (CBCD, da Faculdade de Saúde
Pública da USP) e publicada eletronicamente pelo DataSUS. É o que preenche o
campo de diagnóstico da AIH, do SIA, da declaração de óbito, do SINAN. Não é uma
tradução informal: é o padrão operacional.

A estrutura tem quatro níveis, e as contagens exatas do arquivo V2008 são estas:

| Nível | Quantidade | Exemplo |
|---|---|---|
| Capítulos | **22** | `Capítulo I — Algumas doenças infecciosas e parasitárias` (A00–B99) |
| Grupos | **275** | `A00–A09 — Doenças infecciosas intestinais` |
| Categorias (3 caracteres) | **2.045** | `A00 — Cólera` |
| Subcategorias (4 caracteres) | **12.451** | `A00.0 — Cólera devida a Vibrio cholerae 01, biótipo cholerae` |

*Fonte: DataSUS / CBCD, CID-10 V2008,
http://www2.datasus.gov.br/cid10/V2008/ — contagens extraídas do conjunto
embutido em `medical-terminologies-mcp`.*

Três detalhes desse arquivo derrubam quem cruza bases:

**1. O código tem duas grafias.** A subcategoria aparece como `A000` na chave e
como `A00.0` na exibição. Bases diferentes escolhem grafias diferentes, e um
`JOIN` ingênuo entre elas casa zero linhas sem reclamar. Normalize antes.

**2. Nem todo código é usável em qualquer contexto.** O arquivo traz marcadores
de restrição por sexo e de causa de óbito. Um código restrito a um sexo que
aparece com o outro é erro de digitação na origem, não achado epidemiológico —
mas só aparece se alguém for olhar o marcador.

**3. Categoria não é subcategoria.** `I21` (infarto agudo do miocárdio) e
`I21.0` não são o mesmo grão. Contar as duas na mesma tabela dupla-conta. É o
erro mais comum em contagem de morbidade a partir de dado bruto.

## O que é a CID-11, e por que ela ainda não substituiu nada aqui

A **CID-11** é a revisão vigente da OMS. Ela não é uma CID-10 renumerada: mudou
o número de capítulos, criou capítulos novos (medicina tradicional, saúde
sexual), introduziu **pós-coordenação** — a possibilidade de compor um código
principal com eixos adicionais (gravidade, lateralidade, agente etiológico) —, e
sua identidade canônica não é o código alfanumérico, e sim uma **URI**.

Enquanto isso, os sistemas de informação do SUS seguem em CID-10 V2008. Na
prática, quem trabalha com dado brasileiro precisa dos dois: a CID-10 para
operar, a CID-11 para comparar internacionalmente e para acompanhar a literatura
recente.

## As tabelas de transição: o que elas são, e o que não são

A OMS publica, dentro de cada release da CID-11, tabelas de correspondência
entre as duas revisões. Na release **2025-01** (publicada em 24/01/2025), o
conteúdo é este:

- **11.243** entradas de CID-10 mapeadas;
- **1.461** delas trazem alternativas documentadas pela própria OMS, além do
  código principal;
- nenhuma entrada fica sem código principal.

Um exemplo, o diabetes tipo 2:

```
CID-10  E11   Type 2 diabetes mellitus     (capítulo IV)
CID-11  5A11  Type 2 diabetes mellitus     (capítulo 05)
        URI: http://id.who.int/icd/entity/119724091
```

*Fonte: OMS, tabelas de transição da release 2025-01,
https://icdcdn.who.int/static/releasefiles/2025-01/mapping.zip*

E aqui vem a parte que costuma ser ignorada. A orientação da própria OMS sobre
essas tabelas é explícita: elas mostram a correspondência entre as revisões e
**"não se destinam a converter dados diretamente de uma revisão para a outra"**.

Isso não é formalidade jurídica. As 1.461 entradas com alternativas são
exatamente os casos em que a correspondência não é de um para um: uma categoria
da CID-10 que se desdobrou, ou que foi absorvida por um agrupamento diferente.
Rodar a tabela como se fosse um dicionário de tradução, sobre uma base de
milhões de registros, produz uma série histórica que parece contínua e não é.
O uso legítimo é outro: **consultar caso a caso, com a alternativa à vista, para
decidir com critério clínico ou epidemiológico**.

## Uma nota sobre tradução

Nenhum dos textos acima é traduzido por máquina, e isso é uma escolha
deliberada de quem serve terminologia.

- A CID-10 em português é a **tradução oficial** do CBCD. Não há por que
  traduzir o que já foi traduzido por quem tem autoridade para isso.
- A CID-11 tem **linearização oficial em português da OMS** — pede-se com o
  parâmetro de idioma, e vem o rótulo oficial.
- O MeSH tem traduções da própria NLM, onde elas existem.

Quando a fonte não tem tradução oficial para uma entrada, a resposta honesta é
devolver o idioma de origem. Um rótulo clínico traduzido por máquina parece
serviço e é passivo: uma diferença sutil de termo muda o que o código significa,
e quem lê não tem como saber que aquele texto não é oficial.

## Licenças, porque elas diferem entre as fontes

Um detalhe que atrapalha mais projetos do que deveria: **as classificações não
compartilham licença**, e o software que as serve não estende a sua própria.

- **CID-10 V2008 (DataSUS/CBCD):** © OMS; tradução © CBCD/FSP-USP; arquivos
  eletrônicos publicados pelo DataSUS. A permissão é de uso pelos
  desenvolvedores **com o devido crédito e sem custo**.
- **CID-11 (OMS):** Creative Commons Atribuição-SemDerivações 3.0 IGO
  (CC BY-ND 3.0 IGO), com citação exigida e a ressalva de que a OMS pode
  encerrar a licença mediante aviso.
- **Tabelas de transição:** © OMS, sob os Termos de Uso da CID-11.
- **LOINC:** © Regenstrief Institute, gratuito sob a licença própria.
- **RxNorm e MeSH:** obras do governo dos EUA, servidas pela NLM.
- **SNOMED CT:** exige licença da SNOMED International. O Brasil **não** é país
  membro — o caminho aqui é a licença de Afiliado.

A regra que evita problema: a licença do código do software não vale para o
conteúdo que ele serve. Cada resposta deve carregar a licença da fonte daquele
número.

## E onde entra um assistente de IA

Perguntar a um modelo *"qual o código CID-10 do infarto agudo do miocárdio?"*
devolve um código plausível. Costuma acertar nos casos famosos, e erra
silenciosamente na cauda — que é justamente onde a consulta importa, porque nos
casos famosos ninguém precisa perguntar.

O ganho de ligar o assistente às fontes oficiais é o mesmo de sempre:
**procedência**. O código vem com a fonte, a versão da terminologia, a URL
canônica e a licença; o rótulo em português vem do CBCD ou da OMS, não de uma
tradução inventada na hora; e o mapeamento entre revisões vem da tabela da OMS,
com as alternativas à vista, em vez de uma escolha implícita.

É o que o
[`medical-terminologies-mcp`](https://github.com/SidneyBissoli/medical-terminologies-mcp)
faz: 31 ferramentas sobre ICD-11, LOINC, RxNorm, MeSH, ATC e CID-10, para
clientes que falam [MCP](https://modelcontextprotocol.io). A CID-10 vai embutida
— consulta sem chamada de rede e sem limite de taxa —, e há validação em lote de
até 100 códigos de uma vez, entre seis terminologias, para quem precisa auditar
uma base inteira antes de analisá-la.

Uma última recomendação, independente de ferramenta: **antes de comparar duas
séries de morbidade, verifique se as duas estão na mesma revisão e no mesmo
grão.** Boa parte das quebras inexplicáveis em série histórica de saúde é uma
dessas duas coisas.

---

*Servidor:
[`medical-terminologies-mcp`](https://github.com/SidneyBissoli/medical-terminologies-mcp)
· endpoint hospedado em `https://medical.sidneybissoli.com/mcp` · pacote npm
[`medical-terminologies-mcp`](https://www.npmjs.com/package/medical-terminologies-mcp)
· código sob licença MIT. As terminologias servidas têm licenças próprias —
veja [NOTICE.md](../NOTICE.md).*
