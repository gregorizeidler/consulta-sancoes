(function () {
  "use strict";
  var link = document.querySelector('link[rel="stylesheet"]');
  var BASE = link ? link.getAttribute("href").replace(/\/style\.css.*$/, "") : "";
  var dados = [], estado = { q: "", fonte: "todas", tipo: "todos", mostrados: 50, achados: [] };
  var campo = document.getElementById("q");
  var lista = document.getElementById("lista");
  var contagem = document.getElementById("contagem");
  var botaoMais = document.getElementById("mais");

  function normaliza(s) {
    return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function escapa(s) {
    return String(s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  var FONTES = { ofac: "OFAC", un: "ONU", eu: "UE" };
  var TIPOS = { pessoa: "Pessoa", entidade: "Entidade", embarcacao: "Embarcação", aeronave: "Aeronave", outro: "Outro" };

  function buscar() {
    var t0 = performance.now();
    var q = normaliza(estado.q);
    var tokens = q ? q.split(" ") : [];
    var saida = [];
    for (var k = 0; k < dados.length; k++) {
      var d = dados[k];
      if (estado.fonte !== "todas" && d[3] !== estado.fonte) continue;
      if (estado.tipo !== "todos" && d[4] !== estado.tipo) continue;
      if (!tokens.length) { saida.push([1, d]); continue; }
      var alvo = d.__busca;
      var ok = true;
      for (var j = 0; j < tokens.length; j++) {
        if (alvo.indexOf(tokens[j]) === -1) { ok = false; break; }
      }
      if (!ok) continue;
      var nota = 10;
      if (d.__nome === q) nota = 100;
      else if (d.__nome.indexOf(q) === 0) nota = 70;
      else if (d.__nome.indexOf(q) > -1) nota = 50;
      else nota = 20;
      saida.push([nota, d]);
    }
    saida.sort(function (a, b) {
      if (b[0] !== a[0]) return b[0] - a[0];
      return a[1][1].localeCompare(b[1][1]);
    });
    estado.achados = saida;
    estado.mostrados = 50;
    var ms = Math.round(performance.now() - t0);
    contagem.textContent = saida.length === 1
      ? "1 registro encontrado em " + ms + " ms"
      : saida.length.toLocaleString("pt-BR") + " registros encontrados em " + ms + " ms";
    render();
  }

  function render() {
    var fim = Math.min(estado.mostrados, estado.achados.length);
    var html = "";
    if (!estado.achados.length) {
      html = '<p class="vazio">Nenhum registro com esse nome nas três listas. ' +
        'Confira a grafia, tente só o sobrenome, ou busque pelo nome em outro alfabeto.</p>';
    }
    for (var k = 0; k < fim; k++) {
      var d = estado.achados[k][1];
      var aliases = (d[2] || []).slice(0, 6).join(", ");
      var det = "";
      if (aliases) det += "<p><b>Também conhecido como:</b> " + escapa(aliases) + "</p>";
      if (d[9]) det += "<p><b>Detalhe:</b> " + escapa(d[9]) + "</p>";
      det += '<p><a href="' + escapa(d[8]) + '" target="_blank" rel="noopener">Ver na fonte oficial</a></p>';
      html += '<article class="item" data-k="' + k + '">' +
        '<div class="linha"><h3>' + escapa(d[1]) + '</h3>' +
        '<span class="fonte ' + d[3] + '">' + (FONTES[d[3]] || d[3]) + '</span>' +
        '<span class="tipo">' + (TIPOS[d[4]] || d[4]) + '</span></div>' +
        '<div class="meta">' + escapa(d[5] || "—") + (d[6] ? " · " + escapa(d[6]) : "") + '</div>' +
        '<div class="det">' + det + '</div></article>';
    }
    lista.innerHTML = html;
    botaoMais.hidden = estado.achados.length <= estado.mostrados;
  }

  function atualizaUrl() {
    var url = window.location.pathname;
    if (estado.q) url += "?q=" + encodeURIComponent(estado.q);
    try { history.replaceState(null, "", url); } catch (e) {}
  }

  var timer = null;
  campo.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      estado.q = campo.value.trim();
      atualizaUrl();
      buscar();
    }, 130);
  });

  document.getElementById("fontes").addEventListener("click", function (ev) {
    var b = ev.target.closest(".chip");
    if (!b) return;
    [].forEach.call(this.querySelectorAll(".chip"), function (c) { c.classList.remove("ativo"); });
    b.classList.add("ativo");
    estado.fonte = b.getAttribute("data-fonte");
    buscar();
  });
  document.getElementById("tipos").addEventListener("click", function (ev) {
    var b = ev.target.closest(".chip");
    if (!b) return;
    [].forEach.call(this.querySelectorAll(".chip"), function (c) { c.classList.remove("ativo"); });
    b.classList.add("ativo");
    estado.tipo = b.getAttribute("data-tipo");
    buscar();
  });
  lista.addEventListener("click", function (ev) {
    var card = ev.target.closest(".item");
    if (!card || ev.target.tagName === "A") return;
    card.classList.toggle("aberto");
  });
  botaoMais.addEventListener("click", function () {
    estado.mostrados += 50;
    render();
  });

  var params = new URLSearchParams(window.location.search);
  if (params.get("q")) { campo.value = params.get("q"); estado.q = params.get("q").trim(); }

  fetch(BASE + "/dados/indice.json")
    .then(function (r) { return r.json(); })
    .then(function (j) {
      dados = j;
      for (var k = 0; k < dados.length; k++) {
        var d = dados[k];
        d.__nome = normaliza(d[1]);
        var alvo = d[1] + " " + (d[2] || []).join(" ");
        d.__busca = normaliza(alvo);
      }
      buscar();
    })
    .catch(function () {
      contagem.textContent = "Não foi possível carregar os dados. Recarregue a página.";
    });
})();
