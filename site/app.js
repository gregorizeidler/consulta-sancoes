(function () {
  "use strict";
  var M = window.Motor;
  var link = document.querySelector('link[rel="stylesheet"]');
  var BASE = link ? link.getAttribute("href").replace(/\/style\.css.*$/, "") : "";
  var FONTES = { ofac: "OFAC SDN", ofacns: "OFAC não-SDN", un: "ONU", eu: "UE", uk: "Reino Unido", pep: "PEP", ceis: "CEIS", cnep: "CNEP", slavery: "Lista Suja", tcu: "TCU", bcb: "BCB" };
  var TIPOS = { pessoa: "Pessoa", entidade: "Entidade", embarcacao: "Embarcação", aeronave: "Aeronave", outro: "Outro" };

  function absoluta(caminho) { return new URL(BASE + caminho, document.baseURI).href; }

  // A busca roda num Web Worker: o JSON de dezenas de milhares de registros e o indice
  // invertido nao travam a tela. Sem Worker (ou se o script nao carregar), o mesmo motor
  // roda na thread principal pelo mesmo contrato de mensagens.
  function criaBackend() {
    var worker = null, local = null, pend = {}, seq = 0, pronto = false, modo = "worker";
    function viraLocal() {
      modo = "local";
      local = M.servidor();
      var ids = Object.keys(pend);
      for (var i = 0; i < ids.length; i++) {
        var p = pend[ids[i]]; delete pend[ids[i]];
        M.despacha(local, p.tipo, p.args).then(p.res, p.rej);
      }
    }
    try {
      if (typeof Worker === "undefined") throw new Error("sem Worker");
      worker = new Worker(BASE + "/worker.js");
      worker.onmessage = function (e) {
        var m = e.data || {};
        if (m.pronto) { pronto = true; return; }
        var p = pend[m.id];
        if (!p) return;
        delete pend[m.id];
        if (m.ok) p.res(m.valor); else p.rej(new Error(m.erro));
      };
      worker.onerror = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (!pronto) {
          try { worker.terminate(); } catch (e) {}
          worker = null;
          viraLocal();
          return;
        }
        var ids = Object.keys(pend);
        for (var i = 0; i < ids.length; i++) { var p = pend[ids[i]]; delete pend[ids[i]]; p.rej(new Error("o worker de busca parou")); }
      };
    } catch (e) {
      worker = null; modo = "local"; local = M.servidor();
    }
    return {
      modo: function () { return modo; },
      chama: function (tipo, args) {
        return new Promise(function (res, rej) {
          if (modo === "local") { M.despacha(local, tipo, args).then(res, rej); return; }
          var id = ++seq;
          pend[id] = { tipo: tipo, args: args, res: res, rej: rej };
          worker.postMessage({ id: id, tipo: tipo, args: args });
        });
      }
    };
  }
  var backend = criaBackend();
  var carregado = false, totalBase = 0;

  function escapa(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function selo(score) {
    var f = M.faixa(score);
    return '<span class="score ' + f[1] + '">' + score + '% <em>' + f[0] + '</em></span>';
  }
  function chipsAjuste(m) {
    var h = "";
    for (var i = 0; i < (m.ajustes || []).length; i++) {
      var a = m.ajustes[i];
      h += '<span class="aj ' + (a.delta >= 0 ? "pos" : "neg") + '">' + escapa(a.rotulo) + " " + (a.delta > 0 ? "+" : "") + a.delta + "</span>";
    }
    return h;
  }
  function cartao(m, aberto) {
    var d = m.rec;
    var aliases = (d[2] || []).slice(0, 6).join(", ");
    var det = "";
    if (aliases) det += "<p><b>Também conhecido como:</b> " + escapa(aliases) + "</p>";
    if (d[10] && d[10].length) det += "<p><b>Documentos:</b> " + escapa(d[10].join(" · ")) + "</p>";
    if (d[9]) det += "<p><b>Detalhe:</b> " + escapa(d[9]) + "</p>";
    if (d[6]) det += "<p><b>País:</b> " + escapa(d[6]) + "</p>";
    if (d[11]) det += "<p><b>Presente também em:</b> " + escapa(d[11].split(",").map(function (x) { return FONTES[x] || x; }).join(", ")) + "</p>";
    var exp = m.exp;
    if (exp) {
      var partes = ["casou " + exp.comuns.length + " de " + (exp.comuns.length + exp.faltando.length) + " palavra(s)"];
      if (m.via) partes.push("pelo apelido \u201c" + m.via + "\u201d");
      if (exp.ordemTrocada) partes.push("mesmas palavras, outra ordem");
      if (exp.fonetica) partes.push("grafia diferente, mesmo som");
      if (exp.faltando.length) partes.push("faltou: " + exp.faltando.slice(0, 4).join(", "));
      det += '<p class="porque"><b>Por que casou:</b> ' + escapa(partes.join(" \u00b7 ")) +
        ' <span class="comp">Jaro-Winkler ' + exp.jw + "% \u00b7 trigramas " + exp.dice + "% \u00b7 cobertura " + exp.cobertura + "%</span></p>";
    }
    if (m.ajustes && m.ajustes.length) {
      det += '<p class="porque"><b>Contexto:</b> nome ' + m.base + "% \u2192 " + m.score + "% " + chipsAjuste(m) + "</p>";
    }
    det += '<p><a href="' + escapa(d[8]) + '" target="_blank" rel="noopener">Ver na fonte oficial</a></p>';
    return '<article class="item' + (aberto ? " aberto" : "") + '" data-id="' + escapa(d[0]) + '" data-nome="' + escapa(d[1]) + '" data-score="' + m.score + '">' +
      '<div class="linha"><h3>' + escapa(d[1]) + '</h3>' + selo(m.score) +
      '<span class="fonte ' + d[3] + '">' + (FONTES[d[3]] || d[3]) + '</span>' +
      '<span class="tipo">' + (TIPOS[d[4]] || d[4]) + '</span></div>' +
      '<div class="meta">' + escapa(d[5] || "\u2014") + (m.ajustes && m.ajustes.length ? " " + chipsAjuste(m) : "") + '</div>' +
      '<div class="det">' + det + '</div></article>';
  }

  // ---------- busca ----------
  var estado = { q: "", nasc: "", pais: "", doc: "", fonte: "todas", tipo: "todos", limiar: 60, achados: [], avisos: [], total: 0, mostrados: 50 };
  var campo = document.getElementById("q");
  var lista = document.getElementById("lista");
  var contagem = document.getElementById("contagem");
  var botaoMais = document.getElementById("mais");
  var avisosEl = document.getElementById("avisos");
  if (!avisosEl && contagem) {
    avisosEl = document.createElement("p");
    avisosEl.id = "avisos"; avisosEl.className = "aviso"; avisosEl.hidden = true;
    contagem.parentNode.insertBefore(avisosEl, contagem.nextSibling);
  }
  var seqBusca = 0;

  // ponte para o extra.js carregar bases extras (PEP) sem recarregar a pagina
  window.SancoesApp = {
    adicionar: function (lista) {
      return backend.chama("adicionar", { lista: lista }).then(function (t) { totalBase = t; buscar(); return t; });
    },
    adicionarUrl: function (caminho) {
      return backend.chama("adicionarUrl", { url: absoluta(caminho) }).then(function (r) { totalBase = r.total; buscar(); return r; });
    },
    total: function () { return totalBase; }
  };

  function mostraAvisos(av) {
    if (!avisosEl) return;
    avisosEl.hidden = !av || !av.length;
    avisosEl.textContent = av && av.length ? av.join(" ") : "";
  }

  function buscar() {
    if (!campo || !carregado) return;
    var id = ++seqBusca;
    var nomeOk = M.norm(estado.q).length >= 3;
    if (!nomeOk && !estado.doc) {
      estado.achados = []; estado.total = 0; estado.mostrados = 50;
      mostraAvisos([]);
      contagem.textContent = estado.q
        ? "Digite ao menos 3 letras."
        : totalBase.toLocaleString("pt-BR") + " registros carregados. Digite um nome, empresa, navio ou documento.";
      render();
      return;
    }
    if (lista) lista.setAttribute("aria-busy", "true");
    backend.chama("buscar", {
      consulta: { q: estado.q, nasc: estado.nasc, pais: estado.pais, doc: estado.doc },
      opts: { limiar: estado.limiar, fonte: estado.fonte, tipo: estado.tipo, maximo: 500 }
    }).then(function (r) {
      if (id !== seqBusca) return;
      estado.achados = r.resultados;
      estado.total = r.total;
      estado.avisos = r.avisos || [];
      estado.mostrados = 50;
      mostraAvisos(estado.avisos);
      contagem.textContent = r.total.toLocaleString("pt-BR") + " resultado(s) com " + estado.limiar +
        "% ou mais de similaridade \u00b7 " + r.ms + " ms" + (backend.modo() === "worker" ? "" : " (sem worker)");
      if (lista) lista.removeAttribute("aria-busy");
      render();
    }, function (e) {
      if (id !== seqBusca) return;
      contagem.textContent = "A busca falhou: " + e.message;
      if (lista) lista.removeAttribute("aria-busy");
    });
  }
  function render() {
    if (!lista) return;
    var fim = Math.min(estado.mostrados, estado.achados.length);
    var html = "";
    if ((estado.q || estado.doc) && !estado.achados.length && (M.norm(estado.q).length >= 3 || estado.doc)) {
      html = '<p class="vazio">Nenhum registro acima de ' + estado.limiar + '% de similaridade. ' +
        'Baixe a similaridade mínima, tente só o sobrenome ou confira a grafia em outro alfabeto.</p>';
    }
    for (var k = 0; k < fim; k++) html += cartao(estado.achados[k], k === 0 && estado.achados[k].score >= 95);
    lista.innerHTML = html;
    botaoMais.hidden = estado.achados.length <= estado.mostrados;
  }

  if (campo) {
    var timer = null;
    var CAMPOS = ["q", "nasc", "pais", "doc"], ELS = {};
    CAMPOS.forEach(function (k) { ELS[k] = document.getElementById(k === "q" ? "q" : "f-" + k) || (k === "q" ? campo : null); });
    function lerCampos() {
      CAMPOS.forEach(function (k) { if (ELS[k]) estado[k] = ELS[k].value.trim(); });
      try {
        var ps = new URLSearchParams();
        CAMPOS.forEach(function (k) { if (estado[k]) ps.set(k, estado[k]); });
        history.replaceState(null, "", ps.toString() ? "?" + ps.toString() : window.location.pathname);
      } catch (e) {}
    }
    CAMPOS.forEach(function (k) {
      if (!ELS[k]) return;
      ELS[k].addEventListener("input", function () {
        clearTimeout(timer);
        timer = setTimeout(function () { lerCampos(); buscar(); }, 150);
      });
    });
    var lf = document.getElementById("fontes");
    if (lf) lf.addEventListener("click", function (ev) {
      var b = ev.target.closest(".chip"); if (!b) return;
      [].forEach.call(this.querySelectorAll(".chip"), function (c) { c.classList.remove("ativo"); });
      b.classList.add("ativo"); estado.fonte = b.getAttribute("data-fonte"); buscar();
    });
    var lt = document.getElementById("tipos");
    if (lt) lt.addEventListener("click", function (ev) {
      var b = ev.target.closest(".chip"); if (!b) return;
      [].forEach.call(this.querySelectorAll(".chip"), function (c) { c.classList.remove("ativo"); });
      b.classList.add("ativo"); estado.tipo = b.getAttribute("data-tipo"); buscar();
    });
    var range = document.getElementById("limiar");
    var rangeVal = document.getElementById("limiarVal");
    if (range) range.addEventListener("input", function () {
      estado.limiar = Number(range.value);
      if (rangeVal) rangeVal.textContent = estado.limiar + "%";
      buscar();
    });
    if (botaoMais) botaoMais.addEventListener("click", function () { estado.mostrados += 50; render(); });
    if (lista) lista.addEventListener("click", function (ev) {
      var card = ev.target.closest(".item");
      if (!card || ev.target.tagName === "A") return;
      card.classList.toggle("aberto");
    });
    var params = new URLSearchParams(window.location.search);
    CAMPOS.forEach(function (k) {
      if (params.get(k) && ELS[k]) { ELS[k].value = params.get(k); estado[k] = params.get(k).trim(); }
    });
  }

  // ---------- CSV ----------
  function lerCsv(texto) {
    texto = texto.replace(/^\ufeff/, "");
    var linhas = texto.split(/\r?\n/).filter(function (l) { return l.trim().length; });
    if (!linhas.length) return { cabecalho: [], linhas: [] };
    var delim = (linhas[0].split(";").length >= linhas[0].split(",").length) ? ";" : ",";
    function quebra(l) {
      var out = [], atual = "", aspas = false;
      for (var i = 0; i < l.length; i++) {
        var c = l[i];
        if (c === '"') {
          if (aspas && l[i + 1] === '"') { atual += '"'; i++; }
          else aspas = !aspas;
        } else if (c === delim && !aspas) { out.push(atual); atual = ""; }
        else atual += c;
      }
      out.push(atual);
      return out.map(function (x) { return x.trim(); });
    }
    return { cabecalho: quebra(linhas[0]), linhas: linhas.slice(1).map(quebra) };
  }
  var COL_NOME = ["nome", "name", "cliente", "fornecedor", "razao social", "beneficiario", "titular", "socio", "contraparte"];
  var COL_DOC = ["documento", "doc", "cpf", "cnpj", "passaporte", "passport", "id", "rg"];
  var COL_NASC = ["nascimento", "data de nascimento", "data nascimento", "nasc", "dt nascimento", "dob", "birth date", "date of birth", "birthdate"];
  var COL_PAIS = ["pais", "country", "nacionalidade", "nationality"];
  function acharColuna(cabecalho, alvos) {
    for (var i = 0; i < cabecalho.length; i++) {
      if (alvos.indexOf(M.norm(cabecalho[i])) > -1) return i;
    }
    return -1;
  }
  function melhorPara(nome, doc, nasc, pais) {
    if (!(nome || doc)) return Promise.resolve(null);
    return backend.chama("melhor", { consulta: { q: nome, doc: doc, nasc: nasc, pais: pais }, opts: { candidatos: 300 } }).catch(function () { return null; });
  }

  var lote = { resultados: [], colNome: 0, colDoc: -1, colNasc: -1, colPais: -1, linhas: [], limiar: 85 };
  var arquivo = document.getElementById("arquivo");
  var tabelaLote = document.getElementById("tabelaLote");
  var resumoLote = document.getElementById("resumoLote");
  var baixarLote = document.getElementById("baixarLote");
  var limiarLote = document.getElementById("limiarLote");
  var limiarLoteVal = document.getElementById("limiarLoteVal");

  function processarLote() {
    if (!lote.linhas.length) return;
    var total = lote.linhas.length, saida = [], i = 0;
    resumoLote.innerHTML = '<p class="progresso">Triando 0 de ' + total + '…</p>';
    function passo() {
      if (i >= total) { lote.resultados = saida; mostrarLote(); return; }
      var linha = lote.linhas[i];
      var nome = linha[lote.colNome] || "";
      var doc = lote.colDoc > -1 ? (linha[lote.colDoc] || "") : "";
      var nasc = lote.colNasc > -1 ? (linha[lote.colNasc] || "") : "";
      var pais = lote.colPais > -1 ? (linha[lote.colPais] || "") : "";
      melhorPara(nome, doc, nasc, pais).then(function (m) {
        saida.push({ nome: nome, doc: doc, melhor: m });
        i++;
        if (i % 10 === 0 || i === total) {
          resumoLote.innerHTML = '<p class="progresso">Triando ' + i + ' de ' + total + ' (' + Math.round(100 * i / total) + '%)…</p>';
        }
        passo();
      });
    }
    passo();
  }
  function mostrarLote() {
    var limiar = lote.limiar;
    var acima = lote.resultados.filter(function (r) { return r.melhor && r.melhor.score >= limiar; });
    var total = lote.resultados.length;
    var taxa = total ? (100 * acima.length / total) : 0;
    resumoLote.innerHTML = '<div class="painel-lote">' +
      '<div class="kpi"><span>Linhas triadas</span><strong>' + total + '</strong></div>' +
      '<div class="kpi"><span>Correspondências ≥ ' + limiar + '%</span><strong>' + acima.length + '</strong></div>' +
      '<div class="kpi kpi-total"><span>Taxa de correspondência</span><strong>' +
      taxa.toFixed(1).replace(".", ",") + '%</strong></div></div>';
    var html = '<table class="tabela"><thead><tr><th>Nome enviado</th><th>Melhor correspondência</th>' +
      '<th>Similaridade</th><th>Lista</th><th>Programa</th><th></th></tr></thead><tbody>';
    var ordenado = lote.resultados.slice().sort(function (a, b) {
      return (b.melhor ? b.melhor.score : 0) - (a.melhor ? a.melhor.score : 0);
    });
    var mostrados = 0;
    for (var k = 0; k < ordenado.length && mostrados < 300; k++) {
      var r = ordenado[k], m = r.melhor;
      if (!m || m.score < limiar) continue;
      mostrados++;
      html += '<tr><td>' + escapa(r.nome || r.doc) + '</td><td>' + escapa(m.rec[1]) + '</td>' +
        '<td>' + selo(m.score) + '</td><td><span class="fonte ' + m.rec[3] + '">' + (FONTES[m.rec[3]] || m.rec[3]) + '</span></td>' +
        '<td>' + escapa((m.rec[5] || "").slice(0, 40)) + '</td>' +
        '<td><a href="' + escapa(m.rec[8]) + '" target="_blank" rel="noopener">fonte</a></td></tr>';
    }
    if (!mostrados) html += '<tr><td colspan="6">Nenhuma linha passou do limiar. Baixe o limiar para ver as aproximações.</td></tr>';
    html += '</tbody></table>';
    tabelaLote.innerHTML = html;
    baixarLote.hidden = false;
  }
  function baixarResultado() {
    var linhas = [["linha", "nome_enviado", "documento", "melhor_correspondencia", "similaridade",
      "lista", "tipo", "programa", "pais", "link_fonte", "ajustes_de_contexto"]];
    for (var k = 0; k < lote.resultados.length; k++) {
      var r = lote.resultados[k], m = r.melhor;
      linhas.push([k + 2, r.nome, r.doc, m ? m.rec[1] : "", m ? m.score : 0,
        m ? (FONTES[m.rec[3]] || m.rec[3]) : "", m ? (TIPOS[m.rec[4]] || m.rec[4]) : "",
        m ? m.rec[5] : "", m ? m.rec[6] : "", m ? m.rec[8] : "",
        m && m.ajustes ? m.ajustes.map(function (a) { return a.rotulo + " " + (a.delta > 0 ? "+" : "") + a.delta; }).join(" | ") : ""]);
    }
    var csv = linhas.map(function (l) {
      return l.map(function (c) { var s = String(c == null ? "" : c); return '"' + s.replace(/"/g, '""') + '"'; }).join(";");
    }).join("\r\n");
    var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "triagem-sancoes.csv";
    a.click();
  }
  function carregarTexto(texto) {
    var linhas = String(texto).split(/\r?\n/).filter(function (l) { return l.trim().length; });
    if (!linhas.length) return;
    var primeira = linhas[0].split(/[;,]/);
    var col = acharColuna(primeira, COL_NOME);
    if (col > -1) {
      var csv = lerCsv(texto);
      lote.linhas = csv.linhas;
      lote.colNome = col;
      lote.colDoc = acharColuna(csv.cabecalho, COL_DOC);
      lote.colNasc = acharColuna(csv.cabecalho, COL_NASC);
      lote.colPais = acharColuna(csv.cabecalho, COL_PAIS);
    } else {
      lote.colNome = 0;
      lote.colDoc = -1; lote.colNasc = -1; lote.colPais = -1;
      lote.linhas = linhas.map(function (l) { return [l.split(/[;,]/)[0].trim()]; });
    }
    processarLote();
  }
  if (arquivo) {
    arquivo.addEventListener("change", function () {
      var f = arquivo.files[0];
      if (!f) return;
      var leitor = new FileReader();
      leitor.onload = function () { carregarTexto(leitor.result); };
      leitor.readAsText(f, "utf-8");
    });
  }
  var botaoColar = document.getElementById("triarColado");
  if (botaoColar) botaoColar.addEventListener("click", function () {
    var caixa = document.getElementById("colar");
    if (caixa && caixa.value.trim()) carregarTexto(caixa.value);
  });
  if (limiarLote) limiarLote.addEventListener("input", function () {
    lote.limiar = Number(limiarLote.value);
    if (limiarLoteVal) limiarLoteVal.textContent = lote.limiar + "%";
    if (lote.resultados.length) mostrarLote();
  });
  if (baixarLote) baixarLote.addEventListener("click", baixarResultado);

  // ---------- vigilância ----------
  var CHAVE = "vigilancia-sancoes";
  function carregarWatch() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || "[]"); } catch (e) { return []; }
  }
  function salvarWatch(l) {
    try { localStorage.setItem(CHAVE, JSON.stringify(l.slice(0, 200))); } catch (e) {}
  }
  function mostrarWatch() {
    var alvo = document.getElementById("watchLista");
    if (!alvo) return;
    var nomes = carregarWatch();
    if (!nomes.length) { alvo.innerHTML = '<p class="dica">Nenhum nome cadastrado ainda.</p>'; return; }
    alvo.innerHTML = '<p class="progresso">Verificando ' + nomes.length + ' nome(s)…</p>';
    Promise.all(nomes.map(function (n) { return melhorPara(n, "", "", ""); })).then(function (ms) {
      var html = '<table class="tabela"><thead><tr><th>Nome vigiado</th><th>Situação</th>' +
        '<th>Melhor correspondência</th><th></th></tr></thead><tbody>';
      for (var k = 0; k < nomes.length; k++) {
        var m = ms[k];
        var situacao = m && m.score >= 85 ? '<span class="score forte">ALERTA</span>'
          : (m && m.score >= 70 ? '<span class="score possivel">verificar</span>'
            : '<span class="score ok">sem correspondência</span>');
        html += '<tr><td>' + escapa(nomes[k]) + '</td><td>' + situacao + '</td><td>' +
          (m && m.score >= 70 ? escapa(m.rec[1]) + " " + selo(m.score) : "—") + '</td>' +
          '<td><button class="link-remover" data-nome="' + escapa(nomes[k]) + '">remover</button></td></tr>';
      }
      html += '</tbody></table>';
      alvo.innerHTML = html;
    });
  }
  var botaoWatch = document.getElementById("watchAdd");
  if (botaoWatch) botaoWatch.addEventListener("click", function () {
    var inp = document.getElementById("watchNome");
    var v = (inp.value || "").trim();
    if (!v) return;
    var l = carregarWatch();
    if (l.indexOf(v) === -1) l.push(v);
    salvarWatch(l);
    inp.value = "";
    mostrarWatch();
  });
  var alvoWatch = document.getElementById("watchLista");
  if (alvoWatch) alvoWatch.addEventListener("click", function (ev) {
    if (!ev.target.classList.contains("link-remover")) return;
    var nome = ev.target.getAttribute("data-nome");
    salvarWatch(carregarWatch().filter(function (x) { return x !== nome; }));
    mostrarWatch();
  });

  // ---------- carga ----------
  if (contagem) contagem.textContent = "Carregando as listas…";
  backend.chama("carregarUrl", { url: absoluta("/dados/indice.json") })
    .then(function (total) {
      carregado = true;
      totalBase = total;
      buscar();
      mostrarWatch();
    })
    .catch(function () {
      if (contagem) contagem.textContent = "Não foi possível carregar os dados. Recarregue a página.";
    });
})();
