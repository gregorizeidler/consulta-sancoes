#!/usr/bin/env python3
"""Gera o site estatico a partir de data/sancoes.json."""
import csv, io, json, os, re, shutil, sys, unicodedata, zipfile
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assinatura
import paginas_extra

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "docs")
CFG = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
BASE = CFG["base_url"].rstrip("/")
PATH = urlparse(BASE).path.rstrip("/")
DOMINIO = (CFG.get("dominio") or "").strip()

NOMES = {"ofac": "OFAC (EUA)", "un": "ONU", "eu": "União Europeia",
         "ofacns": "OFAC não-SDN (EUA)", "uk": "Reino Unido (OFSI/FCDO)", "cnep": "CNEP (CGU)"}
CURTOS = {"ofac": "OFAC", "un": "ONU", "eu": "UE", "ofacns": "OFAC não-SDN", "uk": "Reino Unido", "cnep": "CNEP"}
CHIPS = {"ceis": "CEIS", "slavery": "Lista Suja", "tcu": "TCU", "bcb": "BCB", "ofac": "OFAC",
         "ofacns": "OFAC não-SDN", "un": "ONU", "eu": "UE", "uk": "Reino Unido", "cnep": "CNEP"}
ORDEM_CHIPS = ["ceis", "slavery", "tcu", "bcb", "ofac", "ofacns", "un", "eu", "uk", "cnep"]
ORIGEM_ROTULO = {"oficial": "", "espelho": " (espelho)", "cache": ""}
FONTE_INFO_HTML = ""
TIPOS = {"pessoa": "Pessoa", "entidade": "Entidade", "embarcacao": "Embarcação",
         "aeronave": "Aeronave", "outro": "Outro"}

def normaliza(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^A-Za-z0-9 ]", " ", s.lower())
    return " ".join(s.split())

def escreve(rel, conteudo):
    caminho = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    abrir = "wb" if isinstance(conteudo, bytes) else "w"
    with open(caminho, abrir, **({} if "b" in abrir else {"encoding": "utf-8"})) as f:
        f.write(conteudo)

ROTULO_KPI = {"ofac": "OFAC (EUA)", "un": "ONU", "eu": "União Europeia", "ceis": "CEIS",
              "slavery": "Lista Suja", "tcu": "TCU", "bcb": "BCB", "ofacns": "OFAC não-SDN",
              "uk": "Reino Unido", "cnep": "CNEP"}

def dia_mes(iso):
    m = re.match(r"^\d{4}-(\d{2})-(\d{2})", iso or "")
    return "%s/%s" % (m.group(2), m.group(1)) if m else escapa(iso or "?")

def escapa(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))

def bloco_fontes_info(info, completo=True):
    """Data da carga por fonte; fonte que caiu no arquivo anterior ganha aviso visivel."""
    if not info:
        return ""
    itens, defasadas = "", []
    for chave in ORDEM_CHIPS + sorted(set(info) - set(ORDEM_CHIPS)):
        if chave not in info or chave == "pep" and not completo:
            continue
        i = info[chave]
        nome = escapa(CHIPS.get(chave) or ("PEP" if chave == "pep" else chave))
        if i.get("origem") == "cache":
            defasadas.append((nome, dia_mes(i.get("carregado_em"))))
            itens += ('<li class="fonte-info-item fonte-info-cache"><strong>%s</strong> '
                      '<span class="fonte-info-aviso">dados de %s</span></li>' % (nome, dia_mes(i.get("carregado_em"))))
        else:
            itens += ('<li class="fonte-info-item"><strong>%s</strong> <span>%s%s</span></li>'
                      % (nome, dia_mes(i.get("carregado_em")), ORIGEM_ROTULO.get(i.get("origem"), "")))
    faixa = ""
    if defasadas:
        faixa = ('<p class="fonte-info-alerta alerta">Atenção: %s (%s).</p>'
                 % ("algumas fontes não foram atualizadas hoje e estão com dados antigos" if len(defasadas) > 1
                    else "uma fonte não foi atualizada hoje e está com dados antigos",
                    "; ".join("%s: dados de %s" % d for d in defasadas)))
    if not completo:
        return faixa
    return ('<div class="fonte-info"><h4>Fontes e data da carga</h4><ul class="fonte-info-lista">%s</ul></div>'
            % itens)

def nav(ativo):
    itens = [("index.html", "Busca"), ("lote.html", "Triagem em lote"),
             ("mudancas.html", "Mudanças"), ("dossie.html", "Dossiê"), ("decisoes.html", "Decisões"),
             ("verificar.html", "Verificar arquivo"), ("api.html", "API")]
    links = "".join(
        '<a href="%s/%s"%s>%s</a>' % (PATH, href, ' class="atual"' if href == ativo else "", rotulo)
        for href, rotulo in itens)
    return ('<header class="topo"><div class="wrap topo-in">'
            '<a class="marca" href="%s/index.html"><span class="logo"></span><span>%s</span></a>'
            '<nav class="menu">%s</nav></div></header>' % (PATH, CFG["titulo"], links))

def cabecalho_pagina(corpo):
    """Move o h1 e o paragrafo de entrada para uma faixa de titulo no topo da pagina."""
    m = re.match(r'\s*<h1>(.*?)</h1>\s*(?:<p class="entrada">(.*?)</p>)?', corpo, re.S)
    if not m:
        return "", corpo
    lead = '<p class="pagina-lead">%s</p>' % m.group(2) if m.group(2) else ""
    faixa = ('<section class="pagina-cab"><div class="wrap"><h1>%s</h1>%s</div></section>'
             % (m.group(1), lead))
    return faixa, corpo[m.end():]

def pagina(titulo, descricao, corpo, ativo, canonical, hero=""):
    faixa = hero
    if not hero:
        faixa, corpo = cabecalho_pagina(corpo)
    return ("""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>%(t)s</title><meta name="description" content="%(d)s">
<meta name="theme-color" content="#0b1b3f">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="canonical" href="%(c)s"><link rel="stylesheet" href="%(p)s/style.css">
<meta property="og:title" content="%(t)s"><meta property="og:description" content="%(d)s">
<meta property="og:type" content="website"><meta property="og:url" content="%(c)s">
</head><body class="%(cls)s">%(nav)s%(faixa)s<main class="wrap">%(corpo)s</main>
<footer class="rodape-site"><div class="wrap">
<div class="rodape-grade">
<div class="rodape-marca"><strong>%(titulo)s</strong>
<p>Dados públicos de sanções e pessoas expostas politicamente, republicados todos os dias com atribuição às fontes originais.</p></div>
<div><h4>Produto</h4><a href="%(p)s/index.html">Busca</a><a href="%(p)s/lote.html">Triagem em lote</a>
<a href="%(p)s/dossie.html">Dossiê</a><a href="%(p)s/decisoes.html">Decisões</a></div>
<div><h4>Dados</h4><a href="%(p)s/mudancas.html">Mudanças</a><a href="%(p)s/verificar.html">Verificar arquivo</a>
<a href="%(p)s/api.html">API aberta</a><a href="%(p)s/dados/listas-completas.zip">Baixar listas (CSV)</a></div>
</div>
%(fonte_info)s
<p class="rodape-aviso">Consulta informativa. Não é aconselhamento jurídico, não é triagem de KYC e não substitui a fonte oficial. Homônimos são comuns: confira sempre o registro original.</p>
</div></footer>
<script src="%(p)s/motor.js"></script><script src="%(p)s/app.js"></script></body></html>""") % {
        "t": titulo, "d": descricao, "c": canonical, "p": PATH, "faixa": faixa,
        "cls": "home" if hero else "interna",
        "nav": nav(ativo), "corpo": corpo, "titulo": CFG["titulo"], "fonte_info": FONTE_INFO_HTML,
    }

def main():
    global FONTE_INFO_HTML
    registros = json.load(open(os.path.join(DATA, "sancoes.json"), encoding="utf-8"))
    resumo = json.load(open(os.path.join(DATA, "resumo.json"), encoding="utf-8"))
    historico = []
    caminho_hist = os.path.join(DATA, "historico.json")
    if os.path.exists(caminho_hist):
        try:
            historico = json.load(open(caminho_hist, encoding="utf-8"))
        except Exception:
            historico = []

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT, exist_ok=True)

    # nomes que aparecem em mais de uma lista (mesmo nome normalizado)
    por_nome = {}
    for r in registros:
        por_nome.setdefault(normaliza(r["n"]), set()).add(r["f"])

    indice = []
    for r in registros:
        fontes = por_nome.get(normaliza(r["n"]), set())
        multiplas = ",".join(sorted(fontes)) if len(fontes) > 1 else ""
        indice.append([r["i"], r["n"], r.get("a", [])[:8], r["f"], r["t"],
                       r.get("p", ""), r.get("c", ""), r.get("d", ""), r.get("u", ""),
                       r.get("x", ""), r.get("doc", [])[:4], multiplas])
    escreve("dados/indice.json", json.dumps(indice, ensure_ascii=False, separators=(",", ":")))
    escreve("dados/resumo.json", json.dumps(resumo, ensure_ascii=False, indent=1))
    escreve("dados/historico.json", json.dumps(historico, ensure_ascii=False, separators=(",", ":")))

    # planilha completa
    buffer = io.StringIO()
    w = csv.writer(buffer)
    w.writerow(["id", "nome", "aliases", "fonte", "tipo", "programa", "pais", "data",
                "link_oficial", "extra", "documentos", "presente_em"])
    for r in registros:
        fontes = por_nome.get(normaliza(r["n"]), set())
        w.writerow([r["i"], r["n"], " | ".join(r.get("a", [])), NOMES.get(r["f"], r["f"]),
                    TIPOS.get(r["t"], r["t"]), r.get("p", ""), r.get("c", ""), r.get("d", ""),
                    r.get("u", ""), r.get("x", ""), " | ".join(r.get("doc", [])),
                    ", ".join(sorted(fontes))])
    csv_bytes = buffer.getvalue().encode("utf-8-sig")
    escreve("dados/sancoes.csv", csv_bytes)
    nome_csv = "sancoes-ofac-onu-ue-%s.csv" % resumo.get("gerado_em", "")[:10]
    with zipfile.ZipFile(os.path.join(OUT, "dados", "listas-completas.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(nome_csv, csv_bytes)

    # manifesto encadeado: hash do CSV, do indice e do zip, com o elo anterior
    manifesto = assinatura.registra(os.path.join(DATA, "manifesto.json"), {
        "data": resumo.get("gerado_em", "")[:10],
        "hora": resumo.get("gerado_em", "")[11:16],
        "total": len(registros),
        "por_fonte": resumo.get("por_fonte", {}),
        "csv_nome": nome_csv,
        "csv_bytes": len(csv_bytes),
        "csv_sha256": assinatura.sha256_arquivo(os.path.join(OUT, "dados", "sancoes.csv")),
        "indice_sha256": assinatura.sha256_arquivo(os.path.join(OUT, "dados", "indice.json")),
        "zip_sha256": assinatura.sha256_arquivo(os.path.join(OUT, "dados", "listas-completas.zip")),
    })
    escreve("dados/manifesto.json", json.dumps(manifesto, ensure_ascii=False, indent=1))
    origem_pep = os.path.join(DATA, "pep.json")
    if os.path.exists(origem_pep):
        with open(origem_pep, encoding="utf-8") as fh:
            pep = json.load(fh)
        escreve("dados/pep.json", json.dumps(
            [[r["i"], r["n"], r.get("a", [])[:8], r["f"], r["t"], r.get("p", ""), r.get("c", ""),
              r.get("d", ""), r.get("u", ""), r.get("x", ""), r.get("doc", [])[:4], ""] for r in pep],
            ensure_ascii=False, separators=(",", ":")))
    cadeia_ok, quebrado = assinatura.verifica(manifesto)

    escreve("style.css", open(os.path.join(ROOT, "site", "style.css"), encoding="utf-8").read())
    escreve("app.js", open(os.path.join(ROOT, "site", "app.js"), encoding="utf-8").read())
    escreve("motor.js", open(os.path.join(ROOT, "site", "motor.js"), encoding="utf-8").read())
    escreve("worker.js", open(os.path.join(ROOT, "site", "worker.js"), encoding="utf-8").read())
    escreve("verificar.js", open(os.path.join(ROOT, "site", "verificar.js"), encoding="utf-8").read())
    escreve("extra.js", open(os.path.join(ROOT, "site", "extra.js"), encoding="utf-8").read())

    por_fonte = resumo.get("por_fonte", {})
    FONTE_INFO_HTML = bloco_fontes_info(resumo.get("fontes_info"))
    faixa_cache = bloco_fontes_info(resumo.get("fontes_info"), completo=False)
    chips = "".join('<button class="chip" data-fonte="%s">%s</button>' % (k, CHIPS[k])
                    for k in ORDEM_CHIPS if k in por_fonte or k in ("ceis", "slavery", "tcu", "bcb", "ofac", "un", "eu"))
    cartoes = "".join(
        '<div class="kpi"><span>%s</span><strong>%s</strong></div>'
        % (ROTULO_KPI.get(k, NOMES.get(k, k)), format(v, ",d").replace(",", "."))
        for k, v in por_fonte.items())
    cartoes += '<div class="kpi kpi-total"><span>Total</span><strong>%s</strong></div>' % (
        format(resumo.get("total", 0), ",d").replace(",", "."))
    com_doc = sum(1 for r in registros if r.get("doc"))
    cartoes += '<div class="kpi"><span>Com documento</span><strong>%s</strong></div>' % (
        format(com_doc, ",d").replace(",", "."))

    total_fmt = format(resumo.get("total", 0), ",d").replace(",", ".")
    hero = ('<section class="hero"><div class="wrap">'
            '<p class="eyebrow"><span class="ponto"></span>Dados oficiais, atualizados todos os dias</p>'
            '<h1>Triagem de sanções e PEP em uma única busca</h1>'
            '<p class="hero-sub">OFAC, ONU, União Europeia, Reino Unido, CEIS, Lista Suja, TCU e Banco Central num só lugar. '
            'Busca difusa com score de similaridade, tudo processado no seu navegador.</p>'
            '<ul class="hero-fatos">'
            '<li><strong>%s</strong><span>registros consultáveis</span></li>'
            '<li><strong>%d</strong><span>listas oficiais, mais PEP</span></li>'
            '<li><strong>%s</strong><span>última atualização</span></li>'
            '<li><strong>SHA-256</strong><span>base verificável por dia</span></li>'
            '</ul></div></section>' % (total_fmt, len(por_fonte), resumo.get("gerado_em_br", "")))

    mudou = ""
    if resumo.get("novos"):
        itens = "".join(
            '<li><strong>%s</strong> <span class="fonte %s">%s</span> %s</li>'
            % (n["n"], n["f"], CURTOS.get(n["f"], n["f"]), n.get("p", ""))
            for n in resumo["novos"][:12])
        mudou = ('<section class="mudou"><h2>Entraram na lista na última atualização (%d)</h2>'
                 '<ul>%s</ul><p class="miudo"><a href="%s/mudancas.html">Ver histórico completo</a></p></section>'
                 % (resumo["novos_total"], itens, PATH))
    else:
        mudou = ('<section class="mudou"><h2>Nada novo nas últimas 24h</h2>'
                 '<p>As listas não tiveram inclusão. <a href="%s/mudancas.html">Ver histórico</a>.</p></section>' % PATH)

    corpo = """
  <section class="busca">
    <label for="q" class="oculto">Buscar por nome ou documento</label>
    <input id="q" type="search" autocomplete="off" spellcheck="false"
           placeholder="Nome, empresa, navio, passaporte ou número de documento">
    <div class="contexto">
      <div class="campo"><label for="f-nasc">Nascimento <span class="opc">(opcional)</span></label>
        <input id="f-nasc" type="text" inputmode="numeric" autocomplete="off" placeholder="dd/mm/aaaa ou só o ano"></div>
      <div class="campo"><label for="f-pais">País <span class="opc">(opcional)</span></label>
        <input id="f-pais" type="text" autocomplete="off" placeholder="Brasil, Rússia, BR…"></div>
      <div class="campo"><label for="f-doc">Documento <span class="opc">(opcional)</span></label>
        <input id="f-doc" type="text" autocomplete="off" placeholder="CPF, CNPJ ou passaporte; aceita CPF mascarado"></div>
    </div>
    <div class="filtros">
      <div class="chips" id="fontes">
        <button class="chip ativo" data-fonte="todas">Todas</button>
        @@CHIPS@@
      </div>
      <div class="chips" id="tipos">
        <button class="chip ativo" data-tipo="todos">Todos os tipos</button>
        <button class="chip" data-tipo="pessoa">Pessoa</button>
        <button class="chip" data-tipo="entidade">Entidade</button>
        <button class="chip" data-tipo="embarcacao">Embarcação</button>
      </div>
    </div>
    <div class="limiar-linha">
      <label for="limiar">Similaridade mínima: <output id="limiarVal">60%</output></label>
      <input type="range" id="limiar" min="50" max="100" step="5" value="60">
      <span class="dica">A busca é difusa: encontra grafia parecida, erro de digitação, ordem trocada e transliteração. Nascimento, país e documento ajustam a nota: confirmam ou afastam homônimos.</span>
    </div>
  </section>

  @@FAIXA@@<section class="kpis">@@CARTOES@@</section>

  <section class="resultados">
    <div class="barra"><span id="contagem">Carregando as listas…</span>
      <a class="baixar" href="@@PATH@@/dados/listas-completas.zip">Baixar as listas (CSV)</a></div>
    <div id="lista" class="lista"></div>
    <button id="mais" class="mais" hidden>Mostrar mais</button>
  </section>

  <section class="lote" id="lote">
    <h2>Triagem em lote</h2>
    <p>Precisa checar uma carteira inteira? Envie um CSV com nomes (e documento, se tiver) e receba
    o melhor resultado de cada linha com o percentual de similaridade. <strong>O arquivo não sai do seu navegador</strong>:
    não há upload para servidor nenhum.</p>
    <div class="envio">
      <input type="file" id="arquivo" accept=".csv,text/csv">
      <span class="dica">Aceita vírgula ou ponto e vírgula. Detecta a coluna de nome automaticamente.</span>
    </div>
    <p class="ou">ou cole a lista aqui</p>
    <div class="envio"><textarea id="colar" rows="3"
      placeholder="Um nome por linha — ou cole direto do Excel (com cabeçalho nome;documento)"></textarea>
      <button id="triarColado" class="botao">Triar</button></div>
    <div class="limiar-linha">
      <label for="limiarLote">Considerar correspondência a partir de: <output id="limiarLoteVal">85%</output></label>
      <input type="range" id="limiarLote" min="60" max="100" step="5" value="85">
    </div>
    <div id="resumoLote"></div>
    <div id="tabelaLote"></div>
    <button id="baixarLote" class="mais" hidden>Baixar o resultado em CSV</button>
  </section>

  @@MUDOU@@

  <section class="watch">
    <h2>Minha lista de vigilância</h2>
    <p>Cadastre nomes que você acompanha de perto. Eles ficam salvos apenas neste navegador e são
    conferidos a cada visita — se algum aparecer em uma lista nova, você vê na hora.</p>
    <div class="envio"><input id="watchNome" type="text" placeholder="Nome ou documento">
      <button id="watchAdd" class="botao">Adicionar</button></div>
    <div id="watchLista"></div>
  </section>

  <section class="sobre">
    <h2>O que este site é (e o que não é)</h2>
    <p>Reúne as principais listas de sanções usadas no Brasil em um só lugar, direto das fontes oficiais:
    <strong>OFAC</strong> (Tesouro dos EUA, SDN e lista consolidada não-SDN), <strong>Conselho de Segurança da ONU</strong>, <strong>União Europeia</strong>,
    <strong>Reino Unido</strong> (OFSI/FCDO), <strong>CEIS</strong>, <strong>Lista Suja</strong>, <strong>TCU</strong> e <strong>Banco Central</strong>, além de PEP. Os dados são baixados e republicados todos os dias às 06:00 (horário de Brasília).</p>
    <p><strong>O que não é:</strong> não é parecer jurídico, não é triagem de KYC e não substitui a consulta à fonte
    oficial. Homônimo existe e é comum: um nome igual não significa que a pessoa é a mesma. Antes de qualquer
    decisão, abra o registro na fonte (o link está em cada resultado) e confira documento, data de nascimento e país.</p>
    <p>Atualizado em <strong>@@GERADO@@</strong>.</p>
  </section>"""
    corpo = (corpo.replace("@@CARTOES@@", cartoes).replace("@@PATH@@", PATH)
                  .replace("@@CHIPS@@", chips).replace("@@FAIXA@@", faixa_cache)
                  .replace("@@MUDOU@@", mudou).replace("@@GERADO@@", resumo.get("gerado_em_br", "")))

    escreve("index.html", pagina("%s - OFAC, ONU, UE e Reino Unido em uma busca" % CFG["titulo"],
                                 "Consulte e faça triagem em lote nas listas de sanções da OFAC, ONU, União Europeia e Reino Unido. "
                                 "Busca difusa com score de similaridade, checagem por documento e tudo no navegador.",
                                 corpo, "index.html", BASE + "/", hero=hero))

    # lote
    corpo_lote = """
  <h1>Triagem em lote</h1>
  <p class="entrada">Envie um CSV com a sua carteira de clientes, fornecedores ou parceiros e receba, linha por linha,
  o melhor resultado em cada lista, com percentual de similaridade.</p>

  <section class="lote">
    <div class="envio">
      <input type="file" id="arquivo" accept=".csv,text/csv">
      <span class="dica">Vírgula ou ponto e vírgula. Colunas reconhecidas: nome, name, cliente, fornecedor,
      razao_social; e documento, doc, cpf, cnpj, passport.</span>
    </div>
    <p class="ou">ou cole a lista aqui</p>
    <div class="envio"><textarea id="colar" rows="3"
      placeholder="Um nome por linha — ou cole direto do Excel (com cabeçalho nome;documento)"></textarea>
      <button id="triarColado" class="botao">Triar</button></div>
    <div class="limiar-linha">
      <label for="limiarLote">Considerar correspondência a partir de: <output id="limiarLoteVal">85%</output></label>
      <input type="range" id="limiarLote" min="60" max="100" step="5" value="85">
    </div>
    <div id="resumoLote"></div>
    <div id="tabelaLote"></div>
    <button id="baixarLote" class="mais" hidden>Baixar o resultado em CSV</button>
  </section>

  <section class="sobre">
    <h2>Como o score é calculado</h2>
    <p>Cada linha é comparada com os registros de todas as listas usando três medidas combinadas:
    <strong>Jaro-Winkler</strong> (peso 45%, boa para erro de digitação e prefixo igual),
    <strong>Dice sobre trigramas</strong> (peso 35%, boa para nome reordenado) e
    <strong>cobertura de tokens</strong> (peso 20%, quantas palavras do nome consultado aparecem no registro).</p>
    <p>Se o documento informado bater exatamente com um documento publicado na lista, o resultado vai direto para 100%.</p>
    <p><strong>Leitura do score:</strong> acima de 95% é correspondência forte (ainda assim confira o registro);
    entre 85% e 95%, provável; entre 70% e 85%, possível e vale abrir o registro; abaixo de 70%, provavelmente homônimo.</p>
    <p class="alerta">O arquivo é lido no seu navegador com FileReader. Nada é enviado, gravado ou registrado em servidor.
    Pode usar com dado de cliente sem sair da LGPD por causa desta ferramenta — mas a base de tratamento continua sendo sua responsabilidade.</p>
  </section>"""
    escreve("lote.html", pagina("Triagem em lote - %s" % CFG["titulo"],
                                "Faça triagem de uma carteira inteira nas listas de sanções, com score de similaridade.",
                                corpo_lote, "lote.html", BASE + "/lote.html"))

    # mudancas
    linhas = ""
    for h in reversed(historico[-60:]):
        nomes = ", ".join(n["n"] for n in h.get("nomes", [])[:8])
        linhas += ('<tr><td>%s %s</td><td>%s</td><td>%s</td><td>%s</td></tr>'
                   % (h.get("data", ""), h.get("hora", ""), h.get("novos", 0), h.get("removidos", 0),
                      nomes or "—"))
    if not linhas:
        linhas = '<tr><td colspan="4">O histórico começa a ser gravado a partir da segunda execução diária.</td></tr>'
    corpo_hist = ("""<h1>Mudanças</h1>
  <p class="entrada">Tudo o que entrou e saiu das listas, dia a dia. O histórico é o que
  transforma consulta em monitoramento: dá para provar quando um nome apareceu.</p>
  <table class="tabela"><thead><tr><th>Quando</th><th>Entraram</th><th>Saíram</th><th>Nomes</th></tr></thead>
  <tbody>%s</tbody></table>
  <p class="miudo">Fonte: diferença entre a carga do dia e a do dia anterior, por id de registro.</p>""" % linhas)
    escreve("mudancas.html", pagina("Mudanças - %s" % CFG["titulo"],
                                    "Histórico diário de inclusões e remoções nas listas OFAC, ONU e UE.",
                                    corpo_hist, "mudancas.html", BASE + "/mudancas.html"))

    # verificar
    corpo_verifica = """
  <h1>Verificar um arquivo</h1>
  <p class="entrada">Todo dia o site publica o SHA-256 do CSV e do índice, encadeado com o hash do dia anterior.
  Solte aqui o arquivo que você apresentou ao compliance: ele diz de que dia é, e se alguma linha do passado
  foi mexida depois.</p>

  <section class="lote">
    <div class="envio"><input type="file" id="arquivoVerifica" accept=".csv,.zip">
      <span class="dica">Aceita o CSV avulso ou o zip das listas. Nada é enviado: o cálculo é feito no seu navegador.</span></div>
    <div id="resultadoVerifica" class="resultado-verifica"></div>
  </section>

  <section class="sobre">
    <h2>Como a corrente funciona</h2>
    <p>Cada dia vira uma linha do manifesto com quatro coisas: o SHA-256 do CSV, o SHA-256 do índice JSON,
    o SHA-256 do zip e o <strong>hash da linha anterior</strong>. A linha inteira é assinada por um quinto campo,
    o hash da própria linha.</p>
    <p>Mexer em qualquer dia do passado muda o hash daquela linha, o que quebra o elo de todas as seguintes:
    a adulteração fica visível, mesmo que alguém regenere os arquivos. É a mesma ideia de uma cadeia de blocos,
    reduzida ao que interessa aqui.</p>
    <p>O manifesto fica versionado no repositório e é comitado pelo robô a cada execução, então o histórico do
    Git é a segunda testemunha: cada versão do manifesto aponta para o commit que a gerou.</p>
    <p class="alerta">Limite honesto: isso prova que o arquivo é o que o site publicou naquele dia e que o
    histórico não foi reescrito. Não é assinatura criptográfica com chave privada — para isso seria preciso
    uma chave guardada em segredo no repositório. Se precisar desse nível (ou de carimbo de tempo de terceiro),
    eu preparo.</p>
  </section>

  <section class="sobre">
    <h2>Últimos dias publicados</h2>
    <table class="tabela"><thead><tr><th>Data</th><th>Registros</th><th>SHA-256 do CSV</th><th>Elo anterior</th></tr></thead>
    <tbody id="tabelaManifesto"><tr><td colspan="4">Carregando…</td></tr></tbody></table>
    <p class="miudo">Manifesto completo em <a href="@@PATH@@/dados/manifesto.json">dados/manifesto.json</a>.</p>
  </section>
  <script src="@@PATH@@/verificar.js"></script>"""
    corpo_verifica = corpo_verifica.replace("@@PATH@@", PATH)
    escreve("verificar.html", pagina("Verificar arquivo - %s" % CFG["titulo"],
                                     "Confira o SHA-256 de um CSV das listas de sanções e descubra de que dia ele é.",
                                     corpo_verifica, "verificar.html", BASE + "/verificar.html"))

    # api
    corpo_api = ("""<h1>API</h1>
  <p class="entrada">Todos os dados são arquivos estáticos públicos. Não precisa de chave, cadastro nem token.</p>
  <table class="tabela"><thead><tr><th>Arquivo</th><th>O que é</th></tr></thead><tbody>
  <tr><td><a href="%(p)s/dados/indice.json">dados/indice.json</a></td><td>Todos os registros, em formato compacto:
  [id, nome, aliases, fonte, tipo, programa, país, data, link, extra, documentos, presente_em]</td></tr>
  <tr><td><a href="%(p)s/dados/resumo.json">dados/resumo.json</a></td><td>Contagens, data da carga e o que mudou nas últimas 24h</td></tr>
  <tr><td><a href="%(p)s/dados/historico.json">dados/historico.json</a></td><td>Histórico diário de inclusões e remoções</td></tr>
  <tr><td><a href="%(p)s/dados/listas-completas.zip">dados/listas-completas.zip</a></td><td>Planilha única em CSV com as três listas</td></tr>
  <tr><td><a href="%(p)s/dados/sancoes.csv">dados/sancoes.csv</a></td><td>O mesmo CSV, avulso, para conferir o hash</td></tr>
  <tr><td><a href="%(p)s/dados/manifesto.json">dados/manifesto.json</a></td><td>Manifesto encadeado: SHA-256 do CSV, do índice e do zip, por dia</td></tr>
  </tbody></table>
  <h2>Exemplo</h2>
  <pre class="codigo">curl -s %(b)s/dados/resumo.json</pre>
  <h2>Uso e limites</h2>
  <p>Dados públicos, republicados com atribuição. Cite a fonte original (OFAC, ONU, UE) em qualquer uso.
  O arquivo é regerado todo dia às 06:00 de Brasília; se precisar do instante exato, leia o campo
  <code>gerado_em</code> do resumo.</p>""" ) % {"p": PATH, "b": BASE}
    escreve("api.html", pagina("API - %s" % CFG["titulo"],
                               "Endpoints JSON públicos das listas de sanções consolidada.",
                               corpo_api, "api.html", BASE + "/api.html"))

    paginas_extra.gera(OUT, PATH, BASE, CFG, pagina, escreve)

    escreve("robots.txt", "User-agent: *\nAllow: /\nSitemap: %s/sitemap.xml\n" % BASE)
    paginas = ["", "lote.html", "mudancas.html", "dossie.html", "decisoes.html", "verificar.html", "api.html"]
    escreve("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n'
                           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                           + "".join("<url><loc>%s/%s</loc></url>" % (BASE, p) for p in paginas)
                           + "</urlset>\n")
    if DOMINIO:
        escreve("CNAME", DOMINIO + "\n")

    tamanho = os.path.getsize(os.path.join(OUT, "dados", "indice.json"))
    print("site gerado: %d registros | %d com documento | indice %.1f MB | historico: %d dias"
          % (len(registros), com_doc, tamanho / 1e6, len(historico)))
    print("manifesto: %d dias | cadeia %s%s"
          % (len(manifesto), "ok" if cadeia_ok else "QUEBRADA",
             "" if cadeia_ok else " no elo %d" % quebrado))
    if not cadeia_ok:
        sys.exit(1)

if __name__ == "__main__":
    main()
