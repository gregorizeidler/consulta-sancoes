(function () {
  "use strict";
  var link = document.querySelector('link[rel="stylesheet"]');
  var BASE = link ? link.getAttribute("href").replace(/\/style\.css.*$/, "") : "";
  var manifesto = [];

  function canonico(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canonico).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ":" + canonico(v[k]);
    }).join(",") + "}";
  }
  function hex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
  }
  function sha256Texto(t) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)).then(hex);
  }
  function sha256Arquivo(arquivo) {
    return arquivo.arrayBuffer().then(function (buf) {
      return crypto.subtle.digest("SHA-256", buf);
    }).then(hex);
  }
  function dataBr(iso) {
    if (!iso || iso.length < 10) return iso || "";
    return iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
  }
  function curto(h) { return h ? h.slice(0, 16) + "…" : "—"; }

  function verificaCadeia(lista) {
    var anterior = "0".repeat(64);
    for (var i = 0; i < lista.length; i++) {
      var e = lista[i];
      if (e.hash_anterior !== anterior) return { ok: false, elo: i };
      var copia = {};
      for (var k in e) if (k !== "cadeia_hash") copia[k] = e[k];
      anterior = e.cadeia_hash;
      if (canonico(copia) === null) return { ok: false, elo: i };
    }
    return { ok: true, elo: null };
  }

  function verificaCadeiaAssincrona(lista, aoTerminar) {
    var anterior = "0".repeat(64);
    var i = 0;
    function passo() {
      if (i >= lista.length) { aoTerminar({ ok: true }); return; }
      var e = lista[i];
      if (e.hash_anterior !== anterior) { aoTerminar({ ok: false, elo: i }); return; }
      var copia = {};
      for (var k in e) if (k !== "cadeia_hash") copia[k] = e[k];
      sha256Texto(canonico(copia)).then(function (h) {
        if (h !== e.cadeia_hash) { aoTerminar({ ok: false, elo: i }); return; }
        anterior = e.cadeia_hash;
        i++;
        passo();
      });
    }
    passo();
  }

  function tabela() {
    var corpo = document.getElementById("tabelaManifesto");
    if (!corpo) return;
    if (!manifesto.length) {
      corpo.innerHTML = '<tr><td colspan="4">O manifesto começa a ser publicado a partir da próxima execução diária.</td></tr>';
      return;
    }
    var html = "";
    for (var i = manifesto.length - 1; i >= 0 && i >= manifesto.length - 30; i--) {
      var e = manifesto[i];
      html += "<tr><td>" + dataBr(e.data) + " " + (e.hora || "") + "</td><td>" +
        Number(e.total).toLocaleString("pt-BR") + "</td><td><code>" + curto(e.csv_sha256) +
        "</code></td><td><code>" + curto(e.hash_anterior) + "</code></td></tr>";
    }
    corpo.innerHTML = html;
  }

  function mostra(html) {
    var alvo = document.getElementById("resultadoVerifica");
    if (alvo) alvo.innerHTML = html;
  }

  function conferirHash(h) {
    var achado = null, campo = "";
      for (var i = 0; i < manifesto.length && !achado; i++) {
        var e = manifesto[i];
        if (e.csv_sha256 === h) { achado = e; campo = "CSV"; }
        else if (e.zip_sha256 === h) { achado = e; campo = "zip"; }
        else if (e.indice_sha256 === h) { achado = e; campo = "índice"; }
      }
      if (!achado) {
        mostra('<div class="veredito falha"><strong>Não corresponde a nenhum arquivo publicado.</strong>' +
          "<p>Hash conferido: <code>" + h + "</code></p>" +
          "<p>Ou o arquivo foi editado depois de baixado, ou foi gerado fora deste site.</p></div>");
        return;
      }
      verificaCadeiaAssincrona(manifesto, function (r) {
        var situacao = r.ok
          ? '<p class="ok-cadeia">Corrente íntegra: os ' + manifesto.length + " dias publicados conferem, " +
            "conferidos agora no seu navegador.</p>"
          : '<p class="ruim-cadeia">Atenção: a corrente quebrou no dia ' + dataBr(manifesto[r.elo].data) +
            ". O histórico deste site foi alterado.</p>";
        mostra('<div class="veredito"><strong>Arquivo original de ' + dataBr(achado.data) + " às " +
          (achado.hora || "") + ".</strong>" +
          "<p>" + campo + " com " + Number(achado.total).toLocaleString("pt-BR") +
          " registros — exatamente o que foi publicado naquele dia.</p>" +
          "<p>SHA-256: <code>" + h + "</code></p>" + situacao + "</div>");
      });
  }

  function conferir(arquivo) {
    mostra('<p class="progresso">Calculando o SHA-256 de ' + arquivo.name + "…</p>");
    sha256Arquivo(arquivo).then(conferirHash);
  }

  var entrada = document.getElementById("arquivoVerifica");
  if (entrada) {
    entrada.addEventListener("change", function () {
      if (entrada.files && entrada.files[0]) conferir(entrada.files[0]);
    });
  }

  fetch(BASE + "/dados/manifesto.json?v=" + Date.now(), { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (j) {
      manifesto = j || [];
      tabela();
      var h = new URLSearchParams(window.location.search).get("h");
      if (h && /^[0-9a-f]{64}$/i.test(h)) conferirHash(h.toLowerCase());
    })
    .catch(function (e) {
      manifesto = [];
      var corpo = document.getElementById("tabelaManifesto");
      if (corpo) corpo.innerHTML = '<tr><td colspan="4">Não foi possível carregar o manifesto agora (' +
        (e && e.message ? e.message : "erro de rede") + "). Recarregue a página.</td></tr>";
    });
})();
