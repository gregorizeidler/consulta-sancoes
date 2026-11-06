# -*- coding: utf-8 -*-
"""Fontes acrescentadas depois das três primeiras: UK (OFSI/FCDO), OFAC não-SDN e CNEP.

Caminhos verificados em 06/11/2026, de um ambiente sem chave nem navegador:
  ofacns: oficial OK  (treasury.gov/ofac/downloads/consolidated/consolidated.xml, mesmo esquema do sdn.xml)
          espelho OK  (OpenSanctions us_ofac_cons) — só entra se o oficial falhar ou mudar de formato
  uk:     oficial OK  (sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml)
          espelho OK  (OpenSanctions gb_fcdo_sanctions) — idem
  cnep:   API oficial exige chave (401 sem ela). NUNCA foi testada com chave real: o mapeamento
          dos campos abaixo segue a documentação da API e é defensivo; se o formato divergir,
          a validação de esquema descarta a resposta e a fonte é pulada com aviso.
"""
import json
import os
import re
import time
import urllib.request
import xml.etree.ElementTree as ET

import fontes_br
from fontes_br import ErroEsquema

URL_OFACNS = "https://www.treasury.gov/ofac/downloads/consolidated/consolidated.xml"
URL_UK = "https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml"
PAGINA_UK = "https://www.gov.uk/government/publications/the-uk-sanctions-list"
PAGINA_OFACNS = "https://sanctionssearch.ofac.treas.gov/Details.aspx?id="
OFICIAL_OFACNS = "https://ofac.treasury.gov/consolidated-sanctions-list-non-sdn-lists"
API_CNEP = "https://api.portaldatransparencia.gov.br/api-de-dados/cnep"
OFICIAL_CNEP = "https://portaldatransparencia.gov.br/download-de-dados/cnep"
ESPELHO_OFACNS = "us_ofac_cons"
ESPELHO_UK = "gb_fcdo_sanctions"
CHAVE_ENV = "PORTAL_TRANSPARENCIA_KEY"


def _local(tag):
    return tag.split("}", 1)[1] if "}" in tag else tag


def valida_xml(raiz, registros, obrigatorios, minimo=1, amostra=50):
    """Percorre o XML inteiro em streaming: raiz esperada, registros nos caminhos dados e
    elementos obrigatórios presentes em pelo menos 80% dos primeiros registros.
    Cada obrigatório pode ter alternativas separadas por '|'."""
    def valida(caminho):
        pilha, achados, bons = [], 0, {o: 0 for o in obrigatorios}
        try:
            for evento, el in ET.iterparse(caminho, events=("start", "end")):
                tag = _local(el.tag)
                if evento == "start":
                    if not pilha and tag != raiz:
                        raise ErroEsquema("elemento raiz '%s', esperado '%s'" % (tag, raiz))
                    pilha.append(tag)
                    continue
                rel = "/".join(pilha[1:])
                pilha.pop()
                if rel in registros:
                    achados += 1
                    if achados <= amostra:
                        filhos = {_local(c.tag) for c in el} | set(el.attrib)
                        for o in obrigatorios:
                            if filhos & set(o.split("|")):
                                bons[o] += 1
                    el.clear()
        except ET.ParseError as exc:
            raise ErroEsquema("XML malformado ou truncado: %s" % exc)
        if achados < minimo:
            raise ErroEsquema("nenhum registro em %s" % "/".join(sorted(registros)))
        visto = min(achados, amostra)
        ruins = [o for o, n in bons.items() if n < 0.8 * visto]
        if ruins:
            raise ErroEsquema("elementos obrigatórios ausentes: " + ", ".join(ruins))
    return valida


valida_ofac = valida_xml("sdnList", {"sdnEntry"}, ("uid", "sdnType", "lastName|firstName"))
valida_onu = valida_xml("CONSOLIDATED_LIST", {"INDIVIDUALS/INDIVIDUAL", "ENTITIES/ENTITY"},
                        ("REFERENCE_NUMBER", "FIRST_NAME"))
valida_ue = valida_xml("export", {"sanctionEntity"}, ("logicalId", "subjectType", "nameAlias"))
valida_uk = valida_xml("Designations", {"Designation"}, ("UniqueID", "Names", "IndividualEntityShip"))


def _t(el, tag):
    v = el.find(tag) if el is not None else None
    return " ".join(v.text.split()) if v is not None and v.text else ""


def _data_uk(valor):
    """dd/mm/aaaa -> aaaa-mm-dd; 'dd/mm/1968' (dia e mês desconhecidos) -> '1968'."""
    m = re.match(r"^(\d{2}|dd)/(\d{2}|mm)/(\d{4})$", (valor or "").strip())
    if not m:
        return (valor or "").strip()
    d, mes, ano = m.groups()
    if mes == "mm":
        return ano
    return "%s-%s" % (ano, mes) if d == "dd" else "%s-%s-%s" % (ano, mes, d)


def _programa_uk(regime):
    r = re.sub(r"\s*\(EU Exit\)", "", regime or "")
    r = re.sub(r"\s+Regulations\s+\d{4}$", "", r)
    return re.sub(r"^The\s+", "", r).strip() or "Reino Unido"


def uk(caminho):
    saida = []
    for e in ET.parse(caminho).getroot().findall("Designation"):
        uid = _t(e, "UniqueID")
        primario, outros = "", []
        for nm in e.findall("Names/Name"):
            partes = [_t(nm, "Name%d" % i) for i in range(1, 7)]
            nome = " ".join(p for p in partes if p)
            if not nome:
                continue
            if not primario and _t(nm, "NameType").lower() == "primary name":
                primario = nome
            else:
                outros.append(nome)
        if not uid or not (primario or outros):
            continue
        if not primario:
            primario = outros.pop(0)
        tipo = {"individual": "pessoa", "entity": "entidade", "ship": "embarcacao"}.get(
            _t(e, "IndividualEntityShip").lower(), "outro")
        paises = [p.text.strip() for p in e.findall("IndividualDetails/Individual/Nationalities/Nationality") if p.text]
        paises += [p.text.strip() for p in e.findall("Addresses/Address/AddressCountry") if p.text]
        docs = []
        for p in e.findall("IndividualDetails/Individual/PassportDetails/Passport"):
            if _t(p, "PassportNumber"):
                docs.append("Passport: " + _t(p, "PassportNumber"))
        for p in e.findall("IndividualDetails/Individual/NationalIdentifierDetails/NationalIdentifier"):
            if _t(p, "NationalIdentifierNumber"):
                docs.append("National ID: " + _t(p, "NationalIdentifierNumber"))
        for p in e.findall("EntityDetails/Entity/BusinessRegistrationNumbers/BusinessRegistrationNumber"):
            if p.text and p.text.strip():
                docs.append("Registration no.: " + " ".join(p.text.split()))
        for p in e.findall("ShipDetails/Ship/IMONumbers/IMONumber"):
            if p.text and p.text.strip():
                docs.append("IMO: " + re.sub(r"^IMO\s*", "", p.text.strip()))
        nasc = [_data_uk(d.text) for d in e.findall("IndividualDetails/Individual/DOBs/DOB") if d.text]
        saida.append({
            "i": "uk-" + uid, "f": "uk", "t": tipo, "n": primario,
            "a": list(dict.fromkeys(outros))[:12],
            "p": _programa_uk(_t(e, "RegimeName")),
            "c": ", ".join(dict.fromkeys(paises))[:80],
            "d": _data_uk(_t(e, "DateDesignated")), "u": PAGINA_UK,
            "x": ", ".join(dict.fromkeys(nasc))[:40],
            "doc": [d[:60] for d in dict.fromkeys(docs)][:4],
        })
    return saida


def le_espelho_ofacns(caminho):
    return fontes_br.le("ofacns", "OFAC - Lista consolidada não-SDN", OFICIAL_OFACNS, caminho,
                        programa_da_linha=True)


def le_espelho_uk(caminho):
    return fontes_br.le("uk", "Reino Unido", PAGINA_UK, caminho, programa_da_linha=True)


def sem_sdn(lista, ids_sdn, nomes_sdn=None):
    """Tira da lista não-SDN o que já está na SDN. Pelo uid quando a fonte é a oficial;
    pelo nome normalizado quando veio do espelho, que não traz o uid da OFAC."""
    ids_sdn = set(ids_sdn)
    saida = []
    for r in lista:
        uid = r["i"].split("-", 1)[1]
        if r["i"].startswith("ofacns-NK-"):
            if nomes_sdn is not None and _norm(r["n"]) in nomes_sdn:
                continue
        elif uid in ids_sdn:
            continue
        saida.append(r)
    return saida


def _norm(s):
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", (s or "").lower()).split())


def nomes_normalizados(registros):
    return {_norm(r["n"]) for r in registros}


def uids_sdn(registros):
    return {r["i"].split("-", 1)[1] for r in registros if r["f"] == "ofac"}


# ---------------- CNEP (API oficial, opcional) ----------------
def valida_cnep(caminho):
    try:
        dados = json.load(open(caminho, encoding="utf-8"))
    except ValueError as exc:
        raise ErroEsquema("JSON inválido: %s" % exc)
    if not isinstance(dados, list) or not dados:
        raise ErroEsquema("resposta do CNEP vazia ou não é uma lista")
    if not all(isinstance(d, dict) for d in dados):
        raise ErroEsquema("itens do CNEP não são objetos")
    bons = sum(1 for d in dados[:50] if isinstance(d.get("sancionado") or d.get("pessoa"), dict))
    if bons < 0.8 * min(len(dados), 50):
        raise ErroEsquema("itens do CNEP sem 'sancionado'/'pessoa'")


def _pega_json(url, chave_api, tentativas=3):
    ultimo = None
    for tentativa in range(tentativas):
        try:
            req = urllib.request.Request(url, headers=dict(
                fontes_br.UA, **{"chave-api-dados": chave_api, "Accept": "application/json"}))
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as exc:
            ultimo = exc
            time.sleep(5 * (tentativa + 1))
    raise ultimo


def baixa_cnep(chave_api, destino, limite_paginas=500, pausa=0.8):
    """Pagina a API e grava o JSON bruto. Levanta em qualquer falha; o chamador decide."""
    todos = []
    for pagina in range(1, limite_paginas + 1):
        itens = _pega_json("%s?pagina=%d" % (API_CNEP, pagina), chave_api)
        if not itens:
            break
        if not isinstance(itens, list):
            raise ErroEsquema("resposta da página %d não é uma lista" % pagina)
        todos.extend(itens)
        time.sleep(pausa)
    novo = destino + ".novo"
    with open(novo, "w", encoding="utf-8") as f:
        json.dump(todos, f, ensure_ascii=False, separators=(",", ":"))
    try:
        valida_cnep(novo)
    except ErroEsquema:
        os.remove(novo)
        raise
    os.replace(novo, destino)
    return {"origem": "oficial", "destino": destino, "bytes": os.path.getsize(destino),
            "sha256": fontes_br.sha256_arquivo(destino), "avisos": []}


def _cache_cnep(destino, avisos):
    return {"origem": "cache", "destino": destino, "bytes": os.path.getsize(destino),
            "sha256": fontes_br.sha256_arquivo(destino), "avisos": avisos}


def obtem_cnep(destino):
    """Devolve o dict de obtem() ou None quando a fonte deve ser pulada. Com a chave ausente
    pula em silêncio (uma linha de log); com API falhando usa o arquivo anterior, se houver,
    e registra aviso — nunca derruba o build."""
    chave = os.environ.get(CHAVE_ENV, "").strip()
    if not chave:
        print("cnep: %s ausente; fonte opcional pulada" % CHAVE_ENV)
        return None
    existe = os.path.exists(destino) and os.path.getsize(destino) > fontes_br.MINIMO_BYTES
    try:
        if os.environ.get("REUSAR_BRUTO") == "1" and existe:
            valida_cnep(destino)
            return _cache_cnep(destino, [])
        return baixa_cnep(chave, destino)
    except ErroEsquema as exc:
        aviso = "cnep: esquema inesperado na API: %s" % exc
    except Exception as exc:
        aviso = "cnep: API falhou: %s" % str(exc)[:120]
    print("AVISO: " + aviso)
    if existe:
        try:
            valida_cnep(destino)
            return _cache_cnep(destino, [aviso, "cnep: usando o arquivo da carga anterior"])
        except ErroEsquema:
            pass
    return {"origem": None, "destino": None, "bytes": 0, "sha256": "", "avisos": [aviso]}


def _data_br(valor):
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})", (valor or "").strip())
    if m:
        return "%s-%s-%s" % (m.group(3), m.group(2), m.group(1))
    return (valor or "").strip()[:10]


def le_cnep(caminho):
    saida = []
    for d in json.load(open(caminho, encoding="utf-8")):
        pessoa = d.get("pessoa") if isinstance(d.get("pessoa"), dict) else {}
        sanc = d.get("sancionado") if isinstance(d.get("sancionado"), dict) else {}
        nome = " ".join((sanc.get("nome") or pessoa.get("nome") or pessoa.get("razaoSocialReceita") or "").split())
        if not nome:
            continue
        bruto_doc = (pessoa.get("cnpjFormatado") or pessoa.get("cpfFormatado")
                     or sanc.get("codigoFormatado") or "")
        doc = fontes_br.documento(bruto_doc)
        fisica = "fís" in (pessoa.get("tipo") or "").lower() or doc.startswith("CPF")
        alias = [" ".join(a.split()) for a in (pessoa.get("razaoSocialReceita"), pessoa.get("nomeFantasiaReceita"),
                                                d.get("nomeInformadoOrgaoSancionador")) if a]
        resumo = (d.get("tipoSancao") or {}).get("descricaoResumida") if isinstance(d.get("tipoSancao"), dict) else ""
        ident = d.get("id") if d.get("id") is not None else (doc or nome)
        saida.append({
            "i": "cnep-" + str(ident)[:40], "f": "cnep", "t": "pessoa" if fisica else "entidade",
            "n": nome, "a": [a for a in dict.fromkeys(alias) if a != nome and len(a) > 2][:12],
            "p": "CNEP - Empresas Punidas (CGU)" + (" - " + resumo if resumo else ""),
            "c": "BR", "d": _data_br(d.get("dataInicioSancao")), "u": OFICIAL_CNEP,
            "x": "", "doc": [doc] if doc else [],
        })
    return saida
