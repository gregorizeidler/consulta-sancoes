#!/usr/bin/env python3
"""Manifesto encadeado: prova de que o arquivo consultado hoje e o mesmo de ontem.

Cada dia entra uma linha no manifesto com o SHA-256 do CSV e do indice publicados.
A linha tambem carrega o hash da linha anterior, entao mexer em qualquer dia do
passado quebra a corrente e a quebra aparece na verificacao.
"""
import hashlib
import json
import os


def sha256_arquivo(caminho, bloco=1 << 20):
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for pedaco in iter(lambda: f.read(bloco), b""):
            h.update(pedaco)
    return h.hexdigest()


def _canonico(d):
    return json.dumps(d, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def carrega(caminho):
    if not os.path.exists(caminho):
        return []
    try:
        return json.load(open(caminho, encoding="utf-8"))
    except Exception:
        return []


def registra(caminho, entrada):
    """Grava a entrada do dia. Se ja existe entrada do mesmo dia, ela e substituida
    (varias execucoes no mesmo dia nao inflam o manifesto)."""
    historico = carrega(caminho)
    if historico and historico[-1].get("data") == entrada.get("data"):
        historico.pop()
    anterior = historico[-1]["cadeia_hash"] if historico else "0" * 64
    entrada["hash_anterior"] = anterior
    entrada["cadeia_hash"] = hashlib.sha256(_canonico(entrada)).hexdigest()
    historico.append(entrada)
    historico = historico[-365:]
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(historico, f, ensure_ascii=False, indent=1)
    return historico


def verifica(historico):
    """Reconfere a corrente inteira. Devolve (ok, primeiro_elo_quebrado)."""
    anterior = "0" * 64
    for i, e in enumerate(historico):
        if e.get("hash_anterior") != anterior:
            return False, i
        copia = dict(e)
        copia.pop("cadeia_hash", None)
        calc = hashlib.sha256(_canonico(copia)).hexdigest()
        if calc != e.get("cadeia_hash"):
            return False, i
        anterior = e["cadeia_hash"]
    return True, None
