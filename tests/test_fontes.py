#!/usr/bin/env python3
"""Testes offline das fontes novas, da validação de esquema e da regra de queda (sem rede)."""
import json
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))
FIX = os.path.join(ROOT, "tests", "fixtures")

import coleta  # noqa: E402
import fontes_br  # noqa: E402
import fontes_extra  # noqa: E402
from fontes_br import ErroEsquema  # noqa: E402

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


def levanta(fn, *args):
    try:
        fn(*args)
    except ErroEsquema as exc:
        return str(exc)
    return None


def f(nome):
    return os.path.join(FIX, nome)


CAMPOS = {"i", "f", "t", "n", "a", "p", "c", "d", "u", "x", "doc"}

print("OFAC não-SDN")
sdn = coleta.ofac(f("sdn.xml"))
cons = coleta.ofac(f("cons.xml"), "ofacns")
ok(len(sdn) == 3 and len(cons) == 3, "SDN e consolidada lidas", (len(sdn), len(cons)))
ok(all(set(r) == CAMPOS for r in cons), "registros ofacns têm exatamente os campos do normalizador")
ok(all(r["f"] == "ofacns" and r["i"].startswith("ofacns-") for r in cons), "id e fonte usam o prefixo ofacns")
banco = next(r for r in cons if r["i"] == "ofacns-200")
ok(banco["t"] == "entidade" and banco["doc"] == ["SWIFT/BIC: EXMPRU2X"], "tipo e documento do ofacns", banco)
ok(banco["c"].lower().startswith("russia"), "país do ofacns", banco["c"])

print("Dedup consolidada x SDN")
unicos = fontes_extra.sem_sdn(cons, fontes_extra.uids_sdn(sdn), fontes_extra.nomes_normalizados(sdn))
ok(sorted(r["i"] for r in unicos) == ["ofacns-200", "ofacns-201"], "uid 101 já está na SDN e sai", [r["i"] for r in unicos])
espelho = fontes_extra.le_espelho_ofacns(f("ofacns_espelho.csv"))
ok(len(espelho) == 3, "espelho ofacns ignora security", len(espelho))
ok(all(r["i"].startswith("ofacns-NK-") for r in espelho), "ids do espelho vêm com NK")
unicos_e = fontes_extra.sem_sdn(espelho, fontes_extra.uids_sdn(sdn), fontes_extra.nomes_normalizados(sdn))
ok(sorted(r["n"] for r in unicos_e) == ["BANCO EXEMPLO SA", "Maria Souza"],
   "espelho: 'Ivan Petrov' sai pelo nome normalizado, sem uid", [r["n"] for r in unicos_e])
ok(len(fontes_extra.sem_sdn(espelho, set(), None)) == 3, "sem nomes da SDN o espelho não é cortado")

print("Reino Unido")
gb = fontes_extra.uk(f("uk.xml"))
ok(len(gb) == 3 and all(set(r) == CAMPOS for r in gb), "três designações com os campos do normalizador", len(gb))
akhund = next(r for r in gb if r["i"] == "uk-AFG0006")
ok(akhund["n"] == "MOHAMMAD HASSAN AKHUND" and akhund["a"] == ["Hasan Akhund"], "nome primário e alias", akhund["n"])
ok(akhund["t"] == "pessoa" and akhund["d"] == "2001-01-25", "tipo e data de designação", (akhund["t"], akhund["d"]))
ok(akhund["p"] == "Afghanistan (Sanctions)", "programa sem 'The' e sem '(EU Exit)'", akhund["p"])
ok(akhund["x"] == "1945, 1946-11-12", "datas parciais viram ano", akhund["x"])
ok(akhund["doc"] == ["Passport: D0009871", "National ID: 545167"], "documentos do UK", akhund["doc"])
ok(next(r for r in gb if r["i"] == "uk-RUS0100")["doc"] == ["Registration no.: 1147746050935"], "registro de empresa")
navio = next(r for r in gb if r["i"] == "uk-DPR0075")
ok(navio["t"] == "embarcacao" and navio["doc"] == ["IMO: 9562233"], "navio com IMO", navio)
espelho_uk = fontes_extra.le_espelho_uk(f("uk_espelho.csv"))
ok(len(espelho_uk) == 2 and espelho_uk[1]["t"] == "embarcacao", "espelho UK ignora cryptowallet", len(espelho_uk))
ok(espelho_uk[0]["p"] == "GB-RUS" and espelho_uk[0]["f"] == "uk", "programa e fonte do espelho UK")

print("CNEP")
cnep = fontes_extra.le_cnep(f("cnep_mini.json"))
ok(len(cnep) == 2, "item sem nome é descartado", len(cnep))
ok(cnep[0]["i"] == "cnep-9001" and cnep[0]["d"] == "2024-03-15" and cnep[0]["t"] == "entidade", "empresa punida", cnep[0])
ok(cnep[0]["doc"] == ["CNPJ: 12.345.678/0001-90"] and "Multa" in cnep[0]["p"], "documento e sanção do CNEP", cnep[0])
ok(cnep[1]["t"] == "pessoa" and cnep[1]["doc"] == ["CPF: ***.123.456-**"], "CPF mascarado do CNEP", cnep[1])
ok(all(set(r) == CAMPOS for r in cnep), "campos do normalizador no CNEP")
ok(levanta(fontes_extra.valida_cnep, f("cnep_mini.json")) is None, "JSON válido do CNEP passa")
ok(levanta(fontes_extra.valida_cnep, f("cnep_erro.json")) is not None, "resposta de erro do CNEP é recusada")
antes = os.environ.pop(fontes_extra.CHAVE_ENV, None)
ok(fontes_extra.obtem_cnep("/nao/existe.json") is None, "sem chave a fonte é pulada")
if antes is not None:
    os.environ[fontes_extra.CHAVE_ENV] = antes

print("Validação de esquema")
ok(levanta(fontes_extra.valida_ofac, f("sdn.xml")) is None, "SDN válida passa")
ok(levanta(fontes_extra.valida_ofac, f("cons.xml")) is None, "consolidada válida passa")
ok(levanta(fontes_extra.valida_uk, f("uk.xml")) is None, "UK válida passa")
ok(levanta(fontes_extra.valida_onu, f("un.xml")) is None, "ONU válida passa")
ok(levanta(fontes_extra.valida_ue, f("eu.xml")) is None, "UE válida passa")
msg = levanta(fontes_extra.valida_uk, f("uk_ruim.xml"))
ok(msg and "Names" in msg, "UK sem o elemento Names é recusada", msg)
msg = levanta(fontes_extra.valida_ofac, f("raiz_errada.xml"))
ok(msg and "raiz" in msg, "XML com raiz errada é recusado", msg)
msg = levanta(fontes_extra.valida_ofac, f("sdn_truncado.xml"))
ok(msg and "malformado" in msg, "XML truncado é recusado", msg)
ok(levanta(fontes_extra.valida_uk, f("sdn.xml")) is not None, "SDN não passa como UK")
msg = levanta(fontes_br.valida_csv, f("espelho_sem_coluna.csv"))
ok(msg and "identifiers" in msg, "CSV do espelho sem coluna obrigatória levanta erro", msg)
ok(levanta(fontes_br.valida_csv, f("pep_mini.csv")) is None, "CSV do espelho completo passa")

print("Fallback de download")
tmp = tempfile.mkdtemp()
try:
    destino = os.path.join(tmp, "uk.xml")
    shutil.copy(f("uk.xml"), destino)
    os.utime(destino, (1_700_000_000, 1_700_000_000))
    meta_antes = fontes_br.sha256_arquivo(destino)
    orig = fontes_br.baixa_url
    chamadas = []

    def falha(url, dest, *a, **k):
        chamadas.append(url)
        raise OSError("sem rede")

    def serve_ruim(url, dest, *a, **k):
        shutil.copy(f("raiz_errada.xml"), dest)
        return os.path.getsize(dest)

    def serve_bom(url, dest, *a, **k):
        shutil.copy(f("sdn.xml"), dest)
        return os.path.getsize(dest)

    try:
        fontes_br.baixa_url = falha
        cand = [("oficial", "http://x/uk.xml", destino, fontes_extra.valida_uk)]
        m = fontes_br.obtem(cand, "uk")
        ok(m["origem"] == "cache" and m["sha256"] == meta_antes, "download falho usa o cache", m["origem"])
        ok(any("download falhou" in a for a in m["avisos"]) and any("carga anterior" in a for a in m["avisos"]),
           "o cache deixa aviso", m["avisos"])
        fontes_br.baixa_url = serve_ruim
        m = fontes_br.obtem(cand, "uk")
        ok(m["origem"] == "cache" and fontes_br.sha256_arquivo(destino) == meta_antes,
           "arquivo de formato errado não substitui o bom")
        ok(not os.path.exists(destino + ".novo"), "arquivo temporário é removido")
        ok(any("esquema inesperado" in a for a in m["avisos"]), "esquema errado fica nos avisos", m["avisos"])
        fontes_br.baixa_url = serve_bom
        cand2 = [("oficial", "http://x/a", destino, fontes_extra.valida_ofac)]
        m = fontes_br.obtem(cand2, "ofac")
        ok(m["origem"] == "oficial" and m["sha256"] != meta_antes, "arquivo válido substitui o anterior")
        espelho_csv = os.path.join(tmp, "espelho.csv")
        cand3 = [("oficial", "http://x/a", os.path.join(tmp, "novo.xml"), fontes_extra.valida_uk),
                 ("espelho", "http://x/b", espelho_csv, fontes_br.valida_csv)]

        def so_espelho(url, dest, *a, **k):
            if url.endswith("/a"):
                raise OSError("fora do ar")
            shutil.copy(f("pep_mini.csv"), dest)
            return os.path.getsize(dest)

        fontes_br.baixa_url = so_espelho
        m = fontes_br.obtem(cand3, "uk")
        ok(m["origem"] == "espelho" and m["destino"] == espelho_csv, "oficial fora do ar cai para o espelho", m["origem"])
        ok(any("espelho" in a for a in m["avisos"]), "caminho alternativo fica registrado", m["avisos"])
        fontes_br.baixa_url = falha
        vazio = [("oficial", "http://x/z", os.path.join(tmp, "nada.xml"), fontes_extra.valida_uk)]
        try:
            fontes_br.obtem(vazio, "uk")
            ok(False, "sem cache e sem rede levanta erro")
        except RuntimeError:
            ok(True, "sem cache e sem rede levanta erro")
    finally:
        fontes_br.baixa_url = orig
finally:
    shutil.rmtree(tmp)

print("Regra de queda de 30%")
ant = {"ofac": 1000, "uk": 500, "cnep": 200, "bcb": 0}
ok(coleta.confere_quedas({"ofac": 1000, "uk": 500}, {"ofac": 1000, "uk": 500}) == [], "sem queda não acusa")
ok(coleta.confere_quedas({"ofac": 710, "uk": 350}, ant, ("cnep",)) == [], "queda de até 30% é aceita")
erros = coleta.confere_quedas({"ofac": 1000, "uk": 349}, ant, ("cnep",))
ok(len(erros) == 1 and erros[0].startswith("uk caiu 30%"), "queda acima de 30% acusa a fonte", erros)
erros = coleta.confere_quedas({"ofac": 1000}, ant, ("cnep",))
ok(len(erros) == 1 and "uk caiu 100%" in erros[0], "fonte que sumiu conta como queda total", erros)
ok(coleta.confere_quedas({"ofac": 1000, "uk": 500}, ant) != [], "fonte dispensada é a única isenta")
ok(coleta.confere_quedas({"ofac": 1000, "uk": 500, "cnep": 0}, ant, ("cnep",)) == [], "CNEP pulado não derruba o build")
ok(coleta.confere_quedas({"ofac": 5}, {"ofac": 0}) == [], "fonte que antes estava vazia não conta")
ok(coleta.confere_quedas({"ofac": 1, "novo": 10}, {}) == [], "primeira carga não tem com o que comparar")

print("Origem agregada")
ag = coleta.agrega([{"origem": "oficial", "bytes": 1, "sha256": "a", "destino": "x"},
                    {"origem": "cache", "bytes": 2, "sha256": "b", "destino": "y"}])
ok(ag["origem"] == "cache" and ag["bytes"] == 3 and len(ag["sha256"]) == 64, "a pior origem vence na agregação", ag)

print("CPF mascarado")
ok(fontes_br.formata_cpf_mascarado("***.976.399-**") == "CPF: ***.976.399-**", "formato com pontos")
ok(fontes_br.formata_cpf_mascarado("***976399**") == "CPF: ***.976.399-**", "formato sem pontuação")
ok(fontes_br.formata_cpf_mascarado("123.456.789-09") == "", "CPF completo não é tratado como mascarado")
ok(fontes_br.formata_cpf_mascarado("ab*cd") == "", "lixo com asterisco é recusado")
ok(fontes_br.formata_cpf_mascarado("") == "", "vazio é recusado")
ok(fontes_br.documento("123.456.789-09") == "CPF: 123.456.789-09", "CPF completo mantém o caminho antigo")
pep = fontes_br.le("pep", "PEP", "http://pep", f("pep_mini.csv"))
por_id = {r["i"]: r for r in pep}
ok(len(pep) == 6, "PEP lida por inteiro", len(pep))
ok(por_id["pep-NK-1"]["doc"] == ["CPF: ***.976.399-**"], "PEP ganha o CPF mascarado", por_id["pep-NK-1"]["doc"])
ok(por_id["pep-NK-2"]["doc"] == ["CPF: ***.804.418-**", "CPF: ***.111.222-**"], "dois CPFs mascarados no mesmo registro")
ok(por_id["pep-NK-3"]["doc"] == ["CPF: 123.456.789-09"], "CPF aberto continua como antes")
ok(por_id["pep-NK-4"]["doc"] == ["CNPJ: 12.345.678/0001-90"], "CNPJ continua como antes")
ok(por_id["pep-NK-5"]["doc"] == [] and por_id["pep-NK-6"]["doc"] == [], "sem documento ou com lixo fica vazio")
mascarados = sum(1 for r in pep if any("*" in d for d in r["doc"]))
ok(mascarados == 2, "contagem de registros com documento mascarado", mascarados)
ok(all(": " in d for r in pep for d in r["doc"]), "todo documento mantém 'Tipo: número'")

print("")
print("TODOS OS %d TESTES PASSARAM" % total if falhas == 0 else "%d DE %d FALHARAM" % (falhas, total))
sys.exit(0 if falhas == 0 else 1)
