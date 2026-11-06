#!/usr/bin/env python3
"""Confere a qualidade da base normalizada (roda depois da coleta)."""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIPOS = {"pessoa", "entidade", "embarcacao", "aeronave", "outro"}
FONTES_CONHECIDAS = {"ofac", "un", "eu", "ceis", "slavery", "tcu", "bcb", "ofacns", "uk", "cnep"}
ORIGENS = {"oficial", "espelho", "cache"}
CPF_MASC = re.compile(r"^CPF: [\d*]{3}\.[\d*]{3}\.[\d*]{3}-[\d*]{2}$")
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

desconhecidas = set(por_fonte) - FONTES_CONHECIDAS
ok(not desconhecidas, "só aparecem fontes conhecidas", desconhecidas)
ok({"ofac", "un", "eu", "ceis", "slavery", "tcu", "bcb"} <= set(por_fonte), "as sete fontes originais continuam presentes")
for chave in ("ofacns", "uk"):
    ok(por_fonte.get(chave, 0) > 0, "fonte nova %s carregou registros" % chave, por_fonte.get(chave))

uid_sdn = {d["i"].split("-", 1)[1] for d in dados if d["f"] == "ofac"}
repetidos = [d["i"] for d in dados if d["f"] == "ofacns" and not d["i"].startswith("ofacns-NK-") and d["i"].split("-", 1)[1] in uid_sdn]
ok(not repetidos, "nenhum uid da OFAC não-SDN repete a SDN", repetidos[:3])

mascarados = [x for d in dados for x in d["doc"] if x.startswith("CPF: ") and "*" in x]
ruins = [x for x in mascarados if not CPF_MASC.match(x)]
ok(not ruins, "todo CPF mascarado mantém dígitos visíveis e posições", ruins[:3])
print("  info %d documentos de CPF mascarado em %d registros" % (
    len(mascarados), sum(1 for d in dados if any(x.startswith("CPF: ") and "*" in x for x in d["doc"]))))

caminho_pep = os.path.join(ROOT, "data", "pep.json")
if os.path.exists(caminho_pep):
    pep = json.load(open(caminho_pep, encoding="utf-8"))
    com_cpf = [d for d in pep if any(CPF_MASC.match(x) for x in d["doc"])]
    ok(len(com_cpf) > 0.9 * len(pep), "a PEP ganhou CPF mascarado na maioria dos registros", (len(com_cpf), len(pep)))
    ok(all(": " in x for d in pep for x in d["doc"]), "documento da PEP também vem com o tipo na frente")
    print("  info %d de %d registros PEP com documento" % (sum(1 for d in pep if d["doc"]), len(pep)))

info = resumo.get("fontes_info")
ok(isinstance(info, dict) and info, "resumo traz fontes_info")
if isinstance(info, dict):
    esperadas = set(resumo["por_fonte"]) | {"pep"}
    ok(set(info) >= set(resumo["por_fonte"]) and set(info) <= esperadas, "fontes_info cobre as fontes carregadas", sorted(info))
    for chave, m in info.items():
        base = resumo["por_fonte"].get(chave, m.get("registros"))
        certo = (set(m) == {"carregado_em", "origem", "registros", "bytes", "sha256"}
                 and m["origem"] in ORIGENS and re.match(r"^\d{4}-\d{2}-\d{2}$", m["carregado_em"] or "")
                 and re.match(r"^[0-9a-f]{64}$", m["sha256"] or "") and m["bytes"] > 0 and m["registros"] == base)
        ok(certo, "fontes_info de %s está completo e bate com por_fonte" % chave, m)
ok(isinstance(resumo.get("avisos"), list), "resumo traz a lista de avisos")

print("")
print("TODOS OS %d TESTES PASSARAM" % total if falhas == 0 else "%d DE %d FALHARAM" % (falhas, total))
sys.exit(0 if falhas == 0 else 1)
