/* Motor de busca difusa. Sem DOM: roda tambem no Node, para os testes. */
(function (raiz) {
  "use strict";

  function norm(s) {
    return (s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function popcount(x) {
    x = x - ((x >> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
    x = (x + (x >> 4)) & 0x0f0f0f0f;
    return (x * 0x01010101) >> 24;
  }
  function mascara(s) {
    var m = 0, t = "  " + (s || "") + "  ";
    for (var i = 0; i < t.length - 2; i++) {
      var h = 2166136261;
      for (var j = 0; j < 3; j++) {
        h ^= t.charCodeAt(i + j);
        h = Math.imul(h, 16777619);
      }
      m |= 1 << ((h >>> 0) % 32);
    }
    return m >>> 0;
  }
  function trigramas(s) {
    var t = "  " + s + "  ", out = [];
    for (var i = 0; i < t.length - 2; i++) out.push(t.substr(i, 3));
    return out;
  }
  function dice(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    var ta = trigramas(a), tb = trigramas(b), mapa = {}, comuns = 0, i;
    if (!ta.length || !tb.length) return 0;
    for (i = 0; i < ta.length; i++) mapa[ta[i]] = (mapa[ta[i]] || 0) + 1;
    for (i = 0; i < tb.length; i++) if (mapa[tb[i]]) { comuns++; mapa[tb[i]]--; }
    return (2 * comuns) / (ta.length + tb.length);
  }
  function jaroWinkler(a, b) {
    if (a === b) return 1;
    var la = a.length, lb = b.length, i, j;
    if (!la || !lb) return 0;
    var janela = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
    var ma = new Array(la), mb = new Array(lb), comuns = 0;
    for (i = 0; i < la; i++) ma[i] = false;
    for (i = 0; i < lb; i++) mb[i] = false;
    for (i = 0; i < la; i++) {
      var ini = Math.max(0, i - janela), fim = Math.min(i + janela + 1, lb);
      for (j = ini; j < fim; j++) {
        if (!mb[j] && a.charCodeAt(i) === b.charCodeAt(j)) {
          ma[i] = mb[j] = true; comuns++; break;
        }
      }
    }
    if (!comuns) return 0;
    var transposicoes = 0, k = 0;
    for (i = 0; i < la; i++) {
      if (ma[i]) {
        while (!mb[k]) k++;
        if (a.charCodeAt(i) !== b.charCodeAt(k)) transposicoes++;
        k++;
      }
    }
    var jaro = (comuns / la + comuns / lb + (comuns - transposicoes / 2) / comuns) / 3;
    var prefixo = 0;
    for (i = 0; i < Math.min(4, la, lb); i++) {
      if (a.charCodeAt(i) === b.charCodeAt(i)) prefixo++; else break;
    }
    return jaro + prefixo * 0.1 * (1 - jaro);
  }

  // cobertura de tokens tolerante a erro de digitacao (jw >= 0.88 conta como presente)
  function cobertura(qTokens, cTokens, exata) {
    if (!qTokens.length) return 0;
    var achou = 0;
    for (var i = 0; i < qTokens.length; i++) {
      var ok = false;
      for (var j = 0; j < cTokens.length; j++) {
        if (qTokens[i] === cTokens[j]) { ok = true; break; }
        if (!exata && jaroWinkler(qTokens[i], cTokens[j]) >= 0.88) { ok = true; break; }
      }
      if (ok) achou++;
    }
    return achou / qTokens.length;
  }

  function bruto(q, c) {
    if (!q || !c) return 0;
    if (q === c) return 100;
    var tq = q.split(" ").filter(Boolean), tc = c.split(" ").filter(Boolean);
    var s = 100 * (0.45 * jaroWinkler(q, c) + 0.35 * dice(q, c) + 0.20 * cobertura(tq, tc, false));
    return s;
  }

  // comparara o nome consultado com o registro inteiro e com as janelas de tokens
  // (pega "ZASLON" dentro de "JSC SCIENTIFIC AND TECHNICAL CENTER ZASLON")
  function similaridade(q, c) {
    if (!q || !c) return 0;
    if (q === c) return 100;
    var melhor = bruto(q, c);
    var tq = q.split(" ").filter(Boolean), tc = c.split(" ").filter(Boolean);
    if (tc.length > tq.length && tq.length) {
      var maxTam = Math.min(tq.length + 1, tc.length);
      for (var tam = tq.length; tam <= maxTam; tam++) {
        for (var i = 0; i + tam <= tc.length; i++) {
          var s = bruto(q, tc.slice(i, i + tam).join(" "));
          if (s > melhor) melhor = s;
        }
      }
    }
    if (tq.length > 1 && cobertura(tq, tc, false) === 1) melhor = Math.max(melhor, 90);
    if (tc.length && tq.length > tc.length && cobertura(tc, tq, false) === 1) melhor = Math.max(melhor, 88);
    return Math.round(Math.min(100, melhor));
  }

  function melhorSim(q, nomeNorm, aliases) {
    var s = similaridade(q, nomeNorm);
    if (s >= 99 || !aliases) return s;
    for (var i = 0; i < aliases.length && i < 8; i++) {
      var s2 = similaridade(q, aliases[i]);
      if (s2 > s) s = s2;
      if (s >= 99) break;
    }
    return s;
  }

  function faixa(score) {
    if (score >= 95) return ["exata", "forte"];
    if (score >= 85) return ["provável", "provavel"];
    if (score >= 70) return ["possível", "possivel"];
    return ["fraca", "fraca"];
  }

  function prepara(registros) {
    for (var k = 0; k < registros.length; k++) {
      var d = registros[k];
      d.__n = norm(d[1]);
      d.__aliases = (d[2] || []).map(norm);
      d.__docs = (d[10] || []).map(function (x) {
        return String(x).replace(/[^0-9a-z]/gi, "").toLowerCase();
      });
      var toks = d.__n.split(" ").filter(Boolean);
      var todos = toks.concat(d.__aliases.join(" ").split(" ").filter(Boolean));
      var vistas = {}, mascaras = [];
      for (var t = 0; t < todos.length && mascaras.length < 12; t++) {
        if (vistas[todos[t]] || todos[t].length < 3) continue;
        vistas[todos[t]] = 1;
        mascaras.push(mascara(todos[t]));
      }
      d.__tok = mascaras;
    }
    return registros;
  }

  function candidatos(registros, q, filtro, limite) {
    filtro = filtro || { fonte: "todas", tipo: "todos" };
    var toks = q.split(" ").filter(Boolean);
    var alvo = q;
    for (var i = 0; i < toks.length; i++) if (toks[i].length > alvo.length || alvo === q && toks[i].length > 2) alvo = toks[i];
    var qm = mascara(alvo), bits = popcount(qm) || 1, out = [], k, d, j;
    for (k = 0; k < registros.length; k++) {
      d = registros[k];
      if (filtro.fonte !== "todas" && d[3] !== filtro.fonte) continue;
      if (filtro.tipo !== "todos" && d[4] !== filtro.tipo) continue;
      if (d.__n.indexOf(q) > -1) { out.push([1, d]); continue; }
      var melhor = 0;
      for (j = 0; j < d.__tok.length; j++) {
        var c = popcount(qm & d.__tok[j]) / bits;
        if (c > melhor) melhor = c;
      }
      if (melhor >= 0.2) out.push([melhor, d]);
    }
    out.sort(function (a, b) { return b[0] - a[0]; });
    return out.slice(0, limite || 500);
  }

  var Motor = { norm: norm, mascara: mascara, popcount: popcount, dice: dice, jaroWinkler: jaroWinkler,
    cobertura: cobertura, similaridade: similaridade, melhorSim: melhorSim, faixa: faixa,
    prepara: prepara, candidatos: candidatos };
  raiz.Motor = Motor;
  if (typeof module !== "undefined" && module.exports) module.exports = Motor;
})(typeof window !== "undefined" ? window : globalThis);
