#!/usr/bin/env python3
"""Gera o site estatico a partir de data/sancoes.json."""
import csv, io, json, os, shutil, zipfile
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "docs")
CFG = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
BASE = CFG["base_url"].rstrip("/")
PATH = urlparse(BASE).path.rstrip("/")
DOMINIO = (CFG.get("dominio") or "").strip()

NOMES = {"ofac": "OFAC (EUA)", "un": "ONU", "eu": "União Europeia"}
TIPOS = {"pessoa": "Pessoa", "entidade": "Entidade", "embarcacao": "Embarcação",
         "aeronave": "Aeronave", "outro": "Outro"}

def escreve(rel, conteudo, modo="w"):
    caminho = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, modo, encoding=None if "b" in modo else "utf-8") as f:
        f.write(conteudo)

def main():
    registros = json.load(open(os.path.join(DATA, "sancoes.json"), encoding="utf-8"))
    resumo = json.load(open(os.path.join(DATA, "resumo.json"), encoding="utf-8"))
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT, exist_ok=True)

    # indice compacto: arrays em vez de objetos cortam ~40% do tamanho
    indice = [[r["i"], r["n"], r.get("a", [])[:8], r["f"], r["t"],
               r.get("p", ""), r.get("c", ""), r.get("d", ""), r.get("u", ""), r.get("x", "")]
              for r in registros]
    escreve("dados/indice.json", json.dumps(indice, ensure_ascii=False, separators=(",", ":")))
    escreve("dados/resumo.json", json.dumps(resumo, ensure_ascii=False, indent=1))

    # planilha completa em zip
    buffer = io.StringIO()
    w = csv.writer(buffer)
    w.writerow(["id", "nome", "aliases", "fonte", "tipo", "programa", "pais", "data", "link_oficial", "extra"])
    for r in registros:
        w.writerow([r["i"], r["n"], " | ".join(r.get("a", [])), NOMES.get(r["f"], r["f"]),
                    TIPOS.get(r["t"], r["t"]), r.get("p", ""), r.get("c", ""), r.get("d", ""),
                    r.get("u", ""), r.get("x", "")])
    csv_bytes = buffer.getvalue().encode("utf-8-sig")
    with zipfile.ZipFile(os.path.join(OUT, "dados", "listas-completas.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("sancoes-ofac-onu-ue.csv", csv_bytes)

    escreve("style.css", open(os.path.join(ROOT, "site", "style.css"), encoding="utf-8").read())
    escreve("app.js", open(os.path.join(ROOT, "site", "app.js"), encoding="utf-8").read())

    por_fonte = resumo.get("por_fonte", {})
    cartoes = "".join(
        '<div class="kpi"><span>%s</span><strong>%s</strong></div>' % (NOMES.get(k, k), format(v, ",d").replace(",", "."))
        for k, v in por_fonte.items())
    cartoes += '<div class="kpi kpi-total"><span>Total</span><strong>%s</strong></div>' % format(resumo.get("total", 0), ",d").replace(",", ".")

    mudou = ""
    if resumo.get("novos"):
        itens = "".join(
            '<li><strong>%s</strong> <span class="fonte %s">%s</span> %s</li>' % (
                n["n"], n["f"], NOMES.get(n["f"], n["f"]), n.get("p", ""))
            for n in resumo["novos"][:12])
        mudou = ('<section class="mudou"><h2>Entraram na lista na última atualização (%d)</h2>'
                 '<ul>%s</ul></section>' % (resumo["novos_total"], itens))
    elif resumo.get("primeira_carga"):
        mudou = '<section class="mudou"><h2>Primeira carga concluída</h2><p>A partir de amanhã esta área mostra quem entrou na lista nas últimas 24h.</p></section>'
    else:
        mudou = '<section class="mudou"><h2>Nada novo na última atualização</h2><p>As três listas não tiveram inclusão nas últimas 24 horas.</p></section>'

    html = ("""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>%(titulo)s - OFAC, ONU e UE em uma busca</title>
<meta name="description" content="Consulte em segundos as listas de sanções da OFAC (EUA), da ONU e da União Europeia. Dados oficiais, atualizados todos os dias.">
<link rel="canonical" href="%(base)s/"><link rel="stylesheet" href="%(path)s/style.css">
<meta property="og:title" content="%(titulo)s"><meta property="og:description" content="%(sub)s">
<meta property="og:type" content="website"><meta property="og:url" content="%(base)s/">
</head><body>
<header class="topo">
  <div class="wrap">
    <div class="marca">%(titulo)s</div>
    <div class="sub">%(sub)s</div>
  </div>
</header>
<main class="wrap">
  <section class="busca">
    <label for="q" class="oculto">Buscar por nome</label>
    <input id="q" type="search" autocomplete="off" spellcheck="false"
           placeholder="Digite um nome, empresa, navio ou aeronave">
    <div class="filtros">
      <div class="chips" id="fontes">
        <button class="chip ativo" data-fonte="todas">Todas</button>
        <button class="chip" data-fonte="ofac">OFAC</button>
        <button class="chip" data-fonte="un">ONU</button>
        <button class="chip" data-fonte="eu">UE</button>
      </div>
      <div class="chips" id="tipos">
        <button class="chip ativo" data-tipo="todos">Todos os tipos</button>
        <button class="chip" data-tipo="pessoa">Pessoa</button>
        <button class="chip" data-tipo="entidade">Entidade</button>
        <button class="chip" data-tipo="embarcacao">Embarcação</button>
      </div>
    </div>
    <p class="ajuda">A busca ignora acento, maiúscula e a ordem das palavras. Funciona com nome completo ou só parte dele.</p>
  </section>

  <section class="kpis">%(cartoes)s</section>

  <section class="resultados">
    <div class="barra"><span id="contagem">Carregando as listas…</span>
      <a class="baixar" href="%(path)s/dados/listas-completas.zip">Baixar as listas (CSV)</a></div>
    <div id="lista" class="lista"></div>
    <button id="mais" class="mais" hidden>Mostrar mais</button>
  </section>

  %(mudou)s

  <section class="sobre">
    <h2>O que este site é (e o que não é)</h2>
    <p>Reúne as três listas de sanções mais usadas no Brasil em um só lugar, direto das fontes oficiais: a
    <strong>OFAC</strong> (Tesouro dos EUA), o <strong>Conselho de Segurança da ONU</strong> e a
    <strong>União Europeia</strong>. Os dados são baixados e republicados todos os dias às 06:00 (horário de Brasília).</p>
    <p><strong>O que não é:</strong> não é parecer jurídico, não é triagem de KYC e não substitui a consulta à fonte
    oficial. Homônimo existe e é comum: um nome igual não significa que a pessoa é a mesma. Antes de qualquer
    decisão, abra o registro na fonte (o link está em cada resultado) e confira documento, data de nascimento e país.</p>
    <p>Atualizado em <strong>%(gerado)s</strong>. Fonte de cada registro no campo "ver na fonte oficial".</p>
  </section>
</main>
<footer><div class="wrap"><p>%(titulo)s · dados públicos, republicados com atribuição às fontes originais.</p>
<p class="miudo">Feito para consulta rápida. Não é aconselhamento jurídico.</p></div></footer>
<script src="%(path)s/app.js"></script>
</body></html>""") % {
        "titulo": CFG["titulo"], "sub": CFG["subtitulo"], "base": BASE, "path": PATH,
        "cartoes": cartoes, "mudou": mudou,
        "gerado": resumo.get("gerado_em_br", ""),
    }
    escreve("index.html", html)
    escreve("robots.txt", "User-agent: *\nAllow: /\nSitemap: %s/sitemap.xml\n" % BASE)
    escreve("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                           '<url><loc>%s/</loc></url></urlset>\n' % BASE)
    if DOMINIO:
        escreve("CNAME", DOMINIO + "\n")

    total_bytes = os.path.getsize(os.path.join(OUT, "dados", "indice.json"))
    print("site gerado: %d registros | indice %.1f MB" % (len(registros), total_bytes / 1e6))

if __name__ == "__main__":
    main()
