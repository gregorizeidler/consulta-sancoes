# Consulta de Sanções

Consulta e **triagem** nas três listas de sanções mais usadas no Brasil, direto das fontes oficiais.

| Fonte | Origem | Registros |
| --- | --- | --- |
| OFAC (EUA) | Tesouro dos Estados Unidos | 19.484 |
| ONU | Conselho de Segurança | 1.007 |
| União Europeia | Comissão Europeia (FSF) | 6.269 |
| **Total** | | **26.760** |

Site: https://gregorizeidler.github.io/consulta-sancoes

## O que tem além da busca

- **Busca difusa com score.** Cada resultado vem com percentual de similaridade (0–100%).
  Acha erro de digitação, ordem trocada, nome parcial dentro de nome oficial longo e diferença de acento.
- **Checagem por documento.** Passaporte, CPF/CNPJ, número de registro: 20.889 registros trazem documento
  publicado pela própria autoridade. Documento que bate exatamente vai direto para 100%.
- **Triagem em lote por CSV.** Sobe uma carteira de nomes (e documentos) e recebe o melhor resultado de cada
  linha, com o percentual, num CSV de saída. Roda no navegador: o arquivo não é enviado para servidor nenhum.
- **Lista de vigilância.** Nomes salvos no navegador (localStorage), verificados a cada visita.
- **Histórico de mudanças.** Todo dia o diff entre a carga atual e a anterior vira data/historico.json:
  dá para provar quando um nome entrou.
- **Presença cruzada.** O mesmo nome em mais de uma lista aparece marcado no resultado
  ("presente também em UE, ONU").
- **API estática.** JSON público, sem chave: dados/indice.json, dados/resumo.json,
  dados/historico.json, dados/listas-completas.zip.

## Motor de busca (site/motor.js)

Funções puras, sem DOM, testadas no Node (node tests/test_motor.js, 14 testes).

O score combina três medidas, cada uma cobrindo um tipo de erro:

| Medida | Peso | Para que serve |
| --- | --- | --- |
| Jaro-Winkler | 45% | erro de digitação, prefixo igual |
| Dice sobre trigramas | 35% | nome reordenado, pedaço faltando |
| Cobertura de tokens (tolerante a typo) | 20% | "ZASLON" dentro de "JSC SCIENTIFIC AND TECHNICAL CENTER ZASLON" |

Regras de reforço:

- nome idêntico depois da normalização → 100;
- todos os tokens da consulta presentes no registro → no mínimo 90;
- todos os tokens do registro presentes na consulta (consulta mais longa) → no mínimo 88;
- documento bate exatamente → 100.

Faixas: ≥95 exata · 85–94 provável · 70–84 possível · <70 fraca.

**Pré-filtro:** máscara de trigramas de 32 bits *por palavra* do registro. Uma máscara única para o nome
inteiro satura em nomes longos e derruba a precisão — por isso o índice é por token. Busca completa na
base real: **~46 ms** para 26.760 registros.

## Como funciona

- src/coleta.py baixa os XML oficiais e normaliza tudo em um formato único:
  id, nome, aliases, tipo, programa/regime, país, data, **documentos** e link da fonte.
- src/gera_site.py monta o site estático em docs/: índice compacto, planilha em zip e as páginas
  (busca, triagem em lote, mudanças, API).
- .github/workflows/atualizar.yml roda todo dia às 06:00 (Brasília): baixa, normaliza, gera, **roda os testes**
  e publica. Se um teste falhar, nada é publicado.
- A busca e a triagem são 100% no navegador: não há servidor, banco nem log de consulta.

## Formato do índice

dados/indice.json é uma lista de listas, para ficar pequeno:

    [id, nome, aliases, fonte, tipo, programa, país, data, link, detalhe, documentos, presente_em]

presente_em lista as outras fontes onde o mesmo nome normalizado aparece ("eu,on"), quando houver.

## Rodar local

    python3 src/coleta.py      # baixa ~57 MB das três fontes e normaliza
    python3 src/gera_site.py   # gera docs/
    node tests/test_motor.js   # testes do motor de busca
    python3 -m http.server -d docs 8000

Para reaproveitar os XML já baixados durante o desenvolvimento: REUSAR_BRUTO=1 python3 src/coleta.py.

## Limites (importante)

- **Não é parecer jurídico** e não substitui a consulta à fonte oficial. Homônimo é comum: nome igual
  não significa mesma pessoa. Um score alto é indício para conferir, nunca uma conclusão.
- A OFAC publica também as listas não-SDN (SSI, FSE, etc.). Aqui está só a SDN, a principal. Para compliance
  formal, consulte a consolidated list completa no site do Tesouro.
- UE e ONU republicam revisões: o que aparece como "novo" pode ser registro corrigido e reemitido.
- A triagem em lote é uma ajuda operacional, não um processo de KYC. A decisão e a base legal continuam
  sendo de quem usa.
- Cada registro traz o link para a fonte. Antes de decidir, abra e confira documento, data de nascimento e país.

## Fonte dos dados

- OFAC SDN: https://www.treasury.gov/ofac/downloads/sdn.xml
- ONU: https://scsanctions.un.org/resources/xml/en/consolidated.xml
- União Europeia: https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw
