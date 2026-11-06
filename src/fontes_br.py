# -*- coding: utf-8 -*-
"""Download validado e fontes brasileiras através do espelho aberto do OpenSanctions.

O download direto dos portais do governo devolve 403 para requisição que não é de
navegador, e a API oficial pede chave. O OpenSanctions republica as mesmas bases num CSV
aberto, com id estável por registro — é o caminho que funciona sem chave, e a fonte
oficial continua citada em cada linha.

Este módulo também guarda a infraestrutura comum de download: baixa para um arquivo
temporário, valida o esquema e só então troca o arquivo bom da carga anterior.
"""
import csv
import hashlib
import os
import re
import sys
import time
import urllib.request
from datetime import datetime

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

UA = {"User-Agent": "Mozilla/5.0 (compatible; consulta-sancoes/1.0)"}
ESPELHO = "https://data.opensanctions.org/datasets/latest/%s/targets.simple.csv"
MINIMO_BYTES = 500
COLUNAS_ESPELHO = ("id", "name", "aliases", "schema", "countries", "identifiers", "birth_date")

# (chave no site, dataset do espelho, nome do programa, fonte oficial)
FONTES = [
    ("ceis", "br_ceis", "CEIS - Empresas Inidôneas e Suspensas (CGU)",
     "https://portaldatransparencia.gov.br/download-de-dados/ceis"),
    ("slavery", "br_slavery", "Lista Suja do Trabalho Escravo (MTE)",
     "https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/areas-de-atuacao/cadastro-de-empregadores"),
    ("tcu", "br_tcu_debarred", "TCU - Empresas Inidôneas",
     "https://portal.tcu.gov.br/"),
    ("tcu", "br_tcu_disqualified", "TCU - Pessoas Inabilitadas",
     "https://portal.tcu.gov.br/"),
    ("bcb", "br_bcb_prohibited", "BCB - Proibidos de atuar",
     "https://www.bcb.gov.br/"),
    ("bcb", "br_bcb_disqualified_persons", "BCB - Pessoas Inabilitadas",
     "https://www.bcb.gov.br/"),
]
PEP = ("pep", "br_pep", "PEP - Pessoas Expostas Politicamente (CGU)",
       "https://portaldatransparencia.gov.br/download-de-dados/pep")

TIPO_ENTIDADE = ("organization", "company", "legalentity", "publicbody")
TIPO_ESPELHO = {"vessel": "embarcacao", "airplane": "aeronave", "aircraft": "aeronave"}
IGNORA_ESQUEMA = ("security", "cryptowallet")
CPF_MASCARADO = re.compile(r"^[\d*]{3}\.?[\d*]{3}\.?[\d*]{3}-?[\d*]{2}$")


class ErroEsquema(ValueError):
    """O arquivo baixou, mas não tem o formato esperado."""


def sha256_arquivo(caminho):
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for pedaco in iter(lambda: f.read(1 << 20), b""):
            h.update(pedaco)
    return h.hexdigest()


def data_de(caminho):
    return datetime.fromtimestamp(os.path.getmtime(caminho)).strftime("%Y-%m-%d")


def valida_csv(caminho, obrigatorias=COLUNAS_ESPELHO):
    with open(caminho, encoding="utf-8", errors="replace", newline="") as f:
        cabecalho = next(csv.reader(f), [])
        faltam = [c for c in obrigatorias if c not in cabecalho]
        if faltam:
            raise ErroEsquema("colunas ausentes no CSV: " + ", ".join(faltam))
        if next(f, None) is None:
            raise ErroEsquema("CSV sem nenhuma linha de dados")


def baixa_url(url, destino, tentativas=3, timeout=300):
    ultimo = None
    for tentativa in range(tentativas):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r, open(destino, "wb") as arquivo:
                for pedaco in iter(lambda: r.read(1 << 20), b""):
                    arquivo.write(pedaco)
            if os.path.getsize(destino) < MINIMO_BYTES:
                raise ValueError("resposta curta (%d bytes)" % os.path.getsize(destino))
            return os.path.getsize(destino)
        except Exception as exc:
            ultimo = exc
            time.sleep(5 * (tentativa + 1))
    raise ultimo


def obtem(candidatos, nome):
    """candidatos: [(origem, url, destino, valida)] em ordem de preferência. O primeiro que
    baixa e passa na validação vira o arquivo da carga. Se nenhum passar, fica o arquivo da
    carga anterior (origem "cache"). Devolve dict com origem, destino, bytes, sha256, avisos."""
    avisos = []
    existentes = [c for c in candidatos if os.path.exists(c[2]) and os.path.getsize(c[2]) > MINIMO_BYTES]
    existentes.sort(key=lambda c: os.path.getmtime(c[2]), reverse=True)
    if os.environ.get("REUSAR_BRUTO") == "1" and existentes:
        existentes[0][3](existentes[0][2])
        return _meta("cache", existentes[0][2], avisos)
    for origem, url, destino, valida in candidatos:
        novo = destino + ".novo"
        try:
            baixa_url(url, novo)
            valida(novo)
            os.replace(novo, destino)
            if origem != candidatos[0][0]:
                avisos.append("%s: fonte principal indisponível; carga pelo caminho '%s'" % (nome, origem))
            return _meta(origem, destino, avisos)
        except ErroEsquema as exc:
            avisos.append("%s (%s): esquema inesperado, arquivo descartado: %s" % (nome, origem, exc))
        except Exception as exc:
            avisos.append("%s (%s): download falhou: %s" % (nome, origem, str(exc)[:120]))
        finally:
            if os.path.exists(novo):
                os.remove(novo)
    for _, _, destino, valida in existentes:
        try:
            valida(destino)
        except ErroEsquema:
            continue
        avisos.append("%s: usando o arquivo da carga anterior" % nome)
        return _meta("cache", destino, avisos)
    raise RuntimeError("; ".join(avisos) or "sem arquivo para " + nome)


def _meta(origem, caminho, avisos):
    return {"origem": origem, "destino": caminho, "bytes": os.path.getsize(caminho),
            "sha256": sha256_arquivo(caminho), "avisos": avisos}


def baixa(slug, destino):
    """Baixa um dataset do espelho validando as colunas; devolve o dict de obtem()."""
    return obtem([("espelho", ESPELHO % slug, destino, valida_csv)], slug)


def formata_documento(valor):
    """CPF ou CNPJ sai com rotulo na frente, como nas outras fontes."""
    digitos = "".join(c for c in (valor or "") if c.isdigit())
    if len(digitos) == 11:
        return "CPF: %s.%s.%s-%s" % (digitos[:3], digitos[3:6], digitos[6:9], digitos[9:])
    if len(digitos) == 14:
        return "CNPJ: %s.%s.%s/%s-%s" % (digitos[:2], digitos[2:5], digitos[5:8], digitos[8:12], digitos[12:])
    return ""


def formata_cpf_mascarado(valor):
    """'***.123.456-**' vira 'CPF: ***.123.456-**', mantendo só os dígitos visíveis e as posições."""
    v = (valor or "").strip()
    if "*" not in v or not CPF_MASCARADO.match(v):
        return ""
    c = re.sub(r"[^\d*]", "", v)
    return "CPF: %s.%s.%s-%s" % (c[:3], c[3:6], c[6:9], c[9:])


def documento(valor):
    return formata_cpf_mascarado(valor) if "*" in (valor or "") else formata_documento(valor)


def le(chave, programa, oficial, caminho, programa_da_linha=False, prefixo_id=None):
    saida = []
    prefixo = (prefixo_id or chave) + "-"
    with open(caminho, encoding="utf-8", errors="replace", newline="") as f:
        for linha in csv.DictReader(f):
            nome = " ".join((linha.get("name") or "").split())
            esquema = (linha.get("schema") or "").lower()
            if not nome or esquema in IGNORA_ESQUEMA:
                continue
            aliases = [a.strip() for a in (linha.get("aliases") or "").replace(";", "|").split("|")
                       if len(a.strip()) > 2]
            brutos = [d.strip() for d in (linha.get("identifiers") or "").replace(";", "|").split("|")
                      if d.strip()]
            docs = list(dict.fromkeys(x for x in (documento(b) for b in brutos) if x))
            tipo = TIPO_ESPELHO.get(esquema) or ("entidade" if esquema in TIPO_ENTIDADE else "pessoa")
            prog = (linha.get("program_ids") or "").replace(";", ", ") if programa_da_linha else ""
            saida.append({
                "i": prefixo + (linha.get("id") or nome)[:40],
                "f": chave,
                "t": tipo,
                "n": nome,
                "a": aliases[:12],
                "p": prog or programa,
                "c": (linha.get("countries") or "").upper()[:40],
                "d": "",
                "u": oficial,
                "x": (linha.get("birth_date") or "")[:20],
                "doc": docs[:4],
            })
    return saida
