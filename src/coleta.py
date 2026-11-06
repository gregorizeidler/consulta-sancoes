#!/usr/bin/env python3
"""Baixa e normaliza as listas de sancoes: OFAC (SDN e nao-SDN), ONU, UE, Reino Unido,
CEIS, Lista Suja, TCU, BCB, CNEP (opcional) e PEP.

Gera:
  data/sancoes.json   -> registros normalizados (fonte oficial de verdade)
  data/resumo.json    -> contagens, origem/data de carga por fonte, avisos e o que mudou
  data/ids.json       -> snapshot de ids para calcular o diff do dia seguinte

Cada arquivo baixado passa por validacao de esquema antes de substituir o da carga anterior.
Queda de mais de 30% no total de uma fonte derruba a coleta (exit 1), salvo PERMITIR_QUEDA=1.
"""
import hashlib, json, os, re, sys, unicodedata, urllib.request
import xml.etree.ElementTree as ET

import fontes_br
import fontes_extra
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
def ofac(caminho, chave="ofac"):
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
            "i": chave + "-" + uid, "f": chave, "t": tipo, "n": nome,
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

LIMITE_QUEDA = 0.30
GRAVIDADE = {"oficial": 0, "espelho": 1, "cache": 2}


def confere_quedas(atual, anterior, dispensadas=()):
    """Compara a contagem por fonte com a da carga anterior; devolve as mensagens de queda."""
    erros = []
    for chave, antes in anterior.items():
        if chave in dispensadas or not antes:
            continue
        agora = atual.get(chave, 0)
        if agora < antes * (1 - LIMITE_QUEDA):
            erros.append("%s caiu %d%% (%d -> %d registros)" % (chave, round(100 * (antes - agora) / antes), antes, agora))
    return erros


def agrega(metas):
    """Junta os arquivos de uma mesma fonte (ex.: dois datasets do TCU) num so registro."""
    origem = max((m["origem"] for m in metas), key=lambda o: GRAVIDADE[o])
    sha = metas[0]["sha256"] if len(metas) == 1 else hashlib.sha256(
        "".join(m["sha256"] for m in metas).encode()).hexdigest()
    return {"origem": origem, "bytes": sum(m["bytes"] for m in metas), "sha256": sha,
            "destinos": [m["destino"] for m in metas]}


def carrega_xml(chave, arquivo, url, valida, espelho, bruto):
    """Oficial primeiro; se falhar ou mudar de formato, espelho; por ultimo o arquivo anterior."""
    candidatos = [("oficial", url, os.path.join(bruto, arquivo), valida)]
    if espelho:
        slug = espelho[0]
        candidatos.append(("espelho", fontes_br.ESPELHO % slug, os.path.join(bruto, slug + ".csv"), fontes_br.valida_csv))
    return fontes_br.obtem(candidatos, chave)


def main():
    os.makedirs(DATA, exist_ok=True)
    bruto = os.path.join(DATA, "bruto")
    os.makedirs(bruto, exist_ok=True)
    agora = datetime.now(TZ)
    hoje = agora.strftime("%Y-%m-%d")
    avisos, metas, listas = [], {}, {}

    anterior_resumo = {}
    caminho_resumo = os.path.join(DATA, "resumo.json")
    if os.path.exists(caminho_resumo):
        try:
            anterior_resumo = json.load(open(caminho_resumo, encoding="utf-8"))
        except Exception:
            anterior_resumo = {}
    info_anterior = anterior_resumo.get("fontes_info", {})

    xml = [
        ("ofac", "sdn.xml", ofac, fontes_extra.valida_ofac, None, None),
        ("un", "un.xml", onu, fontes_extra.valida_onu, None, None),
        ("eu", "eu.xml", ue, fontes_extra.valida_ue, None, None),
        ("ofacns", "consolidated.xml", lambda c: ofac(c, "ofacns"), fontes_extra.valida_ofac,
         (fontes_extra.ESPELHO_OFACNS, fontes_extra.le_espelho_ofacns), fontes_extra.URL_OFACNS),
        ("uk", "uk.xml", fontes_extra.uk, fontes_extra.valida_uk,
         (fontes_extra.ESPELHO_UK, fontes_extra.le_espelho_uk), fontes_extra.URL_UK),
    ]
    for chave, arquivo, parser, valida, espelho, url in xml:
        try:
            meta = carrega_xml(chave, arquivo, url or FONTES[chave], valida, espelho, bruto)
        except Exception as exc:
            print("FALHA ao baixar %s: %s" % (chave, exc))
            avisos.append("%s: sem arquivo utilizavel (%s)" % (chave, str(exc)[:200]))
            continue
        avisos.extend(meta["avisos"])
        meta = dict(meta, destinos=[meta["destino"]])
        leitor = espelho[1] if espelho and meta["destino"].endswith(".csv") else parser
        try:
            lista = leitor(meta["destino"])
        except Exception as exc:
            print("FALHA ao ler %s: %s" % (chave, exc))
            avisos.append("%s: falha ao ler o arquivo (%s)" % (chave, str(exc)[:200]))
            lista = []
        metas[chave], listas[chave] = meta, lista

    if "ofacns" in listas and "ofac" in listas:
        antes = len(listas["ofacns"])
        listas["ofacns"] = fontes_extra.sem_sdn(
            listas["ofacns"], fontes_extra.uids_sdn(listas["ofac"]),
            fontes_extra.nomes_normalizados(listas["ofac"]))
        print("ofacns: %d registros, %d ja estavam na SDN" % (len(listas["ofacns"]), antes - len(listas["ofacns"])))

    # Fontes brasileiras: CEIS, Lista Suja, TCU e BCB entram no indice principal;
    # o PEP (106 mil nomes) fica num arquivo a parte, carregado so quando o usuario pedir.
    lista_pep = None
    try:
        agrupadas = {}
        for chave_br, slug_br, programa_br, oficial_br in fontes_br.FONTES:
            agrupadas.setdefault(chave_br, []).append((slug_br, programa_br, oficial_br))
        for chave_br, itens in agrupadas.items():
            m_br, lista_br = [], []
            try:
                for slug_br, programa_br, oficial_br in itens:
                    meta_br = fontes_br.baixa(slug_br, os.path.join(bruto, slug_br + ".csv"))
                    avisos.extend(meta_br["avisos"])
                    m_br.append(meta_br)
                    lista_br.extend(fontes_br.le(chave_br, programa_br, oficial_br, meta_br["destino"]))
            except Exception as exc:
                print("FALHA em %s: %s" % (chave_br, exc))
                avisos.append("%s: sem arquivo utilizavel (%s)" % (chave_br, str(exc)[:200]))
                continue
            metas[chave_br], listas[chave_br] = agrega(m_br), lista_br
            print("%s: %d registros" % (chave_br, len(lista_br)))
        chave_pep, slug_pep, programa_pep, oficial_pep = fontes_br.PEP
        try:
            meta_pep = fontes_br.baixa(slug_pep, os.path.join(bruto, slug_pep + ".csv"))
            avisos.extend(meta_pep["avisos"])
            lista_pep = fontes_br.le(chave_pep, programa_pep, oficial_pep, meta_pep["destino"])
            metas[chave_pep] = agrega([meta_pep])
            print("pep: %d registros em dados/pep.json" % len(lista_pep))
        except Exception as exc:
            print("FALHA em pep: %s" % exc)
            avisos.append("pep: sem arquivo utilizavel (%s)" % str(exc)[:200])
    except Exception as exc:
        print("FALHA nas fontes brasileiras: %s" % exc)
        avisos.append("fontes brasileiras: %s" % str(exc)[:200])

    # CNEP so entra com PORTAL_TRANSPARENCIA_KEY; sem a chave a fonte e pulada.
    dispensadas = set()
    caminho_cnep = os.path.join(bruto, "cnep.json")
    try:
        meta_cnep = fontes_extra.obtem_cnep(caminho_cnep)
        if meta_cnep is None:
            dispensadas.add("cnep")
        else:
            avisos.extend(meta_cnep["avisos"])
            if meta_cnep["origem"] is None:
                dispensadas.add("cnep")
            else:
                metas["cnep"] = agrega([meta_cnep])
                listas["cnep"] = fontes_extra.le_cnep(caminho_cnep)
                print("cnep: %d registros" % len(listas["cnep"]))
    except Exception as exc:
        dispensadas.add("cnep")
        print("AVISO: cnep ignorado (%s)" % exc)
        avisos.append("cnep: ignorado (%s)" % str(exc)[:200])

    ordem = ["ofac", "un", "eu", "ceis", "slavery", "tcu", "bcb", "ofacns", "uk", "cnep"]
    registros = [r for k in ordem for r in listas.get(k, [])]

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
    contagem_atual = dict(contagem)
    if lista_pep is not None:
        contagem_atual["pep"] = len(lista_pep)

    esperado = dict(anterior_resumo.get("por_fonte", {}))
    if "pep" in info_anterior:
        esperado["pep"] = info_anterior["pep"].get("registros", 0)
    quedas = confere_quedas(contagem_atual, esperado, dispensadas)
    if quedas:
        if os.environ.get("PERMITIR_QUEDA") == "1":
            avisos.extend("queda liberada por PERMITIR_QUEDA=1: " + q for q in quedas)
            print("AVISO: " + "; ".join(quedas) + " (liberado por PERMITIR_QUEDA=1)")
        else:
            print("ERRO: queda de mais de %d%% em relacao a carga anterior; nada foi publicado:" % (LIMITE_QUEDA * 100))
            for q in quedas:
                print("  - " + q)
            print("Se a queda for legitima, rode de novo com PERMITIR_QUEDA=1.")
            sys.exit(1)

    anterior = {}
    caminho_ids = os.path.join(DATA, "ids.json")
    if os.path.exists(caminho_ids):
        try:
            anterior = set(json.load(open(caminho_ids, encoding="utf-8")))
        except Exception:
            anterior = set()

    # fonte que aparece pela primeira vez nao entra como "novos": seriam milhares de falsas inclusoes
    if anterior:
        conhecidas = {i.split("-", 1)[0] for i in anterior}
        for chave in sorted(contagem):
            if chave not in conhecidas:
                print("fonte nova nesta carga: %s (%d registros, fora da contagem de novos)" % (chave, contagem[chave]))
        novos = [r for r in limpos if r["i"] not in anterior and r["f"] in conhecidas]
    else:
        novos = []
    removidos = sorted(anterior - {r["i"] for r in limpos}) if anterior else []

    fontes_info = {}
    for chave, meta in metas.items():
        origem = meta["origem"]
        if origem == "cache":
            ant = info_anterior.get(chave, {})
            data = ant.get("carregado_em") if ant.get("sha256") == meta["sha256"] else None
            data = data or fontes_br.data_de(meta["destinos"][0])
        else:
            data = hoje
        fontes_info[chave] = {"carregado_em": data, "origem": origem,
                              "registros": contagem_atual.get(chave, 0),
                              "bytes": meta["bytes"], "sha256": meta["sha256"]}
        if origem == "cache":
            avisos.append("%s: dados de %s (nao foi possivel atualizar hoje)" % (chave, data[8:] + "/" + data[5:7]))

    tamanhos = {k: v["bytes"] for k, v in fontes_info.items() if k in ("ofac", "un", "eu")}
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
        "fontes_info": fontes_info,
        "avisos": list(dict.fromkeys(avisos)),
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

    if lista_pep is not None:
        json.dump(lista_pep, open(os.path.join(DATA, "pep.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))
    json.dump(limpos, open(os.path.join(DATA, "sancoes.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(resumo, open(caminho_resumo, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(sorted(vistos), open(caminho_ids, "w", encoding="utf-8"), separators=(",", ":"))

    print("total: %d | %s" % (len(limpos), contagem))
    print("novos desde a carga anterior: %d | removidos: %d" % (len(novos), len(removidos)))
    for a in resumo["avisos"]:
        print("AVISO: " + a)
    print("arquivo: %.1f MB" % (os.path.getsize(os.path.join(DATA, "sancoes.json")) / 1e6))

if __name__ == "__main__":
    main()
