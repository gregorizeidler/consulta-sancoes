# Consulta de Sanções

Busca e triagem em listas de sanções internacionais e brasileiras, publicada como **site estático** (GitHub Pages). Não há servidor, banco de dados nem log de consulta: um robô diário baixa as listas oficiais, normaliza, gera os arquivos e publica; a busca roda inteira no navegador.

Site: https://gregorizeidler.github.io/consulta-sancoes

## Sumário

1. [Visão geral](#visão-geral)
2. [Fontes de dados](#fontes-de-dados)
3. [Arquitetura](#arquitetura)
4. [Estrutura do repositório](#estrutura-do-repositório)
5. [Pipeline diário](#pipeline-diário)
6. [Esquema de dados](#esquema-de-dados)
7. [Motor de busca](#motor-de-busca)
8. [Benchmark e fuzzing](#benchmark-de-qualidade-do-match)
9. [Integridade: manifesto encadeado](#integridade-manifesto-encadeado)
10. [Vigilância](#vigilância)
11. [Páginas do site](#páginas-do-site)
12. [API estática](#api-estática)
13. [Testes](#testes)
14. [Rodar localmente](#rodar-localmente)
15. [Configuração](#configuração)
16. [Decisões de projeto e armadilhas conhecidas](#decisões-de-projeto-e-armadilhas-conhecidas)
17. [Limites](#limites)

## Visão geral

| Camada | Tecnologia | Papel |
| --- | --- | --- |
| Coleta | Python 3.11, só biblioteca padrão | baixa XML/CSV das fontes e normaliza num formato único |
| Geração | Python (`gera_site.py`) | monta índice, CSV, zip, manifesto e as páginas HTML |
| Front | HTML + CSS + JavaScript puro (ES5, sem build) | busca, triagem em lote, decisões, dossiê |
| Motor | `site/motor.js` | funções puras, sem DOM; rodam no navegador, num Web Worker e no Node |
| Qualidade | `tests/benchmark.js`, `fuzz_motor.js` | precisão e recall medidos a cada build; fuzzing com semente |
| Automação | GitHub Actions | roda tudo todo dia, executa os testes e publica |
| Hospedagem | GitHub Pages | serve `docs/` |

Não há dependência de pacote (`requirements.txt`, `package.json`): o Python usa só a biblioteca padrão e o Node só é usado para testes e para a vigilância.

## Fontes de dados

Estado em 06/11/2026 (`data/resumo.json`): **52.106 registros**.

| Chave | Fonte | Registros | Como é obtida |
| --- | --- | ---: | --- |
| `ofac` | OFAC SDN (Tesouro dos EUA) | 19.555 | XML oficial `sdn.xml` |
| `ofacns` | OFAC, lista consolidada não-SDN (SSI, FSE, NS-MBS e outras) | 393 | XML oficial `consolidated.xml`; espelho OpenSanctions se falhar |
| `un` | Conselho de Segurança da ONU | 1.007 | XML consolidado oficial |
| `eu` | União Europeia (FSF) | 6.269 | XML oficial `xmlFullSanctionsList_1_1` |
| `uk` | Reino Unido, UK Sanctions List (OFSI/FCDO) | 6.420 | XML oficial do FCDO; espelho OpenSanctions se falhar |
| `ceis` | CEIS, Empresas Inidôneas e Suspensas (CGU) | 16.950 | espelho OpenSanctions (CSV) |
| `slavery` | Lista Suja do Trabalho Escravo (MTE) | 496 | espelho OpenSanctions (CSV) |
| `tcu` | TCU, empresas inidôneas e pessoas inabilitadas | 699 | espelho OpenSanctions (CSV) |
| `bcb` | BCB, proibidos de atuar e pessoas inabilitadas | 317 | espelho OpenSanctions (CSV) |
| `cnep` | CNEP, Empresas Punidas (CGU) | 0 sem chave | API oficial do Portal da Transparência; **só entra com `PORTAL_TRANSPARENCIA_KEY`** |
| `pep` | PEP, Pessoas Expostas Politicamente (CGU) | ~106 mil | espelho OpenSanctions, **fora do índice principal** |

Os registros da `ofacns` que já estão na SDN (mesmo `uid` ou mesmo nome) são descartados, para o mesmo alvo não aparecer duas vezes: dos 486 itens da lista consolidada, 93 repetiam a SDN.

**Ordem de obtenção de cada fonte** (`origem` em `fontes_info`): `oficial` (download direto) → `espelho` (OpenSanctions) → `cache` (arquivo da carga anterior em `data/bruto/`). Cada passo só vale se o arquivo passar na validação de esquema (abaixo); se não passar, cai para o próximo e o motivo vai para `avisos` em `resumo.json`.

**CNEP:** a API oficial devolve 401 sem chave. O mapeamento de campos segue a documentação da API e **nunca foi executado contra uma chave real**; o teste usa um JSON de exemplo (`tests/fixtures/cnep_mini.json`). Sem `PORTAL_TRANSPARENCIA_KEY` a fonte é pulada com um aviso. Para ligar, crie o secret no repositório; o workflow já o repassa.

Por que o espelho para as fontes brasileiras: o download direto dos portais do governo devolve 403 para requisição que não vem de navegador, e a API oficial exige chave. O OpenSanctions republica as mesmas bases em CSV aberto com id estável por registro. Cada linha continua apontando para a fonte oficial (`u`). Detalhes em `src/fontes_br.py`.

O PEP é gravado à parte (`data/pep.json` → `docs/dados/pep.json`, convertido para o formato posicional do índice) e só é baixado quando o usuário marca "incluir PEP", para não pesar a busca padrão. O PEP traz CPF **mascarado** (`***.976.399-**`), e o motor sabe compará-lo (ver "Contexto da consulta").

### Validação de esquema e data de carga por fonte

O espelho OpenSanctions é um ponto único de falha para as fontes brasileiras, então cada arquivo é validado **antes** de ser aceito:

- CSV do espelho: colunas obrigatórias presentes (`valida_csv`); XML oficial: elemento raiz esperado e uma amostra de registros com os campos obrigatórios (`valida_xml`); XML truncado ou com raiz errada é rejeitado.
- Queda de mais de 30% no total de uma fonte em relação à carga anterior derruba a coleta (`PERMITIR_QUEDA=1` libera conscientemente).
- Cada fonte grava em `resumo.json › fontes_info` a **data de carga**, a `origem`, o número de registros, o tamanho e o SHA-256 do arquivo usado. O site mostra essa data por fonte e avisa quando uma fonte está com dado de cache (`avisos`).

## Arquitetura

```
 fontes oficiais ──► src/coleta.py ──► data/sancoes.json (+ resumo, ids, historico, pep)
 (XML/CSV)           src/fontes_br.py
                                          │
                                          ▼
                              src/gera_site.py ──► docs/  (site + dados/)
                              src/assinatura.py        │
                              src/paginas_extra.py     ▼
                                                 GitHub Pages
                                                      │
                                    navegador: app.js ⇄ worker.js (motor.js)
                              (indice.json carregado no Web Worker; busca local)
```

Dois diretórios de dados, com papéis diferentes:

- `data/`: estado versionado pelo robô (fonte de verdade e memória entre execuções).
- `docs/`: artefato de build, **não está no repositório**; é recriado do zero a cada execução (`gera_site.py` apaga e refaz a pasta) e enviado ao Pages.

## Estrutura do repositório

```
.github/workflows/atualizar.yml   pipeline diário (build + testes + deploy)
config.json                       título, subtítulo, base_url, domínio
vigilancia.json                   lista de nomes vigiados pelo robô
src/
  coleta.py                       baixa e normaliza OFAC, ONU, UE; orquestra as demais fontes
  fontes_br.py                    CEIS, Lista Suja, TCU, BCB e PEP via espelho; validação de esquema
  fontes_extra.py                 OFAC não-SDN, UK (OFSI) e CNEP (com chave)
  gera_site.py                    índice, CSV, zip, manifesto, HTML, sitemap
  assinatura.py                   manifesto encadeado (SHA-256)
  paginas_extra.py                casca HTML de decisões, dossiê e entidade
  vigilancia.js                   cruza vigilancia.json com a base do dia (Node)
site/                             fontes do front (copiadas para docs/ no build)
  motor.js                        busca difusa, índice invertido, contexto da consulta, sem DOM
  worker.js                       Web Worker: roda o motor fora da thread da tela
  app.js                          busca, filtros, triagem em lote, vigilância local
  extra.js                        decisões, dossiê, ficha do registro, caixa de PEP
  verificar.js                    página de verificação de integridade
  style.css                       estilo único (deve ser o primeiro <link rel=stylesheet>)
tests/
  test_motor.js                   motor de busca, documentos, contexto, contrato do worker
  benchmark.js                    precisão/recall contra o conjunto rotulado
  benchmark_minimos.json          pisos que o build exige do benchmark
  gera_benchmark.js               gera o conjunto rotulado (semente fixa)
  indice_oracle.js                índice invertido contra a varredura completa
  fuzz_motor.js                   fuzzing e propriedades do motor
  fixtures/                       benchmark.json e amostras das fontes
  test_dados.py                   qualidade da base normalizada
  test_fontes.py                  esquema, queda, CPF mascarado, fontes novas
  test_manifesto.js               corrente de hashes
data/
  sancoes.json                    registros normalizados
  resumo.json                     contagens e diff do dia
  ids.json                        snapshot de ids (base do diff do dia seguinte)
  historico.json                  diffs diários (últimos 120)
  manifesto.json                  corrente de hashes (últimos 365 dias)
  vigilancia-alertas.json         saída da vigilância
docs/                             site gerado (artefato do Pages)
```

## Pipeline diário

`.github/workflows/atualizar.yml`: cron `0 9 * * *` (UTC), ou seja **06:00 em Brasília**, mais `workflow_dispatch` para rodar à mão. `concurrency: paginas` com `cancel-in-progress: false` evita dois deploys simultâneos.

Job `build`, nesta ordem (qualquer falha interrompe e **nada é publicado**):

0. Cache de `data/bruto/` (`actions/cache`): é o que permite o fallback para a carga anterior quando uma fonte cai.
1. `python3 src/coleta.py`: baixa, valida o esquema e normaliza (com `PORTAL_TRANSPARENCIA_KEY`, se o secret existir).
2. `python3 src/gera_site.py`: gera `docs/`.
3. `node --check site/*.js`: sintaxe de todos os scripts do front.
4. `node tests/test_motor.js`: testes do motor.
5. `node tests/benchmark.js --check`: precisão e recall contra os pisos de `tests/benchmark_minimos.json`.
6. `node tests/indice_oracle.js --check`: índice invertido contra a varredura completa.
7. `node tests/fuzz_motor.js 3000`: fuzzing.
8. `node src/vigilancia.js`: gera `vigilancia-alertas.json`.
9. `python3 tests/test_dados.py`: qualidade da base.
10. `python3 tests/test_fontes.py`: esquema das fontes, queda brusca, CPF mascarado.
11. `node tests/test_manifesto.js`: corrente de hashes.
12. Commit do robô (`sancoes-bot`) com `data/ids.json`, `resumo.json`, `historico.json`, `manifesto.json` e `vigilancia-alertas.json`, depois `git push`.
13. Upload de `docs/` como artefato do Pages.

Job `deploy` (depende de `build`): `actions/deploy-pages`.

### Coleta (`src/coleta.py`)

- Download com 3 tentativas e espera crescente (5 s, 10 s, 15 s), `User-Agent` próprio, resposta menor que 1 KB é tratada como falha.
- **Fallback conservador:** se uma fonte falha nas 3 tentativas e há arquivo da carga anterior em `data/bruto/`, usa o antigo (com `AVISO` no log) em vez de zerar a fonte e publicar base incompleta. `data/bruto/` é cache local, ignorado pelo Git.
- Cada fonte tem seu parser (`ofac`, `onu`, `ue` em `coleta.py`; as demais em `fontes_br.py` e `fontes_extra.py`) que emite o mesmo dicionário (ver esquema abaixo). Os namespaces XML são removidos antes do parse.
- Deduplicação por id; a contagem por fonte em `resumo.json` é recalculada **depois** da deduplicação, para fechar com o arquivo.
- **Diff do dia:** compara os ids atuais com `data/ids.json` da execução anterior e grava `novos` (até 60, com nome/fonte/tipo/programa) e `removidos` (até 60 ids). Na primeira carga não há diff (`primeira_carga: true`).

## Esquema de dados

### Registro normalizado (`data/sancoes.json`)

```json
{ "i": "ofac-12345", "f": "ofac", "t": "pessoa", "n": "NOME COMPLETO",
  "a": ["alias 1"], "p": "RUSSIA-EO14024", "c": "Russia",
  "d": "", "u": "https://...", "x": "data de nascimento / observação", "doc": ["Passport: ABC123"] }
```

| Campo | Significado |
| --- | --- |
| `i` | id único com prefixo da fonte (`ofac-`, `un-`, `eu-`, `ceis-`...) |
| `f` | fonte (`ofac`, `ofacns`, `un`, `eu`, `uk`, `ceis`, `cnep`, `slavery`, `tcu`, `bcb`, `pep`) |
| `t` | `pessoa`, `entidade`, `embarcacao`, `aeronave` ou `outro` |
| `n` | nome principal (na OFAC, `firstName + lastName`) |
| `a` | aliases (até 12) |
| `p` | programa/regime de sanção |
| `c` | países |
| `d` | data de entrada na lista, quando a fonte informa |
| `u` | link para a fonte oficial |
| `x` | detalhe (nascimento ou comentário, truncado) |
| `doc` | documentos, sempre no formato `Tipo: número` (até 4); CPF/CNPJ saem formatados |

### Índice público (`docs/dados/indice.json`)

Lista de listas, para ficar compacto. Posições:

```
[0 id, 1 nome, 2 aliases(≤8), 3 fonte, 4 tipo, 5 programa, 6 país, 7 data, 8 link, 9 detalhe, 10 documentos, 11 presente_em]
```

`presente_em` lista as fontes onde o **mesmo nome normalizado** aparece (ex.: `"eu,ofac"`), só quando há mais de uma.

### Resumo (`resumo.json`) e histórico (`historico.json`)

`resumo.json`: `gerado_em`, `gerado_em_br`, `total`, `por_fonte`, `novos_total`, `removidos_total`, `novos[]`, `removidos[]`, `tamanho_fontes_bytes`, `primeira_carga`, mais `fontes_info` (por fonte: `carregado_em`, `origem` oficial/espelho/cache, `registros`, `bytes`, `sha256`) e `avisos[]` (fonte pulada, queda brusca, esquema inválido).

`historico.json`: um item por execução com diff (`data`, `hora`, `novos`, `removidos`, `total`, `nomes[≤25]`), mantendo os últimos 120. Execuções repetidas no mesmo dia geram itens repetidos; não há deduplicação aqui (ao contrário do manifesto).

### CSV (`docs/dados/sancoes.csv`)

UTF-8 com BOM. Colunas: `id, nome, aliases, fonte, tipo, programa, pais, data, link_oficial, extra, documentos, presente_em`. Aliases e documentos separados por ` | `.

## Motor de busca

`site/motor.js` é um módulo UMD sem dependência de DOM (ES5), carregado no navegador (`window.Motor`), dentro de um Web Worker (`site/worker.js`) e no Node (`require`). Os mesmos testes validam o que roda em produção, e a vigilância reusa o motor no robô.

Uma busca tem quatro etapas: **normalizar → achar candidatos pelo índice invertido → pontuar o nome → ajustar pelo contexto** (nascimento, país, documento).

### Normalização e transliteração

`norm`: minúsculas, **cirílico transliterado para latino** (`Владимир Путин` → `vladimir putin`), letras como `ß ø æ đ ł` expandidas, NFD sem diacríticos, tudo que não é `[a-z0-9]` vira espaço. Escrita árabe e CJK não são transliteradas (os aliases latinos do registro é que casam).

**Chave fonética por palavra** (`chaveToken`): regras que colapsam as variantes de grafia mais comuns (`ph→f`, `kh→h`, `sh/sch→s`, `ch/tch→c`, `zh/dzh→j`, `w→v`, `y→i`, `ou/oo→u`, `o→u`, `e→a`, `ei/ai→i`, letras dobradas...). `Mohammed`, `Muhammad` e `Mohamed` viram a mesma chave; `Yuri`/`Iurii`, `Sergey`/`Sergei` também. Duas palavras com a mesma chave (a partir de 3 letras) contam como a mesma palavra, e o score sai com um desconto de 3% (`fonetica: 0,97`) por não ser grafia idêntica.

### Pontuação do nome (`similaridade`)

Score base (`bruto`) em 0–100:

```
0,45 × Jaro-Winkler + 0,35 × Dice(trigramas) + 0,20 × cobertura de tokens
```

| Medida | Cobre |
| --- | --- |
| Jaro-Winkler | erro de digitação, prefixo comum |
| Dice sobre trigramas | nome reordenado, pedaço faltando |
| Cobertura de tokens | consulta curta dentro de nome oficial longo |

Regras sobre o score base:

- Nomes idênticos após normalização: **100**.
- **Janelas de tokens:** se o registro tem mais palavras que a consulta, compara a consulta com cada janela contígua de `n` e `n+1` palavras do registro e fica com a melhor.
- **Mesmas palavras em outra ordem**: no mínimo **95** (93 quando a equivalência é fonética).
- **Nome junto/separado** (`bin laden` × `binladen`): 95.
- **Uma edição** (mesma quantidade de palavras, só uma difere, com 6+ letras nos dois lados e 1 erro, inclusive transposição): piso **88**, para que um erro de digitação em nome longo não caia da faixa "provável".
- **Penalidade de cobertura parcial:** se `cobertura < 1`, o score é multiplicado por `0,6 + 0,4 × cobertura`.
- `melhorSim` testa o nome principal e até 8 aliases e para ao atingir 99.

### Equivalência de palavras (`equivalente`)

Duas palavras são "a mesma" se tiverem a mesma chave fonética (3+ letras) ou estiverem a **1 edição** (4 a 7 letras) ou **2 edições** (8+ letras) pela distância de Damerau/OSA (a troca de duas letras vizinhas conta como 1). Palavra com menos de 3 letras exige igualdade, e com 3 letras só vale a chave fonética (sem tolerância de edição). O cálculo tem corte antecipado (`levLimitado`).

### Contexto da consulta (`ajusta`)

Nascimento, país e documento **entram no score**, não só aparecem na ficha. Os campos são opcionais; quando existem, ajustam a nota do nome:

| Situação | Ajuste |
| --- | --- |
| Documento idêntico (CPF/CNPJ/passaporte) | vai a **100** |
| CPF mascarado compatível (`***.976.399-**`) | +6 |
| Documento do mesmo tipo e diferente | −40 |
| Tipo incompatível (consulta CNPJ, registro pessoa) | −15 |
| Nascimento idêntico | +8 |
| Dia e mês trocados (`03/12` × `12/03`) | +2 |
| Só o ano confere | +4 |
| Mesmo ano, outro dia/mês | −10 |
| Ano ±1 | −8 |
| Nascimento em conflito | −30 |
| Mesmo país | +3 |
| País diferente | −18 |

Bônus só valem se o score do nome já é ≥ 70; penalidades valem sempre. O cartão do resultado mostra cada ajuste ("nascimento idêntico +8") e a ficha mostra "nome 93% → 100%". Datas aceitam `dd/mm/aaaa`, ISO e só o ano; o registro pode ter várias datas de nascimento. País aceita nome em português ou inglês e códigos ISO.

**CPF e CNPJ** têm o dígito verificador validado (`validaCPF`, `validaCNPJ`); documento com DV inválido gera aviso na tela ("confira a digitação") e **nunca** conta como documento idêntico. O CPF mascarado, como o PEP publica, é comparado posição a posição: os dígitos visíveis precisam coincidir.

### Índice invertido (`indexa` / `candidatos`)

A primeira versão varria os 52 mil registros com máscaras de trigrama de 32 bits. Foi trocada por um índice invertido, montado uma vez ao carregar a base:

- vocabulário de tokens → listas de registros, com peso idf;
- trigramas → palavras do vocabulário (acha a palavra com erro de digitação sem varrer tudo);
- metades de palavras e chave fonética → palavras (cobre erro no começo e variante de grafia);
- acumulação do score em arrays tipados; os **500 melhores** candidatos seguem para o score completo;
- nomes só de iniciais (`K M A`) são indexados pelos tokens de 1 letra.

Na medição de `tests/indice_oracle.js` (60 consultas amostradas, limiar 70), o índice é **28 vezes mais rápido** que a varredura completa (1,6 s contra 45,9 s) e acha **99,5%** do que a varredura acha: 1 de 197 resultados é perdido (`soleymani ghasem`). É uma perda conhecida e aceita.

### Web Worker

`app.js` não chama o motor direto: conversa com `worker.js` por mensagens (`carregar`, `adicionar`, `adicionarUrl`, `buscar`, `melhor`). O worker baixa o JSON, monta o índice e responde, então a tela não trava enquanto 50 mil registros (ou 158 mil, com PEP) são indexados, inclusive no celular. O contrato é `Motor.servidor()` + `Motor.despacha(srv, tipo, args)`, compartilhado entre o worker e o **fallback**: se o navegador não tem `Worker` ou o script falha ao carregar, o mesmo servidor roda na thread principal e a tela mostra "(sem worker)" na contagem. Respostas de buscas antigas são descartadas quando há uma mais nova.

### Faixas (`faixa`)

| Score | Rótulo |
| --- | --- |
| 100 | exata |
| 92–99 | forte |
| 85–91 | provável |
| 70–84 | possível |
| < 70 | fraca |

### Busca por documento

Se a consulta (ou o campo Documento) parece um documento, o motor consulta o índice de documentos. CPF/CNPJ completos e válidos são buscas diretas por igualdade (score 100, "documento idêntico"). CPF mascarado, em qualquer dos dois lados, compara os dígitos visíveis ("documento mascarado compatível", 92). Passaporte e outros números casam por trecho (90, "trecho do documento") ou igualdade. Um número como `2351885 ONTARIO INC` não é tratado como documento: se sobram letras além do rótulo (`CPF`, `CNPJ`, `RG`...), é nome.

### Explicabilidade (`explica`)

Devolve score, Jaro-Winkler, Dice, cobertura, palavras que casaram, palavras que faltaram, se foi só troca de ordem e **por qual alias** casou. É o que a ficha do resultado mostra em "por que casou".

## Benchmark de qualidade do match

Até aqui os testes só checavam casos pontuais. Agora há um conjunto rotulado e o build mede **precisão e recall** a cada execução; qualquer mudança em peso ou limiar passa a ter número.

`tests/gera_benchmark.js` monta, com semente fixa (`mulberry32`, 20261106), um corpus de 9.000 registros reais da base e **2.312 consultas** em 17 categorias, com o gabarito:

| Categoria | O que é |
| --- | --- |
| `digitacao`, `digitacao2` | 1 e 2 erros de digitação (troca, omissão, duplicação) |
| `ordem` | sobrenome primeiro, ordem invertida |
| `translit`, `translit+ordem` | variantes de grafia (`Mohammed`/`Muhammad`...), com e sem ordem trocada |
| `cirilico` | nome escrito em cirílico contra registro latino |
| `alias` | consulta pelo apelido |
| `formato` | caixa, pontuação, espaços, acentos |
| `nasc-confere` | nome com erro + nascimento certo |
| `cpf-completo`, `cpf-mascarado` | acha pelo documento, inteiro ou mascarado |
| `mix-negativo` | combinações de nomes reais que **não** existem na base |
| `comum-negativo` | nomes brasileiros comuns que não estão na base |
| `nasc-diverge`, `pais-diverge` | **homônimo**: mesmo nome, nascimento ou país diferente: não deve casar |
| `cpf-diverge`, `cpf-dv-invalido` | mesmo nome com CPF diferente / documento com DV inválido: não deve casar |

Métricas (limiar 85): **precisão** = dos resultados com score ≥ limiar, quantos eram o registro esperado; **recall** = das consultas com resposta, quantas devolveram o registro certo; também top-1, MRR e "negativos limpos" (consultas sem resposta que não devolveram nada).

Resultado com o motor novo contra o motor anterior (mesmas 2.312 consultas, limiar 85):

| | Motor anterior | Motor atual |
| --- | ---: | ---: |
| Precisão | 78,0% | **95,4%** |
| Recall | 74,6% | **99,3%** |
| F1 | 76,3% | **97,3%** |
| Top-1 | 74,2% | **99,0%** |
| MRR | 0,839 | **0,995** |
| Tempo do benchmark | 101 s | 49 s |

Negativos limpos: 85,7% → 98,3%. As maiores diferenças por categoria: cirílico 2,5% → 100% de recall, `translit+ordem` 10,8% → 92,3%, `cpf-completo` 0% → 100%, homônimos com CPF diferente 72,5% → 98,8% limpos. O motor anterior só olhava o nome e não tinha busca por CPF completo nem tratamento de cirílico. O relatório por categoria sai de `node tests/benchmark.js`.

`node tests/benchmark.js --check` falha o build se qualquer métrica (global ou por categoria) ficar abaixo de `tests/benchmark_minimos.json`. `MOTOR=/caminho/motor_antigo.js node tests/benchmark.js` mede outra versão com as mesmas perguntas.

**O que o benchmark não prova:** o corpus é gerado a partir da própria base, então mede robustez a ruído sintético, não o mundo real; a taxa de homônimos reais de nomes brasileiros comuns é maior. A precisão no limiar 70 é baixa (56%) por desenho: a faixa "possível" é para revisão humana.

**Limites conhecidos, medidos e aceitos:** `translit+ordem` fica em 92,3%; variantes que a chave fonética não une (`Mykola`/`Nikolaj`, `Ismael`/`Esmail`, `Lee`/`Li`, `Wei`/`Wai`) não casam; `comum-negativo` limpa só 80% porque nomes comuns brasileiros têm quase-homônimos legítimos sem nascimento ou CPF para desempatar.

## Fuzzing

`node tests/fuzz_motor.js [iterações] [semente]` (padrão 3.000 iterações; imprime a semente para reproduzir uma falha). Cerca de 41 mil verificações por rodada:

- **Robustez:** entradas hostis (vazio, só pontuação, 10 mil caracteres, surrogates, emoji, `\0`, HTML, cirílico/árabe/CJK misturados) nunca lançam exceção nem devolvem `NaN` ou score fora de 0–100.
- **Propriedades:** `similaridade(a,a)=100`, simetria, ordem estável, distância de edição limitada e simétrica.
- **CPF/CNPJ:** DV gerado é válido; trocar um dígito de DV invalida; máscara sempre compatível com o número que a gerou.
- **Metamórficos:** acento, caixa e pontuação não mudam o resultado; inverter a ordem das palavras não derruba abaixo de 95.
- **Índice × fixture:** o índice invertido acha cada registro sorteado do benchmark pelo próprio nome.

`node tests/indice_oracle.js --check` compara o índice com a varredura completa e falha se o recall do índice cair abaixo do piso.

## Integridade: manifesto encadeado

Caso de uso: na auditoria, provar que a lista consultada em certa data é a mesma publicada naquele dia.

A cada execução, `src/assinatura.py` acrescenta (ou substitui, se já houver entrada do mesmo dia) uma linha em `data/manifesto.json`:

```
data, hora, total, por_fonte, csv_nome, csv_bytes,
csv_sha256, indice_sha256, zip_sha256, hash_anterior, cadeia_hash
```

- `cadeia_hash` = SHA-256 do JSON canônico da linha (chaves ordenadas, separadores compactos, UTF-8) **sem** o próprio `cadeia_hash`.
- `hash_anterior` = `cadeia_hash` da linha anterior; a primeira aponta para 64 zeros.
- Alterar qualquer dia passado quebra o elo de todos os seguintes.
- Mantém os últimos 365 dias.
- `/verificar.html` recalcula tudo no navegador: o usuário solta o CSV e a página diz de que dia ele é e se a corrente está íntegra (também aceita `?h=<hash>`). Nada é enviado.
- O manifesto é commitado pelo robô, então o histórico do Git é uma segunda testemunha independente.

**Limite:** isso prova integridade e anterioridade, **não** é assinatura com chave privada nem carimbo de tempo de terceiro. Para isso seria preciso uma chave guardada como segredo do repositório.

## Vigilância

Dois mecanismos independentes:

1. **No navegador** (`app.js`): nomes salvos em `localStorage` (chave `vigilancia-sancoes`, até 200) e reverificados a cada visita. Só avisa quando a pessoa abre o site.
2. **No robô** (`src/vigilancia.js`): lê `vigilancia.json` (`{"nomes": [...]}`), roda o mesmo motor sobre `docs/dados/indice.json` com limiar **85** e grava `data/vigilancia-alertas.json` (e a cópia em `docs/dados/`). Para cada nome: total de achados, melhor achado, até 5 achados e quantos nomes do diff do dia casam (`novos_hoje`). Nomes com menos de 3 caracteres são ignorados.

`vigilancia.json` está vazio hoje; basta adicionar nomes e o próximo build já os cruza.

## Páginas do site

| Página | Função |
| --- | --- |
| `index.html` | busca difusa com filtros de fonte, tipo e limiar (padrão 60%), cartões com score e explicação |
| `lote.html` | triagem em lote: sobe CSV ou cola lista (nome e, opcionalmente, documento), recebe o melhor resultado por linha e um CSV de saída; roda 100% local |
| `mudancas.html` | histórico dos diffs diários |
| `verificar.html` | verificação de integridade contra o manifesto |
| `api.html` | documentação dos arquivos públicos |
| `decisoes.html` | registro de decisões (confirmado / falso positivo / homônimo) com justificativa obrigatória, filtro, CSV e impressão |
| `dossie.html?nome=...&limiar=85` | dossiê de triagem imprimível (consulta, base usada, SHA-256 do dataset, correspondências, decisão registrada) |
| `entidade.html?id=...` | ficha do registro: documentos, programa, país, link oficial, outras listas e histórico |

`decisoes.html`, `dossie.html` e `entidade.html` são só casca HTML (`paginas_extra.py`); quem desenha é `extra.js`, a partir do índice já publicado. Decisões ficam em `localStorage` (chave `sancoes:decisoes`) e cada uma grava o hash do dataset vigente no momento. Como é `localStorage`, **as decisões vivem no navegador de quem as tomou**: o CSV exportado é a cópia de auditoria.

`extra.js` é injetado ao fim do `<body>` de todo HTML gerado. `app.js` e `extra.js` derivam a base de URL do **primeiro** `<link rel="stylesheet">` da página; por isso `style.css` precisa continuar sendo a primeira folha de estilo (colocar outra antes quebra o carregamento dos dados).

Geração também de `sitemap.xml` e `robots.txt`.

## API estática

JSON público, sem chave, servido pelo Pages sob `/dados/`:

| Arquivo | Conteúdo |
| --- | --- |
| `indice.json` | índice completo (formato posicional acima) |
| `resumo.json` | contagens e diff do dia |
| `historico.json` | diffs diários |
| `manifesto.json` | corrente de hashes |
| `sancoes.csv` | planilha completa (o hash do manifesto refere-se a este arquivo) |
| `listas-completas.zip` | o mesmo CSV compactado, com a data no nome |
| `pep.json` | PEP (carregado sob demanda) |
| `vigilancia-alertas.json` | saída da vigilância |

O CSV está disponível avulso porque o `csv_sha256` do manifesto é o hash do arquivo CSV, e quem baixa só o zip não consegue conferi-lo diretamente (o zip tem o próprio `zip_sha256`).

## Testes

Todos rodam no pipeline antes do deploy.

| Comando | O que valida |
| --- | --- |
| `node tests/test_motor.js` | 37 testes: normalização e transliteração, score, equivalência fonética, ajustes de nascimento/país/documento, DV de CPF/CNPJ, CPF mascarado, busca por documento, índice invertido, contrato do Worker (`despacha`), PEP posicional, busca na base real |
| `node tests/benchmark.js --check` | precisão, recall, top-1, MRR e negativos limpos, global e por categoria, contra `tests/benchmark_minimos.json` |
| `node tests/indice_oracle.js --check` | recall do índice invertido contra a varredura completa |
| `node tests/fuzz_motor.js [iterações] [semente]` | robustez, propriedades e metamórficos (ver Fuzzing) |
| `python3 tests/test_fontes.py` | 71 testes: esquema das fontes (XML/CSV/JSON), cabeçalho esperado, queda > 30%, deduplicação OFAC não-SDN, mapeamento do CNEP (com fixture), CPF mascarado |
| `python3 tests/test_dados.py` | todo registro tem tipo conhecido; nenhum tipo virou rótulo de observação; documento sempre `Tipo: número`; nenhum documento é na verdade observação; contagem por fonte bate com o resumo; ids únicos; nenhum registro sem nome; > 15 mil registros com documento |
| `node tests/test_manifesto.js` | cada dia aponta para o anterior; hash de cada linha confere; CSV e índice publicados batem com o último hash; adulterar um registro quebra o hash |
| `node --check site/*.js` | sintaxe dos scripts do front |

`test_dados.py` existe por causa de um bug real: até 03/11/2026 a variável `tipo` (pessoa/entidade) era sobrescrita pelo tipo do documento no laço de identificações, e 12.513 registros (47% da base) ficaram com rótulos da OFAC como `Secondary sanctions risk:` em `tipo`, o que quebrava o filtro Pessoa/Entidade.

## Rodar localmente

Requisitos: Python 3.11+ e Node 18+ (Node só para testes e vigilância).

```bash
python3 src/coleta.py        # baixa as fontes e normaliza
python3 src/gera_site.py     # gera docs/
node tests/test_motor.js
node tests/benchmark.js          # relatório; --check aplica os pisos
node tests/indice_oracle.js --check
node tests/fuzz_motor.js 3000    # 2º argumento: semente para reproduzir
python3 tests/test_fontes.py
python3 tests/test_dados.py
node tests/test_manifesto.js
node src/vigilancia.js
python3 -m http.server -d docs 8000   # http://localhost:8000
```

Para reaproveitar os arquivos já baixados em `data/bruto/` durante o desenvolvimento: `REUSAR_BRUTO=1 python3 src/coleta.py` (vale para OFAC, ONU e UE; as fontes brasileiras sempre tentam baixar e caem no arquivo anterior se falharem).

Para o CNEP oficial: `PORTAL_TRANSPARENCIA_KEY=... python3 src/coleta.py`. `PERMITIR_QUEDA=1` aceita uma queda de mais de 30% numa fonte (por padrão a coleta aborta). Para medir outra versão do motor: `MOTOR=/caminho/motor.js node tests/benchmark.js`. Para a busca no navegador, sirva a pasta sob o prefixo do `base_url` (ex.: `/consulta-sancoes/`), porque o site resolve os caminhos a partir do primeiro `<link rel=stylesheet>`.

Observação: rodar `gera_site.py` localmente acrescenta uma linha ao `data/manifesto.json`. Não commite esse arquivo vindo de uma execução local, ou a corrente publicada passará a conter um dia que não veio do robô.

## Configuração

`config.json`:

| Chave | Uso |
| --- | --- |
| `titulo` | título das páginas |
| `subtitulo` | texto de apoio |
| `base_url` | URL pública (canonical, sitemap, links) |
| `dominio` | domínio próprio, se houver |

## Decisões de projeto e armadilhas conhecidas

- **Tudo no cliente.** Privacidade por construção (nome consultado nunca sai do navegador) e custo zero de hospedagem. O preço é carregar o índice inteiro (alguns MB) a cada visita.
- **Nome da OFAC.** A OFAC separa `firstName` e `lastName`; usar só o sobrenome gerava registros como `PUTIN` que não casavam com o nome completo. O nome é montado com os dois campos.
- **Índice invertido em vez de máscara de trigrama.** A máscara de 32 bits saturava em nomes longos e a varredura era linear. O índice custa ~0,5% de recall frente à varredura completa e é 28 vezes mais rápido.
- **Worker com fallback.** A busca roda fora da thread da tela; sem `Worker`, o mesmo servidor roda na thread principal (esse caminho foi testado só no Node).
- **Contexto ajusta, não filtra.** Nascimento, país e documento mudam a nota e ficam explicados no cartão; nunca escondem um resultado sozinhos.
- **Validar o espelho a cada coleta.** As fontes brasileiras vêm de um único espelho; a coleta confere cabeçalho e colunas, e uma queda de mais de 30% aborta o build.
- **Penalidade de cobertura parcial** e **palavra curta exige igualdade** existem para conter falsos positivos observados na base real.
- **Fallback para a carga anterior** prefere dado de ontem a base mutilada.
- **`docs/` fora do Git.** Dados derivados são recriados a cada build; só o estado que precisa de memória (`data/`) é versionado.
- **Nome do CSV.** O arquivo ainda se chama `sancoes-ofac-onu-ue-AAAA-MM-DD.csv`, nome herdado de quando só havia três fontes, embora hoje contenha todas.
- **Diff pode ser ruído.** UE e ONU reemitem revisões; um "novo" pode ser registro corrigido.

## Limites

- **Não é parecer jurídico** nem substitui a consulta à fonte oficial. Homônimos são comuns: score alto é indício a conferir, nunca conclusão.
- Além da SDN, entra a lista consolidada não-SDN da OFAC e o Reino Unido (OFSI). Outras listas (por exemplo Canadá, Austrália, Suíça) não estão aqui.
- O **CNEP** oficial só entra com `PORTAL_TRANSPARENCIA_KEY` e o mapeamento **nunca foi executado contra uma chave real**; sem a chave, a fonte aparece como pulada.
- As fontes brasileiras ainda dependem de **um único espelho** (OpenSanctions). Agora o esquema é validado a cada coleta e a data de carga de cada fonte aparece no site e em `resumo.json`, mas o espelho continua sendo ponto único de falha: se mudar de formato ou sair do ar, a fonte fica com a carga anterior e um aviso.
- O benchmark é sintético (gerado da própria base) e não substitui uma amostra real rotulada; a precisão no limiar 70 é de 56%.
- Transliteração por regras: variantes como `Mykola`/`Nikolaj`, `Lee`/`Li` não casam; árabe e CJK em escrita nativa não são transliterados.
- A triagem em lote é apoio operacional, não processo de KYC.
- O manifesto prova integridade e anterioridade, não autoria.
- Cada registro traz o link da fonte: antes de decidir, confira documento, data de nascimento e país.

## Fontes oficiais

- OFAC SDN: https://www.treasury.gov/ofac/downloads/sdn.xml
- ONU: https://scsanctions.un.org/resources/xml/en/consolidated.xml
- União Europeia (FSF): https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content
- CEIS e PEP: https://portaldatransparencia.gov.br/download-de-dados
- Espelho OpenSanctions: https://data.opensanctions.org
