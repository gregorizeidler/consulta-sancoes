# -*- coding: utf-8 -*-
"""Páginas de decisão, dossiê e entidade.

O HTML aqui é só o casco: quem desenha é o site/extra.js, que trabalha com o índice
já publicado. Assim o robô continua leve e nenhuma lógica de auditoria fica no servidor.
"""
import os


def injeta_extra(caminho, PATH, nome="extra.js"):
    """Acrescenta o script do extra.js em qualquer página que ainda não o tenha."""
    if not os.path.exists(caminho):
        return
    html = open(caminho, encoding="utf-8").read()
    if nome in html:
        return
    tag = '<script src="%s/%s"></script>' % (PATH, nome)
    if "</body>" in html:
        html = html.replace("</body>", tag + "\n</body>")
        open(caminho, "w", encoding="utf-8").write(html)


def gera(OUT, PATH, BASE, CFG, pagina, escreve):
    corpo_dec = ("""<h1>Decisões</h1>
  <p class="entrada">Todo nome que você marcou como confirmado, falso positivo ou homônimo, com a justificativa
  e o hash do dataset usado naquele momento. Fica no seu navegador; o CSV é a sua cópia de auditoria.</p>
  <p class="nao-imprimir"><label for="filtroDecisao">Mostrar:</label>
    <select id="filtroDecisao">
      <option value="todas">Todas</option>
      <option value="confirmado">Confirmado</option>
      <option value="falso_positivo">Falso positivo</option>
      <option value="hominimo">x</option>
    </select>
    <button class="botao" id="exportarDecisoes">Baixar CSV</button>
    <button class="botao" id="imprimirDecisoes">Imprimir / PDF</button>
    <button class="botao" id="limparDecisoes">Apagar tudo</button></p>
  <table class="tabela"><thead><tr><th>Nome</th><th>Decisão</th><th>Justificativa</th><th>Quando</th><th>Dataset</th></tr></thead>
  <tbody id="tabelaDecisoes"><tr><td colspan="5">Carregando…</td></tr></tbody></table>
  <p class="miudo">O CSV sai com nome, score, decisão, justificativa, data e o hash do dataset — o suficiente
  para anexar ao dossiê.</p>""")
    corpo_dec = corpo_dec.replace('<option value="hominimo">x</option>', '<option value="homonimo">Homônimo</option>')
    escreve("decisoes.html", pagina("Decisões - %s" % CFG["titulo"],
                                    "Registro de decisões de triagem com justificativa e hash do dataset.",
                                    corpo_dec, "decisoes.html", BASE + "/decisoes.html"))

    corpo_dossie = ("""<p class="nao-imprimir">
    <button class="botao" id="imprimirDossie">Imprimir / salvar em PDF</button>
    <a class="botao" href="@@PATH@@/index.html">Nova consulta</a></p>
  <p class="miudo nao-imprimir">Abra esta página com <code>?nome=NOME COMPLETO&amp;limiar=85</code>.
  O PDF sai com o cabeçalho da consulta, a base usada, o SHA-256 do dataset e a decisão registrada.</p>
  <div class="dossie" id="dossie"><p>Montando o dossiê…</p></div>""").replace("@@PATH@@", PATH)
    escreve("dossie.html", pagina("Dossiê de triagem - %s" % CFG["titulo"],
                                  "Dossiê de triagem pronto para arquivar: nome, base consultada, hash e decisão.",
                                  corpo_dossie, "dossie.html", BASE + "/dossie.html"))

    corpo_ent = '<div id="entidade"><p>Carregando registro…</p></div>'
    escreve("entidade.html", pagina("Registro - %s" % CFG["titulo"],
                                    "Ficha do registro na lista de sanções, com histórico e fonte oficial.",
                                    corpo_ent, "entidade.html", BASE + "/entidade.html"))

    for arq in sorted(os.listdir(OUT)):
        if arq.endswith(".html"):
            injeta_extra(os.path.join(OUT, arq), PATH)
