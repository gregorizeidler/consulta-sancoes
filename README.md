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
8. [Integridade: manifesto encadeado](#integridade-manifesto-encadeado)
9. [Vigilância](#vigilância)
10. [Páginas do site](#páginas-do-site)
11. [API estática](#api-estática)
12. [Testes](#testes)
13. [Rodar localmente](#rodar-localmente)
14. [Configuração](#configuração)
15. [Decisões de projeto e armadilhas conhecidas](#decisões-de-projeto-e-armadilhas-conhecidas)
16. [Limites](#limites)

## Visão geral

| Camada | Tecnologia | Papel |
| --- | --- | --- |
| Coleta | Python 3.11, só biblioteca padrão | baixa XML/CSV das fontes e normaliza num formato único |
| Geração | Python (`gera_site.py`) | monta índice, CSV, zip, manifesto e as páginas HTML |
| Front | HTML + CSS + JavaScript puro (ES5, sem build) | busca, triagem em lote, decisões, dossiê |
| Motor | `site/motor.js` | funções puras, sem DOM, rodam no navegador e no Node |
| Automação | GitHub Actions | roda tudo todo dia, executa os testes e publica |
| Hospedagem | GitHub Pages | serve `docs/` |

Não há dependência de pacote (`requirements.txt`, `package.json`): o Python usa só a biblioteca padrão e o Node só é usado para testes e para a vigilância.

## Fontes de dados

Estado em 06/11/2026 (`data/resumo.json`): **45.293 registros**.

| Chave | Fonte | Registros | Como é obtida |
| --- | --- | ---: | --- |
| `ofac` | OFAC SDN (Tesouro dos EUA) | 19.555 | XML oficial `sdn.xml` |
| `un` | Conselho de Segurança da ONU | 1.007 | XML consolidado oficial |
| `eu` | União Europeia (FSF) | 6.269 | XML oficial `xmlFullSanctionsList_1_1` |
| `ceis` | CEIS, Empresas Inidôneas e Suspensas (CGU) | 16.950 | espelho OpenSanctions (CSV) |
| `slavery` | Lista Suja do Trabalho Escravo (MTE) | 496 | espelho OpenSanctions (CSV) |
| `tcu` | TCU, empresas inidôneas e pessoas inabilitadas | 699 | espelho OpenSanctions (CSV) |
| `bcb` | BCB, proibidos de atuar e pessoas inabilitadas | 317 | espelho OpenSanctions (CSV) |
| `pep` | PEP, Pessoas Expostas Politicamente (CGU) | ~106 mil | espelho OpenSanctions, **fora do índice principal** |

Por que o espelho para as fontes brasileiras: o download direto dos portais do governo devolve 403 para requisição que não vem de navegador, e a API oficial exige chave. O OpenSanctions republica as mesmas bases em CSV aberto com id estável por registro. Cada linha continua apontando para a fonte oficial (`u`). Detalhes em `src/fontes_br.py`.

O PEP é gravado à parte (`data/pep.json` → `docs/dados/pep.json`) e só é baixado pelo navegador quando o usuário marca "incluir PEP", para não pesar a busca padrão.

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
                                    navegador: motor.js + app.js + extra.js
                              (indice.json carregado inteiro; busca local)
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
  coleta.py                       baixa e normaliza OFAC, ONU, UE; orquestra as fontes BR
  fontes_br.py                    CEIS, Lista Suja, TCU, BCB e PEP via espelho
  gera_site.py                    índice, CSV, zip, manifesto, HTML, sitemap
  assinatura.py                   manifesto encadeado (SHA-256)
  paginas_extra.py                casca HTML de decisões, dossiê e entidade
  vigilancia.js                   cruza vigilancia.json com a base do dia (Node)
site/                             fontes do front (copiadas para docs/ no build)
  motor.js                        busca difusa, sem DOM
  app.js                          busca, filtros, triagem em lote, vigilância local
  extra.js                        decisões, dossiê, ficha do registro, caixa de PEP
  verificar.js                    página de verificação de integridade
  style.css                       estilo único (deve ser o primeiro <link rel=stylesheet>)
tests/
  test_motor.js                   motor de busca
  test_dados.py                   qualidade da base normalizada
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

1. `python3 src/coleta.py`: baixa e normaliza.
2. `python3 src/gera_site.py`: gera `docs/`.
3. `node --check site/*.js`: sintaxe de todos os scripts do front.
4. `node tests/test_motor.js`: testes do motor.
5. `node src/vigilancia.js`: gera `vigilancia-alertas.json`.
6. `python3 tests/test_dados.py`: qualidade da base.
7. `node tests/test_manifesto.js`: corrente de hashes.
8. Commit do robô (`sancoes-bot`) com `data/ids.json`, `resumo.json`, `historico.json`, `manifesto.json` e `vigilancia-alertas.json`, depois `git push`.
9. Upload de `docs/` como artefato do Pages.

Job `deploy` (depende de `build`): `actions/deploy-pages`.

### Coleta (`src/coleta.py`)

- Download com 3 tentativas e espera crescente (5 s, 10 s, 15 s), `User-Agent` próprio, resposta menor que 1 KB é tratada como falha.
- **Fallback conservador:** se uma fonte falha nas 3 tentativas e há arquivo da carga anterior em `data/bruto/`, usa o antigo (com `AVISO` no log) em vez de zerar a fonte e publicar base incompleta. `data/bruto/` é cache local, ignorado pelo Git.
- Cada fonte tem seu parser (`ofac`, `onu`, `ue`) que emite o mesmo dicionário (ver esquema abaixo). Os namespaces XML são removidos antes do parse.
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
| `f` | fonte (`ofac`, `un`, `eu`, `ceis`, `slavery`, `tcu`, `bcb`, `pep`) |
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

`resumo.json`: `gerado_em`, `gerado_em_br`, `total`, `por_fonte`, `novos_total`, `removidos_total`, `novos[]`, `removidos[]`, `tamanho_fontes_bytes`, `primeira_carga`.

`historico.json`: um item por execução com diff (`data`, `hora`, `novos`, `removidos`, `total`, `nomes[≤25]`), mantendo os últimos 120. Execuções repetidas no mesmo dia geram itens repetidos; não há deduplicação aqui (ao contrário do manifesto).

### CSV (`docs/dados/sancoes.csv`)

UTF-8 com BOM. Colunas: `id, nome, aliases, fonte, tipo, programa, pais, data, link_oficial, extra, documentos, presente_em`. Aliases e documentos separados por ` | `.

## Motor de busca

`site/motor.js` é um módulo UMD sem dependência de DOM, carregado no navegador (`window.Motor`) e no Node (`require`). Isso permite que os mesmos testes validem o que roda em produção e que a vigilância reuse o motor no robô.

### Normalização

`norm`: NFD, remove diacríticos, minúsculas, tudo que não é `[a-z0-9]` vira espaço, colapsa espaços.

### Pontuação (`similaridade`)

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
- **Janelas de tokens:** se o registro tem mais palavras que a consulta, compara a consulta com cada janela contígua de `n` e `n+1` palavras do registro e fica com a melhor (acha `ZASLON` dentro de `JSC SCIENTIFIC AND TECHNICAL CENTER ZASLON`).
- **Mesmas palavras em outra ordem** (ordenadas iguais): no mínimo **95**.
- **Penalidade de cobertura parcial:** se `cobertura < 1`, o score é multiplicado por `0,6 + 0,4 × cobertura`. Registro que explica só metade do nome não marca 100.
- `melhorSim` testa o nome principal e até 8 aliases e para ao atingir 99.

### Equivalência de palavras (`equivalente`)

Duas palavras são "a mesma" se iguais ou a 1 edição de distância (palavras de 4 a 7 letras) ou até 2 edições (8+ letras), desde que a diferença de tamanho caiba no limite. Palavra com menos de 4 letras exige igualdade. A distância de Levenshtein usa corte antecipado (`levLimitado`) para abandonar o cálculo quando passa do limite. Foi essa regra que eliminou o falso positivo `ali khamenei` × `khamis al khanjar`, que apareceu nos testes com a base real.

### Faixas (`faixa`)

| Score | Rótulo |
| --- | --- |
| 100 | exata |
| 92–99 | forte |
| 85–91 | provável |
| 70–84 | possível |
| < 70 | fraca |

### Pré-filtro (`prepara` / `candidatos`)

Comparar a consulta com 45 mil registros usando Jaro-Winkler e Dice seria caro, então há um filtro barato antes:

- Para cada registro (nome e aliases), até 12 tokens com 3+ letras viram **máscaras de 32 bits**: cada trigrama do token (FNV-1a) liga um bit. A máscara é **por palavra**, não por nome inteiro: uma máscara única satura em nomes longos e derruba a precisão.
- A consulta usa o token mais longo como alvo; a similaridade de máscaras é `popcount(consulta & token) / popcount(consulta)`.
- Passa quem contém a consulta como substring do nome normalizado, ou tem similaridade de máscara ≥ 0,2. Os 500 melhores candidatos seguem para o score completo.

### Busca por documento

Se a consulta tem pelo menos 4 caracteres e contém algum dígito, o app também varre os documentos publicados e inclui, com score **100**, todo registro cujo documento (apenas `[0-9a-z]`) **contém** o texto digitado. É correspondência por substring, não por igualdade: confira o documento completo antes de concluir.

### Explicabilidade (`explica`)

Devolve score, Jaro-Winkler, Dice, cobertura, palavras que casaram, palavras que faltaram e se houve só troca de ordem. É o que a ficha do resultado mostra em "por que casou".

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

A geração também produz `sitemap.xml` e `robots.txt`.

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
| `node tests/test_motor.js` | normalização, score (idêntico = 100, typos, nome parcial, ordem trocada, falsos positivos de palavra curta, nome sem relação < 60), busca na base real (acha Sberbank com erro, Zaslon, tempo < 1,5 s, existência de registros com documento) |
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
python3 tests/test_dados.py
node tests/test_manifesto.js
node src/vigilancia.js
python3 -m http.server -d docs 8000   # http://localhost:8000
```

Para reaproveitar os arquivos já baixados em `data/bruto/` durante o desenvolvimento: `REUSAR_BRUTO=1 python3 src/coleta.py` (vale para OFAC, ONU e UE; as fontes brasileiras sempre tentam baixar e caem no arquivo anterior se falharem).

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
- **Pré-filtro por token.** Máscara única por nome satura em nomes longos; por isso é por palavra.
- **Penalidade de cobertura parcial** e **palavra curta exige igualdade** existem para conter falsos positivos observados na base real.
- **Fallback para a carga anterior** prefere dado de ontem a base mutilada.
- **`docs/` fora do Git.** Dados derivados são recriados a cada build; só o estado que precisa de memória (`data/`) é versionado.
- **Nome do CSV.** `csv_nome` ainda é `sancoes-ofac-onu-ue-AAAA-MM-DD.csv`, nome herdado de quando só havia três fontes, embora hoje contenha também as brasileiras. O `subtitulo` do `config.json` tem o mesmo resquício.
- **Diff pode ser ruído.** UE e ONU reemitem revisões; um "novo" pode ser registro corrigido.

## Limites

- **Não é parecer jurídico** nem substitui a consulta à fonte oficial. Homônimos são comuns: score alto é indício a conferir, nunca conclusão.
- Da OFAC entra só a lista **SDN**; as demais (SSI, FSE etc.) não estão aqui. Para compliance formal, use a consolidated list completa do Tesouro.
- O **CNEP** não existe no espelho aberto usado; entraram Lista Suja, TCU e BCB no lugar. Para o CNEP oficial seria preciso a chave do Portal da Transparência.
- As fontes brasileiras dependem do espelho OpenSanctions: se ele mudar de formato ou sair do ar, essas fontes ficam com a carga anterior.
- A triagem em lote é apoio operacional, não processo de KYC.
- O manifesto prova integridade e anterioridade, não autoria.
- Cada registro traz o link da fonte: antes de decidir, confira documento, data de nascimento e país.

## Fontes oficiais

- OFAC SDN: https://www.treasury.gov/ofac/downloads/sdn.xml
- ONU: https://scsanctions.un.org/resources/xml/en/consolidated.xml
- União Europeia (FSF): https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content
- CEIS e PEP: https://portaldatransparencia.gov.br/download-de-dados
- Espelho OpenSanctions: https://data.opensanctions.org
