#!/usr/bin/env python3
"""Confere a qualidade da base normalizada (roda depois da coleta)."""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIPOS = {"pessoa", "entidade", "embarcacao", "aeronave", "outro"}
falhas = 0
total = 0


def ok(cond, msg, extra=""):
    global falhas, total
    total += 1
    if cond:
        print("  ok   " + msg)
    else:
        falhas += 1
        print("  FALHOU " + msg + ((" -> " + str(extra)) if extra else ""))


dados = json.load(open(os.path.join(ROOT, "data", "sancoes.json"), encoding="utf-8"))
resumo = json.load(open(os.path.join(ROOT, "data", "resumo.json"), encoding="utf-8"))
print("%d registros" % len(dados))

fora = [d for d in dados if d["t"] not in TIPOS]
ok(not fora, "todo registro tem tipo conhecido", fora[:3])

# o tipo ja foi poluido por rotulo de observacao da OFAC em 47% da base
rotulo = [d for d in dados if len(d["t"]) > 14 or d["t"].endswith(":")]
ok(not rotulo, "nenhum tipo virou rotulo de observacao", [d["t"] for d in rotulo[:3]])

docs_ruins = [x for d in dados for x in d["doc"] if ": " not in x]
ok(not docs_ruins, "documento sempre vem com o tipo na frente", docs_ruins[:3])

lixo = ("sanctions risk", "additional sanctions information")
ok(not [x for d in dados for x in d["doc"] if any(l in x.lower() for l in lixo)],
   "nenhum documento e, na verdade, observacao")

por_fonte = {}
for d in dados:
    por_fonte[d["f"]] = por_fonte.get(d["f"], 0) + 1
ok(por_fonte == resumo["por_fonte"], "contagem por fonte bate com o resumo", por_fonte)

ids = [d["i"] for d in dados]
ok(len(ids) == len(set(ids)), "nenhum id repetido")

vazios = [d for d in dados if not d["n"].strip()]
ok(not vazios, "nenhum registro sem nome", len(vazios))

com_doc = sum(1 for d in dados if d["doc"])
ok(com_doc > 15000, "documento em mais de 15 mil registros", com_doc)

print("")
print("TODOS OS %d TESTES PASSARAM" % total if falhas == 0 else "%d DE %d FALHARAM" % (falhas, total))
sys.exit(0 if falhas == 0 else 1)
