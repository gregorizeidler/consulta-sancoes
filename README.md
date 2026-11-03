# Consulta de Sanções

Busca única nas três listas de sanções mais usadas no Brasil:

| Fonte | Origem | Registros |
| --- | --- | --- |
| OFAC (EUA) | Tesouro dos Estados Unidos | 19.484 |
| ONU | Conselho de Segurança | 1.007 |
| União Europeia | Comissão Europeia (FSF) | 6.269 |

Site: https://gregorizeidler.github.io/consulta-sancoes

## Como funciona

- src/coleta.py baixa os XML oficiais e normaliza tudo em um formato único:
  id, nome, aliases, tipo (pessoa, entidade, embarcação, aeronave), programa/regime, país, data e link da fonte.
- src/gera_site.py monta o site estático em docs/: índice compacto para busca, planilha em zip e as páginas.
- O workflow .github/workflows/atualizar.yml roda todo dia às 06:00 (Brasília): baixa, normaliza, gera e publica.
- A busca é 100% no navegador. O que a pessoa digita não sai do computador dela: não há servidor, banco nem log de consulta.

## O que o site mostra além da busca

- O que entrou nas últimas 24h: data/ids.json guarda o snapshot da carga anterior; a diferença vira a lista de novos e sai em data/resumo.json.
- Contagem por fonte, para conferir que nenhuma lista veio vazia ou truncada.
- Planilha completa em CSV dentro de docs/dados/listas-completas.zip.

## Rodar local

    python3 src/coleta.py      # baixa ~57 MB das três fontes e normaliza
    python3 src/gera_site.py   # gera docs/
    python3 -m http.server -d docs 8000

## Limites (importante)

- Isto não é parecer jurídico e não substitui a consulta à fonte oficial. Homônimo é comum: nome igual não significa mesma pessoa.
- A OFAC publica também as listas não-SDN (SSI, FSE, etc.). Aqui está só a SDN, que é a principal. Para compliance formal, consulte a consolidated list completa no site do Tesouro.
- A UE e a ONU republicam revisões; o que aparece como "novo" pode ser registro corrigido e reemitido, não necessariamente inclusão.
- Cada registro traz o link para a fonte. Antes de decidir qualquer coisa, abra o link e confira documento, data de nascimento e país.

## Fonte dos dados

- OFAC: https://www.treasury.gov/ofac/downloads/sdn.xml
- ONU: https://scsanctions.un.org/resources/xml/en/consolidated.xml
- UE: https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content
