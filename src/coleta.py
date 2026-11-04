#!/usr/bin/env python3
"""Baixa e normaliza as listas de sancoes OFAC (EUA), ONU e UE.

Gera:
  data/sancoes.json   -> registros normalizados (fonte oficial de verdade)
  data/resumo.json    -> contagens, data de geracao e o que mudou desde a carga anterior
  data/ids.json       -> snapshot de ids para calcular o diff do dia seguinte
"""
import time
import json, os, re, sys, unicodedata, urllib.request
import xml.etree.ElementTree as ET

import fontes_br
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
TZ = timezone(timedelta(hours=-3))
UA = {"User-Agent": "Mozilla/5.0 (compatible; consulta-sancoes/1.0)"}

FONTES = {
    "ofac": "https://www.treasury.gov/ofac/downloads/sdn.xml",
    "un": "https://scsanctions.un.org/resources/xml/en/consolidated.xml",
    "eu": "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw",
}
PAGINA = {
    "ofac": "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=",
    "un": "https://scsanctions.un.org/search/?keywords=",
    "eu": "https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions",
}

def baixa(url, destino):
    if os.environ.get("REUSAR_BRUTO") == "1" and os.path.exists(destino) and os.path.getsize(destino) > 10000:
        return os.path.getsize(destino)
    ultimo = None
    for tentativa in range(3):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=180) as r:
                dados = r.read()
            if len(dados) < 1000:
                raise ValueError("resposta curta (%d bytes)" % len(dados))
            with open(destino, "wb") as f:
                f.write(dados)
            return len(dados)
        except Exception as exc:
            ultimo = exc
            time.sleep(5 * (tentativa + 1))
    # sem resposta depois de 3 tentativas: mantém o arquivo da carga anterior
    # em vez de zerar a fonte e publicar uma base incompleta
    if os.path.exists(destino) and os.path.getsize(destino) > 10000:
        print("AVISO: %s falhou (%s); usando o arquivo da carga anterior" % (url[:70], ultimo))
        return os.path.getsize(destino)
    raise ultimo

def sem_namespace(raiz):
    for el in raiz.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return raiz

def texto(el, tag):
    if el is None:
        return ""
    v = el.find(tag)
    if v is None or v.text is None:
        return ""
    return " ".join(v.text.split())

def normaliza(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^A-Za-z0-9 ]", " ", s.lower())
    return " ".join(s.split())

# ---------------- OFAC ----------------
def ofac(caminho):
    raiz = sem_namespace(ET.parse(caminho).getroot())
    saida = []
    for e in raiz.findall("sdnEntry"):
        uid = texto(e, "uid")
        # a OFAC separa primeiro nome e sobrenome: usar so o lastName gerava
        # registros como "PUTIN" e "KHAMENEI", que nao casavam com o nome completo
        primeiro = texto(e, "firstName")
        ultimo = texto(e, "lastName")
        nome = (primeiro + " " + ultimo).strip() if primeiro else ultimo
        if not nome:
            nome = primeiro
        tipo = (texto(e, "sdnType") or "").lower()
        tipo = {"individual": "pessoa", "entity": "entidade", "vessel": "embarcacao", "aircraft": "aeronave"}.get(tipo, "outro")
        programas = [p.text.strip() for p in e.findall("programList/program") if p.text]
        aliases = []
        for aka in e.findall("akaList/aka"):
            partes = [texto(aka, t) for t in ("firstName", "lastName")]
            partes = [p for p in partes if p]
            if partes:
                aliases.append(" ".join(partes))
        paises = []
        for a in e.findall("addressList/address"):
            c = texto(a, "country")
            if c and c not in paises:
                paises.append(c)
        docs = []
        LIXO = ("secondary sanctions", "sanctions information", "website", "email", "gender",
                "digital currency", "unknown", "remarks", "transactions prohibited",
                "owned or controlled")
        for i in e.findall("idList/id"):
            numero = texto(i, "idNumber")
            # cuidado: nao reaproveitar a variavel "tipo" (do sdnType) aqui dentro.
            # ate 03/11/2026 isso sobrescrevia o tipo da entidade e jogava 12.513
            # registros (47% da base) em baldes como "Secondary sanctions risk:".
            tipo_doc = texto(i, "idType") or "documento"
            # rotulo longo ou com cara de observacao nao e tipo de documento
            if numero and len(tipo_doc) <= 40 and not any(x in tipo_doc.lower() for x in LIXO):
                docs.append((tipo_doc + ": " + numero)[:60])
        nasc = [texto(d, "dateOfBirthItem") or texto(d, "dateOfBirth") for d in e.findall("dateOfBirthList/dateOfBirthItem")]
        nasc = [d for d in nasc if d]
        saida.append({
            "i": "ofac-" + uid, "f": "ofac", "t": tipo, "n": nome,
            "a": aliases[:12], "p": ", ".join(programas), "c": ", ".join(paises[:3]),
            "d": "", "u": PAGINA["ofac"] + uid, "x": ", ".join(nasc[:2]),
            "doc": docs[:4],
        })
    return saida

# ---------------- ONU ----------------
def onu(caminho):
    raiz = sem_namespace(ET.parse(caminho).getroot())
    saida = []
    for grupo, tipo in (("INDIVIDUALS/INDIVIDUAL", "pessoa"), ("ENTITIES/ENTITY", "entidade")):
        for e in raiz.findall(grupo):
            ref = texto(e, "REFERENCE_NUMBER")
            if tipo == "pessoa":
                partes = [texto(e, t) for t in ("FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME")]
                nome = " ".join([p for p in partes if p])
            else:
                nome = texto(e, "FIRST_NAME")
            if not nome:
                continue
            aliases = [texto(a, "ALIAS_NAME") for a in e.findall("INDIVIDUAL_ALIAS")] if tipo == "pessoa" else []
            aliases = [a for a in aliases if a]
            paises = []
            for nat in e.findall("NATIONALITY/VALUE"):
                if nat.text:
                    paises.append(nat.text.strip())
            if tipo == "entidade":
                for nat in e.findall("ENTITY_ADDRESS/COUNTRY"):
                    if nat.text:
                        paises.append(nat.text.strip())
            docs = []
            for d in e.findall("INDIVIDUAL_DOCUMENT"):
                numero = texto(d, "NUMBER")
                tipo_doc = texto(d, "TYPE_OF_DOCUMENT") or "documento"
                if numero:
                    docs.append((tipo_doc + ": " + numero)[:60])
            lista = texto(e, "LIST_TYPE/VALUE") or ""
            saida.append({
                "i": "un-" + (ref or normaliza(nome)), "f": "un", "t": tipo, "n": nome,
                "a": aliases[:12], "p": lista or "Conselho de Seguranca da ONU",
                "c": ", ".join(dict.fromkeys(paises))[:80], "d": texto(e, "LISTED_ON"),
                "u": PAGINA["un"] + (ref or ""), "x": texto(e, "COMMENTS1")[:200],
                "doc": docs[:4],
            })
    return saida

# ---------------- UE ----------------
NS = ""
def ue(caminho):
    raiz = sem_namespace(ET.parse(caminho).getroot())
    saida = []
    for e in raiz.findall(NS + "sanctionEntity"):
        lid = e.get("logicalId") or ""
        sub = e.find(NS + "subjectType")
        codigo = (sub.get("classificationCode") if sub is not None else "") or ""
        tipo = {"P": "pessoa", "E": "entidade"}.get(codigo, "outro")
        nomes = []
        for na in e.findall(NS + "nameAlias"):
            w = (na.get("wholeName") or "").strip()
            if w:
                nomes.append(w)
        if not nomes:
            continue
        regs = [r.get("programme") for r in e.findall(NS + "regulation") if r.get("programme")]
        paises = []
        for c in e.findall(NS + "citizenship"):
            d = c.get("countryDescription") or c.get("countryIso2Code")
            if d:
                paises.append(d)
        for a in e.findall(NS + "address"):
            d = a.get("countryDescription")
            if d:
                paises.append(d)
        docs = []
        for ident in e.findall(NS + "identification"):
            numero = ident.get("number") or ""
            tipo_doc = ident.get("identificationTypeDescription") or ident.get("identificationTypeCode") or "documento"
            if numero:
                docs.append((tipo_doc + ": " + numero)[:60])
        nasc = []
        for b in e.findall(NS + "birthdate"):
            if b.get("birthdate"):
                nasc.append(b.get("birthdate"))
        saida.append({
            "i": "eu-" + lid, "f": "eu", "t": tipo, "n": nomes[0], "a": nomes[1:12],
            "p": ", ".join(dict.fromkeys(regs)) or "Uniao Europeia",
            "c": ", ".join(dict.fromkeys(paises))[:80],
            "d": (e.find(NS + "regulation").get("publicationDate") if e.find(NS + "regulation") is not None else "") or "",
            "u": PAGINA["eu"], "x": ", ".join(nasc[:2]), "doc": docs[:4],
        })
    return saida

def main():
    os.makedirs(DATA, exist_ok=True)
    bruto = os.path.join(DATA, "bruto")
    os.makedirs(bruto, exist_ok=True)
    arquivos = {"ofac": "sdn.xml", "un": "un.xml", "eu": "eu.xml"}
    tamanhos = {}
    for chave, url in FONTES.items():
        destino = os.path.join(bruto, arquivos[chave])
        try:
            tamanhos[chave] = baixa(url, destino)
        except Exception as exc:
            print("FALHA ao baixar %s: %s" % (chave, exc))

    registros, contagem = [], {}
    for chave, parser in (("ofac", ofac), ("un", onu), ("eu", ue)):
        caminho = os.path.join(bruto, arquivos[chave])
        if not os.path.exists(caminho):
            contagem[chave] = 0
            continue
        try:
            lista = parser(caminho)
        except Exception as exc:
            print("FALHA ao ler %s: %s" % (chave, exc))
            lista = []
        contagem[chave] = len(lista)
        registros.extend(lista)

    # Fontes brasileiras: CEIS, Lista Suja, TCU e BCB entram no índice principal;
    # o PEP (106 mil nomes) fica num arquivo à parte, carregado só quando o usuário pedir.
    try:
        for chave_br, slug_br, programa_br, oficial_br in fontes_br.FONTES:
            destino_br = os.path.join(bruto, slug_br + ".csv")
            if fontes_br.baixa(slug_br, destino_br):
                lista_br = fontes_br.le(chave_br, programa_br, oficial_br, destino_br)
                contagem[chave_br] = contagem.get(chave_br, 0) + len(lista_br)
                registros.extend(lista_br)
                print("%s: %d registros" % (chave_br, len(lista_br)))
        chave_pep, slug_pep, programa_pep, oficial_pep = fontes_br.PEP
        caminho_pep = os.path.join(bruto, slug_pep + ".csv")
        if fontes_br.baixa(slug_pep, caminho_pep):
            lista_pep = fontes_br.le(chave_pep, programa_pep, oficial_pep, caminho_pep)
            json.dump(lista_pep, open(os.path.join(DATA, "pep.json"), "w", encoding="utf-8"),
                      ensure_ascii=False, separators=(",", ":"))
            print("pep: %d registros em dados/pep.json" % len(lista_pep))
    except Exception as exc:
        print("FALHA nas fontes brasileiras: %s" % exc)

    # dedup por id
    vistos, limpos = set(), []
    for r in registros:
        if r["i"] in vistos:
            continue
        vistos.add(r["i"])
        limpos.append(r)

    # a contagem por fonte sai do que sobrou depois da dedup, senão não fecha com o arquivo
    contagem = {}
    for r in limpos:
        contagem[r["f"]] = contagem.get(r["f"], 0) + 1

    anterior = {}
    caminho_ids = os.path.join(DATA, "ids.json")
    if os.path.exists(caminho_ids):
        try:
            anterior = set(json.load(open(caminho_ids, encoding="utf-8")))
        except Exception:
            anterior = set()

    novos = [r for r in limpos if r["i"] not in anterior] if anterior else []
    removidos = sorted(anterior - {r["i"] for r in limpos}) if anterior else []

    agora = datetime.now(TZ)
    resumo = {
        "gerado_em": agora.strftime("%Y-%m-%dT%H:%M:%S-03:00"),
        "gerado_em_br": agora.strftime("%d/%m/%Y as %H:%M"),
        "total": len(limpos),
        "por_fonte": contagem,
        "novos_total": len(novos),
        "removidos_total": len(removidos),
        "novos": [{"n": r["n"], "f": r["f"], "t": r["t"], "p": r["p"], "i": r["i"]} for r in novos[:60]],
        "removidos": removidos[:60],
        "tamanho_fontes_bytes": tamanhos,
        "primeira_carga": not anterior,
    }
    caminho_hist = os.path.join(DATA, "historico.json")
    historico = []
    if os.path.exists(caminho_hist):
        try:
            historico = json.load(open(caminho_hist, encoding="utf-8"))
        except Exception:
            historico = []
    if not resumo["primeira_carga"]:
        historico.append({
            "data": agora.strftime("%Y-%m-%d"),
            "hora": agora.strftime("%H:%M"),
            "novos": len(novos),
            "removidos": len(removidos),
            "total": len(limpos),
            "nomes": [{"n": r["n"], "f": r["f"], "p": r["p"]} for r in novos[:25]],
        })
        historico = historico[-120:]
        json.dump(historico, open(caminho_hist, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    json.dump(limpos, open(os.path.join(DATA, "sancoes.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(resumo, open(os.path.join(DATA, "resumo.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(sorted(vistos), open(caminho_ids, "w", encoding="utf-8"), separators=(",", ":"))

    print("total: %d | %s" % (len(limpos), contagem))
    print("novos desde a carga anterior: %d | removidos: %d" % (len(novos), len(removidos)))
    print("arquivo: %.1f MB" % (os.path.getsize(os.path.join(DATA, "sancoes.json")) / 1e6))

if __name__ == "__main__":
    main()
