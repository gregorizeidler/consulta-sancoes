# -*- coding: utf-8 -*-
"""PEP e CEIS (Brasil) através do espelho aberto do Portal da Transparência.

O download direto do portal devolve 403 para requisição sem navegador, e a API oficial
pede chave. O OpenSanctions republica as mesmas bases da CGU num CSV aberto, com o id
estável de cada registro — é o caminho que funciona sem chave, e a fonte oficial segue
citada em cada linha.
"""
import csv
import os
import time
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (compatible; consulta-sancoes/1.0)"}
ESPELHO = "https://data.opensanctions.org/datasets/latest/%s/targets.simple.csv"
OFICIAL = {
    "pep": "https://portaldatransparencia.gov.br/download-de-dados/pep",
    "ceis": "https://portaldatransparencia.gov.br/download-de-dados/ceis",
}
PROGRAMA = {
    "pep": "PEP - Pessoas Expostas Politicamente (CGU)",
    "ceis": "CEIS - Empresas Inidoneas e Suspensas (CGU)",
}


def baixa(nome, destino):
    ultimo = None
    for tentativa in range(3):
        try:
            req = urllib.request.Request(ESPELHO % ("br_" + nome), headers=UA)
            with urllib.request.urlopen(req, timeout=300) as r, open(destino, "wb") as arquivo:
                for pedaco in iter(lambda: r.read(1 << 20), b""):
                    arquivo.write(pedaco)
            if os.path.getsize(destino) < 10000:
                raise ValueError("resposta curta")
            return os.path.getsize(destino)
        except Exception as exc:
            ultimo = exc
            time.sleep(5 * (tentativa + 1))
    if os.path.exists(destino) and os.path.getsize(destino) > 10000:
        return os.path.getsize(destino)
    raise ultimo


def le(nome, caminho):
    saida = []
    with open(caminho, encoding="utf-8", errors="replace", newline="") as f:
        for linha in csv.DictReader(f):
            nome_reg = " ".join((linha.get("name") or "").split())
            if not nome_reg:
                continue
            aliases = [a.strip() for a in (linha.get("aliases") or "").replace(";", "|").split("|") if len(a.strip()) > 2]
            docs = [d.strip() for d in (linha.get("identifiers") or "").replace(";", "|").split("|")
                    if d.strip() and "*" not in d]
            esquema = (linha.get("schema") or "").lower()
            saida.append({
                "i": nome + "-" + (linha.get("id") or nome_reg)[:40],
                "f": nome,
                "t": "entidade" if esquema in ("organization", "company", "legalentity") else "pessoa",
                "n": nome_reg,
                "a": aliases[:12],
                "p": PROGRAMA[nome],
                "c": (linha.get("countries") or "").upper()[:40],
                "d": "",
                "u": OFICIAL[nome],
                "x": (linha.get("birth_date") or "")[:20],
                "doc": docs[:4],
            })
    return saida
