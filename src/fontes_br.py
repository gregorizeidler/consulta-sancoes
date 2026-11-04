# -*- coding: utf-8 -*-
"""Fontes brasileiras através do espelho aberto do Portal da Transparência e afins.

O download direto dos portais do governo devolve 403 para requisição que não é de
navegador, e a API oficial pede chave. O OpenSanctions republica as mesmas bases num CSV
aberto, com id estável por registro — é o caminho que funciona sem chave, e a fonte
oficial continua citada em cada linha.
"""
import csv
import os
import time
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (compatible; consulta-sancoes/1.0)"}
ESPELHO = "https://data.opensanctions.org/datasets/latest/%s/targets.simple.csv"

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


def formata_documento(valor):
    """CPF ou CNPJ sai com rotulo na frente, como nas outras fontes."""
    digitos = "".join(c for c in (valor or "") if c.isdigit())
    if len(digitos) == 11:
        return "CPF: %s.%s.%s-%s" % (digitos[:3], digitos[3:6], digitos[6:9], digitos[9:])
    if len(digitos) == 14:
        return "CNPJ: %s.%s.%s/%s-%s" % (digitos[:2], digitos[2:5], digitos[5:8], digitos[8:12], digitos[12:])
    return ""


def baixa(slug, destino):
    """Baixa um dataset do espelho, com 3 tentativas e o arquivo anterior como reserva."""
    ultimo = None
    for tentativa in range(3):
        try:
            req = urllib.request.Request(ESPELHO % slug, headers=UA)
            with urllib.request.urlopen(req, timeout=300) as r, open(destino, "wb") as arquivo:
                for pedaco in iter(lambda: r.read(1 << 20), b""):
                    arquivo.write(pedaco)
            if os.path.getsize(destino) < 500:
                raise ValueError("resposta curta")
            return os.path.getsize(destino)
        except Exception as exc:
            ultimo = exc
            time.sleep(5 * (tentativa + 1))
    if os.path.exists(destino) and os.path.getsize(destino) > 500:
        print("AVISO: %s falhou (%s); usando o arquivo da carga anterior" % (slug, ultimo))
        return os.path.getsize(destino)
    raise ultimo


def le(chave, programa, oficial, caminho):
    saida = []
    with open(caminho, encoding="utf-8", errors="replace", newline="") as f:
        for linha in csv.DictReader(f):
            nome = " ".join((linha.get("name") or "").split())
            if not nome:
                continue
            aliases = [a.strip() for a in (linha.get("aliases") or "").replace(";", "|").split("|")
                       if len(a.strip()) > 2]
            brutos = [d.strip() for d in (linha.get("identifiers") or "").replace(";", "|").split("|")
                      if d.strip() and "*" not in d]
            docs = [x for x in (formata_documento(b) for b in brutos) if x]
            esquema = (linha.get("schema") or "").lower()
            saida.append({
                "i": chave + "-" + (linha.get("id") or nome)[:40],
                "f": chave,
                "t": "entidade" if esquema in ("organization", "company", "legalentity") else "pessoa",
                "n": nome,
                "a": aliases[:12],
                "p": programa,
                "c": (linha.get("countries") or "").upper()[:40],
                "d": "",
                "u": oficial,
                "x": (linha.get("birth_date") or "")[:20],
                "doc": docs[:4],
            })
    return saida
