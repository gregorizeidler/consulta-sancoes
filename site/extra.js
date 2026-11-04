(function () {
  "use strict";
  var link = document.querySelector('link[rel="stylesheet"]');
  var BASE = link ? link.getAttribute("href").replace(/\/style\.css.*$/, "") : "";
  var CHAVE = "sancoes:decisoes";
  var NOMES = { confirmado: "Confirmado", falso_positivo: "Falso positivo", homonimo: "Homônimo" };

  function escapa(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function ler() { try { return JSON.parse(localStorage.getItem(CHAVE)) || []; } catch (e) { return []; } }
  function gravar(l) { try { localStorage.setItem(CHAVE, JSON.stringify(l)); } catch (e) {} }
  var dsCache;
  function dataset() {
    if (dsCache !== undefined) return Promise.resolve(dsCache);
    return fetch(BASE + "/dados/manifesto.json?v=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) { dsCache = (j && j.length) ? j[j.length - 1] : null; return dsCache; })
      .catch(function () { dsCache = null; return null; });
  }
  function dataBr(iso) { return iso && iso.length >= 10 ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : ""; }
  function quandoBr(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("pt-BR"); }
  function decisaoDe(id) { var l = ler(); for (var i = 0; i < l.length; i++) { if (l[i].id === id) return l[i]; } return null; }

  function salvar(reg) {
    return dataset().then(function (d) {
      reg.dataset = d ? { data: d.data, hora: d.hora, total: d.total, csv_sha256: d.csv_sha256, cadeia_hash: d.cadeia_hash } : null;
      var l = ler().filter(function (x) { return x.id !== reg.id; });
      l.unshift(reg);
      gravar(l);
      return reg;
    });
  }

  function csvDecisoes() {
    var linhas = [["id", "nome", "score", "decisao", "nota", "quando", "dataset_data", "dataset_hash", "total_registros"]];
    ler().forEach(function (d) {
      linhas.push([d.id, d.nome, d.score, NOMES[d.decisao] || d.decisao, d.nota || "", d.quando,
        d.dataset ? d.dataset.data : "", d.dataset ? d.dataset.csv_sha256 : "", d.dataset ? d.dataset.total : ""]);
    });
    return linhas.map(function (l) {
      return l.map(function (c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; }).join(";");
    }).join("\r\n");
  }
  function baixar(nome, texto, tipo) {
    var blob = new Blob(["\ufeff" + texto], { type: tipo || "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function botoes(item) {
    if (item.querySelector(".dec")) return;
    var id = item.getAttribute("data-id");
    if (!id) return;
    var atual = decisaoDe(id), wrap = document.createElement("div");
    wrap.className = "dec";
    if (atual) {
      wrap.innerHTML = '<span class="dec-atual">' + escapa(NOMES[atual.decisao] || atual.decisao) +
        '</span> <span class="dec-quando">' + escapa(quandoBr(atual.quando)) + "</span>" +
        ' <button class="dec-btn" data-acao="limpar">refazer</button>';
    } else {
      wrap.innerHTML = '<span class="dec-pergunta">Decisão:</span>' +
        ' <button class="dec-btn" data-acao="confirmado">Confirmado</button>' +
        ' <button class="dec-btn" data-acao="falso_positivo">Falso positivo</button>' +
        ' <button class="dec-btn" data-acao="homonimo">Homônimo</button>';
    }
    item.appendChild(wrap);
  }
  function observarLista() {
    var alvo = document.getElementById("lista");
    if (!alvo || !window.MutationObserver) return;
    var mo = new MutationObserver(function () {
      [].forEach.call(alvo.querySelectorAll(".item"), botoes);
    });
    mo.observe(alvo, { childList: true, subtree: true });
    [].forEach.call(alvo.querySelectorAll(".item"), botoes);
  }
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest(".dec-btn") : null;
    if (!b) return;
    var item = b.closest(".item");
    if (!item) return;
    ev.preventDefault();
    var id = item.getAttribute("data-id"), nome = item.getAttribute("data-nome"), score = Number(item.getAttribute("data-score"));
    var acao = b.getAttribute("data-acao");
    if (acao === "limpar") {
      gravar(ler().filter(function (x) { return x.id !== id; }));
      var w = item.querySelector(".dec"); if (w) w.remove();
      botoes(item);
      return;
    }
    var nota = window.prompt("Justificativa (vai para o registro de auditoria):", "");
    if (nota === null) return;
    salvar({ id: id, nome: nome, score: score, decisao: acao, nota: nota, quando: new Date().toISOString() })
      .then(function () { var w = item.querySelector(".dec"); if (w) w.remove(); botoes(item); });
  });

  function paginaDecisoes() {
    var corpo = document.getElementById("tabelaDecisoes");
    if (!corpo) return;
    var filtro = document.getElementById("filtroDecisao");
    function desenhar() {
      var l = ler(), q = filtro && filtro.value ? filtro.value : "todas";
      if (q !== "todas") l = l.filter(function (d) { return d.decisao === q; });
      if (!l.length) {
        corpo.innerHTML = '<tr><td colspan="5">Nenhuma decisão registrada ainda. Abra a busca, encontre um nome e marque o que ele é.</td></tr>';
        return;
      }
      corpo.innerHTML = l.map(function (d) {
        return "<tr><td>" + escapa(d.nome) + "</td><td>" + escapa(NOMES[d.decisao] || d.decisao) +
          '</td><td><span class="dec-nota">' + escapa(d.nota || "—") + "</span></td><td>" + escapa(quandoBr(d.quando)) +
          "</td><td><code>" + escapa(d.dataset ? (d.dataset.csv_sha256 || "").slice(0, 12) + "…" : "—") + "</code></td></tr>";
      }).join("");
    }
    if (filtro) filtro.addEventListener("change", desenhar);
    var exp = document.getElementById("exportarDecisoes");
    if (exp) exp.addEventListener("click", function () { baixar("decisoes-triagem.csv", csvDecisoes()); });
    var imp = document.getElementById("imprimirDecisoes");
    if (imp) imp.addEventListener("click", function () { window.print(); });
    var limpar = document.getElementById("limparDecisoes");
    if (limpar) limpar.addEventListener("click", function () {
      if (window.confirm("Apagar todas as decisões deste navegador? Baixe o CSV antes.")) { gravar([]); desenhar(); }
    });
    dataset();
    desenhar();
  }

  function paginaDossie() {
    var alvo = document.getElementById("dossie");
    if (!alvo) return;
    var q = new URLSearchParams(location.search);
    var nome = (q.get("nome") || "").trim();
    var limiar = parseInt(q.get("limiar") || "85", 10);
    var M = window.Motor;
    Promise.all([
      fetch(BASE + "/dados/indice.json").then(function (r) { return r.json(); }),
      dataset(),
      fetch(BASE + "/dados/resumo.json?v=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.json(); }).catch(function () { return {}; })
    ]).then(function (tudo) {
      var dados = tudo[0], ds = tudo[1], resumo = tudo[2];
      M.prepara(dados);
      var qn = M.norm(nome);
      var achados = [];
      if (qn.length >= 3) {
        var cand = M.candidatos(dados, qn, { fonte: "todas", tipo: "todos" }, 400);
        cand.forEach(function (par) {
          var d = par[1], s = M.melhorSim(qn, d.__n, d.__aliases);
          if (s >= limiar) achados.push({ d: d, score: s });
        });
        achados.sort(function (a, b) { return b.score - a.score; });
      }
      var decs = ler().filter(function (x) { return M.norm(x.nome) === qn; });
      var linhas = achados.slice(0, 25).map(function (a) {
        var d = a.d, exp = M.explica(qn, d.__n);
        return "<tr><td>" + escapa(d[1]) + "</td><td>" + a.score + "%</td><td>" +
          escapa((d[10] || []).slice(0, 2).join(" · ") || "—") + "</td><td>" +
          escapa((d[5] || "—").slice(0, 60)) + "</td><td>" + escapa(d[7] || "—") +
          "</td><td>" + escapa(exp.comuns.length + "/" + (exp.comuns.length + exp.faltando.length)) + "</td></tr>";
      }).join("");
      var decHtml = decs.length ? decs.map(function (x) {
        return '<p class="dossie-dec"><b>' + escapa(NOMES[x.decisao] || x.decisao) + "</b> — " + escapa(x.nota || "sem justificativa") +
          ' <span class="miudo">(' + escapa(quandoBr(x.quando)) + ")</span></p>";
      }).join("") : '<p class="dossie-dec vazio">Nenhuma decisão registrada para este nome neste navegador.</p>';
      var hash = ds ? ds.csv_sha256 : "";
      alvo.innerHTML =
        '<header class="dossie-cab"><div><h1>Dossiê de triagem</h1>' +
        '<p class="dossie-sub">Consulta de Sanções — OFAC, ONU, UE</p></div>' +
        '<div class="dossie-data"><p><b>Emitido em</b><br>' + escapa(new Date().toLocaleString("pt-BR")) + "</p></div></header>" +
        '<section class="dossie-bloco"><h2>Nome consultado</h2><p class="dossie-nome">' + escapa(nome || "(não informado)") + "</p>" +
        '<p class="miudo">Limiar de corte: ' + limiar + "% · " + achados.length + " correspondência(s) acima do limiar</p></section>" +
        '<section class="dossie-bloco"><h2>Base consultada</h2><p>' + (ds ? Number(ds.total).toLocaleString("pt-BR") + " registros, carga de " + dataBr(ds.data) + " às " + (ds.hora || "") : "manifesto indisponível") + "</p>" +
        '<p class="dossie-hash">SHA-256 do dataset: <code>' + escapa(hash) + "</code></p>" +
        '<p class="miudo">O hash prova qual versão da lista foi usada nesta consulta. Confira em /verificar.html.</p></section>' +
        '<section class="dossie-bloco"><h2>Correspondências</h2>' +
        (linhas ? '<table class="tabela dossie-tab"><thead><tr><th>Registro</th><th>Score</th><th>Documento</th><th>Lista / programa</th><th>Data</th><th>Palavras</th></tr></thead><tbody>' + linhas + "</tbody></table>"
                : "<p>Nenhum registro acima de " + limiar + "%.</p>") +
        "</section>" +
        '<section class="dossie-bloco"><h2>Decisão</h2>' + decHtml + "</section>" +
        '<footer class="dossie-rodape"><p>' + escapa(new Date().toLocaleString("pt-BR")) + " · " + achados.length + " registro(s) · base " +
        (ds ? Number(ds.total).toLocaleString("pt-BR") : "—") + " de " + (ds ? dataBr(ds.data) : "—") + "</p>" +
        "<p>Hash: " + escapa((hash || "").slice(0, 32)) + "… · documento gerado por consulta-sancoes</p></footer>";
      var imp = document.getElementById("imprimirDossie");
      if (imp) imp.addEventListener("click", function () { window.print(); });
    }).catch(function (e) {
      alvo.innerHTML = '<p class="erro">Não foi possível montar o dossiê: ' + escapa(e && e.message ? e.message : "erro") + "</p>";
    });
  }

  function paginaEntidade() {
    var alvo = document.getElementById("entidade");
    if (!alvo) return;
    var id = new URLSearchParams(location.search).get("id") || "";
    Promise.all([
      fetch(BASE + "/dados/indice.json").then(function (r) { return r.json(); }),
      fetch(BASE + "/dados/historico.json?v=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.json(); }).catch(function () { return []; }),
      dataset()
    ]).then(function (tudo) {
      var dados = tudo[0], hist = tudo[1] || [], ds = tudo[2];
      var d = null;
      for (var i = 0; i < dados.length; i++) { if (dados[i][0] === id) { d = dados[i]; break; } }
      if (!d) { alvo.innerHTML = "<p>Registro <code>" + escapa(id) + "</code> não encontrado nesta carga.</p>"; return; }
      var F = { ofac: "OFAC (EUA)", un: "ONU", eu: "União Europeia", pep: "PEP (Brasil)", ceis: "CEIS (Brasil)" };
      var T = { pessoa: "Pessoa", entidade: "Entidade", embarcacao: "Embarcação", aeronave: "Aeronave" };
      var al = (d[2] || []);
      var dec = decisaoDe(d[0]);
      var M = window.Motor;
      var qn = M.norm(d[1]);
      var dias = [];
      hist.forEach(function (h) {
        (h.nomes || []).forEach(function (n) { if (M.norm(n.n) === qn) dias.push(h.data + " " + (h.hora || "")); });
      });
      alvo.innerHTML = "<h1>" + escapa(d[1]) + "</h1>" +
        '<p class="entidade-meta">' + escapa(F[d[3]] || d[3]) + " · " + escapa(T[d[4]] || d[4]) + " · " + escapa(d[5] || "—") + "</p>" +
        '<table class="tabela"><tbody>' +
        "<tr><th>Registro</th><td><code>" + escapa(d[0]) + "</code></td></tr>" +
        (al.length ? "<tr><th>Também conhecido como</th><td>" + escapa(al.join(" · ")) + "</td></tr>" : "") +
        ((d[10] || []).length ? "<tr><th>Documentos</th><td>" + escapa(d[10].join(" · ")) + "</td></tr>" : "") +
        (d[6] ? "<tr><th>País</th><td>" + escapa(d[6]) + "</td></tr>" : "") +
        (d[7] ? "<tr><th>Data na lista</th><td>" + escapa(d[7]) + "</td></tr>" : "") +
        (d[9] ? "<tr><th>Detalhe</th><td>" + escapa(d[9]) + "</td></tr>" : "") +
        (d[11] ? "<tr><th>Presente também em</th><td>" + escapa(String(d[11]).split(",").map(function (x) { return F[x] || x; }).join(", ")) + "</td></tr>" : "") +
        "</tbody></table>" +
        '<p><a class="botao" href="' + escapa(d[8]) + '" target="_blank" rel="noopener">Ver na fonte oficial</a>' +
        ' <a class="botao" href="' + BASE + '/dossie.html?nome=' + encodeURIComponent(d[1]) + '">Gerar dossiê deste nome</a></p>' +
        "<h2>Histórico</h2>" +
        (dias.length ? "<p>Entrou na carga de " + escapa(dias.slice(0, 5).join(", ")) + ".</p>"
                     : "<p>Sem registro de entrada nas últimas cargas (o histórico começou em 30/10/2026).</p>") +
        "<h2>Decisão</h2>" +
        (dec ? "<p><b>" + escapa(NOMES[dec.decisao] || dec.decisao) + "</b> — " + escapa(dec.nota || "sem justificativa") + ' <span class="miudo">(' + escapa(quandoBr(dec.quando)) + ")</span></p>"
             : '<p class="miudo">Nenhuma decisão registrada para este registro.</p>') +
        '<p class="miudo">Base: ' + (ds ? Number(ds.total).toLocaleString("pt-BR") + " registros, carga de " + dataBr(ds.data) : "—") + " · hash " + escapa(ds ? (ds.csv_sha256 || "").slice(0, 16) + "…" : "—") + "</p>";
    }).catch(function (e) {
      alvo.innerHTML = '<p class="erro">Falha ao abrir o registro: ' + escapa(e && e.message ? e.message : "erro") + "</p>";
    });
  }

  function iniciar() {
    observarLista();
    paginaDecisoes();
    paginaDossie();
    paginaEntidade();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();

(function () {
  "use strict";
  var alvo = document.getElementById("fontes");
  if (!alvo) return;
  var link = document.querySelector('link[rel="stylesheet"]');
  var BASE = link ? link.getAttribute("href").replace(/\/style\.css.*$/, "") : "";
  var rotulo = document.createElement("label");
  rotulo.className = "pep-opcao";
  rotulo.innerHTML = '<input type="checkbox" id="incluirPep"> incluir PEP — 106 mil nomes de pessoas expostas politicamente <span class="pep-estado"></span>';
  alvo.parentNode.insertBefore(rotulo, alvo.nextSibling);
  var caixa = document.getElementById("incluirPep");
  var estado = rotulo.querySelector(".pep-estado");
  caixa.addEventListener("change", function () {
    if (!caixa.checked) return;
    if (!window.SancoesApp) { estado.textContent = "indisponível nesta página"; return; }
    caixa.disabled = true;
    estado.textContent = "carregando…";
    fetch(BASE + "/dados/pep.json?v=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (lista) {
        window.SancoesApp.adicionar(lista);
        estado.textContent = "(" + lista.length.toLocaleString("pt-BR") + " nomes carregados)";
        caixa.disabled = false;
      })
      .catch(function () {
        estado.textContent = "falhou ao carregar";
        caixa.checked = false;
        caixa.disabled = false;
      });
  });
})();
