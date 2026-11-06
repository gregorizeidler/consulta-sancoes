/* Motor de busca difusa. Sem DOM: roda no navegador, no Web Worker e no Node (testes). */
(function (raiz) {
  "use strict";

  // Todos os pesos e limiares ficam aqui para o benchmark (tests/benchmark.js) poder varia-los.
  var PESOS = {
    jw: 0.45, dice: 0.35, cob: 0.20,
    cobPenal: 0.6,
    ordemTrocada: 95, compacto: 95, fonetica: 0.97, umaEdicao: 88,
    nascIgual: 8, nascTroca: 2, nascAno: 4, nascMesDia: -10, nascProximo: -8, nascConflito: -30,
    paisIgual: 3, paisDiverge: -18,
    docMascarado: 6, docDiverge: -40, docTipo: -15, docParcial: 90,
    pisoBonus: 70
  };

  var CIRILICO = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i", "й": "y",
    "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
    "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu",
    "я": "ya", "і": "i", "ї": "yi", "є": "ye", "ґ": "g", "ў": "u", "ђ": "dj", "ј": "j", "љ": "lj", "њ": "nj",
    "ћ": "c", "џ": "dz"
  };
  var LATINO = { "ß": "ss", "ø": "o", "æ": "ae", "œ": "oe", "đ": "d", "ł": "l", "ı": "i", "ð": "d", "þ": "th" };

  function norm(s) {
    s = s == null ? "" : String(s);
    s = s.toLowerCase();
    if (/[Ѐ-ӿ]/.test(s)) s = s.replace(/[Ѐ-ӿ]/g, function (c) { var m = CIRILICO[c]; return m === undefined ? " " : m; });
    s = s.replace(/[ßøæœđłıðþ]/g, function (c) { return LATINO[c]; });
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }

  // ---------- variantes de grafia (transliteracao) ----------
  // Chave fonetica por palavra: Mohammed/Muhammad/Mohamed, Yuri/Iurii, Sergey/Sergei...
  // caem na mesma chave. Palavras curtas (ate 3 letras) ficam como estao.
  var memoToken = Object.create(null), memoTokens = 0;
  function chaveToken(t) {
    if (t.length < 3) return t;
    if (t.length === 3) return t.replace(/y/g, "i");
    var c = memoToken[t];
    if (c !== undefined) return c;
    var s = t.replace(/ph/g, "f").replace(/dh/g, "d").replace(/kh/g, "h").replace(/gh/g, "g")
      .replace(/sch|sh/g, "s").replace(/tch|ch/g, "c").replace(/dzh|zh|dj/g, "j")
      .replace(/ts|tz/g, "c").replace(/ck/g, "k").replace(/q/g, "k").replace(/x/g, "ks")
      .replace(/w/g, "v").replace(/y/g, "i").replace(/j$/, "i")
      .replace(/gu([ei])/g, "g$1").replace(/ee/g, "i").replace(/[ae]i/g, "i").replace(/ou|oo/g, "u").replace(/o/g, "u").replace(/e/g, "a")
      .replace(/(.)\1+/g, "$1");
    if (memoTokens > 200000) { memoToken = Object.create(null); memoTokens = 0; }
    memoToken[t] = s; memoTokens++;
    return s;
  }
  var memoNome = Object.create(null), memoNomes = 0;
  function chaveNome(s) {
    var c = memoNome[s];
    if (c !== undefined) return c;
    var t = s.split(" "), out = [];
    for (var i = 0; i < t.length; i++) out.push(chaveToken(t[i]));
    c = out.join(" ");
    if (memoNomes > 200000) { memoNome = Object.create(null); memoNomes = 0; }
    memoNome[s] = c; memoNomes++;
    return c;
  }

  // ---------- medidas de string ----------
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
  // trigramas como inteiros ordenados (norm() so produz ASCII); o resultado fica em cache
  // porque a consulta e as janelas dos registros se repetem muito dentro de uma busca.
  var memoTri = Object.create(null), memoTris = 0;
  function trigramas(s) {
    var r = memoTri[s];
    if (r !== undefined) return r;
    var t = "  " + s + "  ", n = t.length - 2;
    r = new Int32Array(n);
    for (var i = 0; i < n; i++) r[i] = ((t.charCodeAt(i) & 255) << 16) | ((t.charCodeAt(i + 1) & 255) << 8) | (t.charCodeAt(i + 2) & 255);
    r.sort();
    if (memoTris > 100000) { memoTri = Object.create(null); memoTris = 0; }
    memoTri[s] = r; memoTris++;
    return r;
  }
  function dice(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    var ta = trigramas(a), tb = trigramas(b), i = 0, j = 0, comuns = 0;
    while (i < ta.length && j < tb.length) {
      if (ta[i] === tb[j]) { comuns++; i++; j++; }
      else if (ta[i] < tb[j]) i++; else j++;
    }
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

  // distancia de edicao (Damerau: troca de letras vizinhas conta 1) com corte:
  // para de calcular quando passa do limite
  function levLimitado(a, b, limite) {
    var la = a.length, lb = b.length, i, j;
    if (Math.abs(la - lb) > limite) return limite + 1;
    var anterior2 = null, anterior = [], atual = [];
    for (j = 0; j <= lb; j++) anterior[j] = j;
    for (i = 1; i <= la; i++) {
      atual[0] = i;
      var menorLinha = i;
      for (j = 1; j <= lb; j++) {
        var custo = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var v = anterior[j] + 1;
        if (atual[j - 1] + 1 < v) v = atual[j - 1] + 1;
        if (anterior[j - 1] + custo < v) v = anterior[j - 1] + custo;
        if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1) && anterior2[j - 2] + 1 < v) v = anterior2[j - 2] + 1;
        atual[j] = v;
        if (v < menorLinha) menorLinha = v;
      }
      if (menorLinha > limite) return limite + 1;
      var tmp = anterior2; anterior2 = anterior; anterior = atual; atual = tmp || [];
    }
    return anterior[lb] > limite ? limite + 1 : anterior[lb];
  }

  // duas palavras sao a mesma quando iguais, a uma/duas letras de distancia
  // (proporcional ao tamanho) ou com a mesma chave fonetica. Palavra curta
  // (ate 3 letras) exige igualdade: era isso que fazia "ali khamenei" casar
  // com "khamis al khanjar".
  function equivalente(a, b) {
    if (a === b) return true;
    var menor = Math.min(a.length, b.length);
    if (menor < 3) return false;
    if (chaveToken(a) === chaveToken(b)) return true;
    if (menor < 4) return false;
    var limite = menor >= 8 ? 2 : 1;
    if (Math.abs(a.length - b.length) > limite) return false;
    return levLimitado(a, b, limite) <= limite;
  }

  function cobertura(qTokens, cTokens) {
    if (!qTokens.length) return 0;
    var achou = 0;
    for (var i = 0; i < qTokens.length; i++) {
      for (var j = 0; j < cTokens.length; j++) {
        if (equivalente(qTokens[i], cTokens[j])) { achou++; break; }
      }
    }
    return achou / qTokens.length;
  }

  var memoTok = Object.create(null), memoToks = 0;
  function tokens(s) {
    var r = memoTok[s];
    if (r !== undefined) return r;
    r = s.split(" ").filter(Boolean);
    if (memoToks > 200000) { memoTok = Object.create(null); memoToks = 0; }
    memoTok[s] = r; memoToks++;
    return r;
  }
  function bruto(q, c, tq, tc) {
    if (!q || !c) return 0;
    if (q === c) return 100;
    return 100 * (PESOS.jw * jaroWinkler(q, c) + PESOS.dice * dice(q, c) + PESOS.cob * cobertura(tq, tc));
  }
  // mesmas palavras em outra ordem, tolerando grafia diferente em cada palavra
  function mesmoConjunto(tq, tc) {
    if (tq.length < 2 || tq.length !== tc.length) return 0;
    var usados = [], exato = true, i, j;
    for (i = 0; i < tq.length; i++) {
      var achou = -1;
      for (j = 0; j < tc.length && achou < 0; j++) if (!usados[j] && tq[i] === tc[j]) achou = j;
      if (achou < 0) {
        exato = false;
        for (j = 0; j < tc.length && achou < 0; j++) if (!usados[j] && equivalente(tq[i], tc[j])) achou = j;
      }
      if (achou < 0) return 0;
      usados[achou] = true;
    }
    return exato ? PESOS.ordemTrocada : PESOS.ordemTrocada - 2;
  }

  // Compara o nome consultado com o registro inteiro e com as janelas de tokens
  // (pega "ZASLON" dentro de "JSC SCIENTIFIC AND TECHNICAL CENTER ZASLON").
  // Quando so uma parte da consulta aparece no registro, o score e penalizado:
  // registro que explica metade do nome nao pode marcar 100.
  function similaridadeLetras(q, c) {
    if (!q || !c) return 0;
    if (q === c) return 100;
    var tq = tokens(q), tc = tokens(c);
    var melhor = bruto(q, c, tq, tc);
    if (tc.length > tq.length && tq.length) {
      var maxTam = Math.min(tq.length + 1, tc.length);
      for (var tam = tq.length; tam <= maxTam; tam++) {
        for (var i = 0; i + tam <= tc.length; i++) {
          var jan = tc.slice(i, i + tam);
          var s = bruto(q, jan.join(" "), tq, jan);
          if (s > melhor) melhor = s;
        }
      }
    }
    // mesmas palavras em ordem diferente ("KIM JONG UN" x "JONG UN KIM")
    var conj = mesmoConjunto(tq, tc);
    if (conj > melhor) melhor = conj;
    var cov = cobertura(tq, tc);
    if (cov < 1) melhor = melhor * (PESOS.cobPenal + (1 - PESOS.cobPenal) * cov);
    return Math.round(Math.min(100, melhor));
  }

  // Score final de nome: a melhor entre a grafia literal e a grafia foneticamente
  // normalizada (levemente penalizada, para a grafia identica sempre ganhar) e
  // a junção de palavras ("al qaida" x "alqaida").
  function similaridade(q, c) {
    var s = similaridadeLetras(q, c);
    if (s >= 97 || !q || !c) return s;
    var kq = chaveNome(q), kc = chaveNome(c);
    if (kq !== q || kc !== c) {
      var s2 = kq === kc ? 100 : similaridadeLetras(kq, kc);
      s2 = Math.round(s2 * PESOS.fonetica);
      if (s2 > s) s = s2;
    }
    if (q.indexOf(" ") > -1 || c.indexOf(" ") > -1) {
      if (kq.replace(/ /g, "") === kc.replace(/ /g, "") && PESOS.compacto > s) s = PESOS.compacto;
    }
    if (s < PESOS.umaEdicao && umaEdicao(q, c)) s = PESOS.umaEdicao;
    return s;
  }

  // mesmas palavras, na mesma ordem, e uma unica (de 6+ letras) com uma troca/falta/sobra/transposicao.
  // O Dice por trigramas despenca em palavra curta; uma edicao em seis letras continua sendo o mesmo nome.
  function umaEdicao(q, c) {
    var tq = q.split(" "), tc = c.split(" ");
    if (tq.length !== tc.length) return false;
    var dif = 0;
    for (var i = 0; i < tq.length; i++) {
      if (tq[i] === tc[i]) continue;
      if (++dif > 1 || tq[i].length < 6 || tc[i].length < 6 || levLimitado(tq[i], tc[i], 1) > 1) return false;
    }
    return dif === 1;
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
    if (score >= 100) return ["exata", "forte"];
    if (score >= 92) return ["forte", "forte"];
    if (score >= 85) return ["provável", "provavel"];
    if (score >= 70) return ["possível", "possivel"];
    return ["fraca", "fraca"];
  }

  // Explica de onde veio o score: palavras que casaram, as que faltaram e as
  // tres medidas que compoem o numero.
  function explica(q, c) {
    if (!q || !c) return { score: 0, jw: 0, dice: 0, cobertura: 0, comuns: [], faltando: [], ordemTrocada: false, fonetica: false };
    var tq = q.split(" ").filter(Boolean), tc = c.split(" ").filter(Boolean);
    var comuns = [], faltando = [], fonetica = false;
    for (var i = 0; i < tq.length; i++) {
      var achou = false;
      for (var j = 0; j < tc.length; j++) {
        if (equivalente(tq[i], tc[j])) {
          achou = true;
          if (tq[i] !== tc[j] && tq[i].length >= 4 && chaveToken(tq[i]) === chaveToken(tc[j])) fonetica = true;
          break;
        }
      }
      if (achou) comuns.push(tq[i]); else faltando.push(tq[i]);
    }
    return {
      score: similaridade(q, c),
      jw: Math.round(100 * jaroWinkler(q, c)),
      dice: Math.round(100 * dice(q, c)),
      cobertura: Math.round(100 * cobertura(tq, tc)),
      comuns: comuns, faltando: faltando, fonetica: fonetica,
      ordemTrocada: q !== c && mesmoConjunto(tq, tc) > 0 && cobertura(tq, tc) === 1 && tq.join(" ") !== tc.join(" ")
    };
  }

  // ---------- documentos: CPF, CNPJ, mascara ----------
  function validaCPF(d) {
    if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
    for (var t = 9; t < 11; t++) {
      var soma = 0;
      for (var i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i);
      var dv = (soma * 10) % 11;
      if (dv === 10) dv = 0;
      if (dv !== Number(d[t])) return false;
    }
    return true;
  }
  function validaCNPJ(d) {
    if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
    var pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    for (var t = 12; t < 14; t++) {
      var soma = 0;
      for (var i = 0; i < t; i++) soma += Number(d[i]) * pesos[i + (13 - t)];
      var dv = soma % 11;
      dv = dv < 2 ? 0 : 11 - dv;
      if (dv !== Number(d[t])) return false;
    }
    return true;
  }
  // "CPF: 123.456.789-09", "***.456.789-**", "12.345.678/0001-95", "PA1234567"
  function parseDoc(texto) {
    var s = String(texto == null ? "" : texto);
    var dica = /cnpj/i.test(s) ? "cnpj" : (/cpf/i.test(s) ? "cpf" : null);
    s = s.replace(/^[^:]*:/, "").replace(/^\s*(cpf|cnpj|documento|doc|rg)(?![a-z])\s*(n[ºo°.]*\s*)?/i, "").replace(/[•●]/g, "*");
    if (/^\s*x{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?x{2}\s*$/i.test(s)) s = s.replace(/x/gi, "*");
    var c = s.replace(/[^0-9a-z*]/gi, "").toLowerCase();
    var r = { tipo: "outro", num: c, valido: false, mascarado: c.indexOf("*") > -1 };
    if (c.length === 11 && /^[0-9*]{11}$/.test(c) && dica !== "cnpj") r.tipo = "cpf";
    else if (c.length === 14 && /^[0-9*]{14}$/.test(c) && dica !== "cpf") r.tipo = "cnpj";
    if (!r.mascarado) {
      if (r.tipo === "cpf") r.valido = validaCPF(c);
      else if (r.tipo === "cnpj") r.valido = validaCNPJ(c);
    }
    return r;
  }
  function docsCompativeis(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== "*" && b[i] !== "*" && a[i] !== b[i]) return false;
    }
    return true;
  }

  // ---------- nascimento ----------
  var MES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    fev: 2, abr: 4, mai: 5, ago: 8, set: 9, out: 10, dez: 12 };
  function data(a, m, d) {
    a = Number(a); m = Number(m || 0); d = Number(d || 0);
    if (a < 1850 || a > 2100 || m < 0 || m > 12 || d < 0 || d > 31) return null;
    return { a: a, m: m, d: d };
  }
  function parseData(txt) {
    var s = String(txt).trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").replace(/^(circa|ca|c|aprox|approximately|about)\s+/, ""), m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return data(m[1], m[2], m[3]);
    if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) return data(m[1], m[2], 0);
    if ((m = /^(\d{4})$/.exec(s))) return data(m[1], 0, 0);
    if ((m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s))) return data(m[3], m[2], m[1]);
    if ((m = /^(\d{1,2}) ([a-z]{3})[a-z]* (\d{4})$/.exec(s)) && MES[m[2]]) return data(m[3], MES[m[2]], m[1]);
    if ((m = /^([a-z]{3})[a-z]* (\d{4})$/.exec(s)) && MES[m[1]]) return data(m[2], MES[m[1]], 0);
    return null;
  }
  // Lista de nascimentos do campo "detalhe". Texto livre ("Born in Rwanda...")
  // nao vira data: so conta quando o campo inteiro e feito de datas.
  function parseNascimentos(texto) {
    if (!texto) return [];
    var s = String(texto).trim();
    if (s.length > 80) return [];
    var intervalo = / to /.test(s);
    var partes = s.split(/\s*(?:,|;| to )\s*/), out = [];
    for (var i = 0; i < partes.length; i++) {
      var p = parseData(partes[i]);
      if (!p) return [];
      if (intervalo) p = { a: p.a, m: 0, d: 0 };
      var igual = false;
      for (var j = 0; j < out.length; j++) if (out[j].a === p.a && out[j].m === p.m && out[j].d === p.d) igual = true;
      if (!igual) out.push(p);
    }
    return out;
  }
  function comparaNasc(q, lista) {
    var melhor = null;
    for (var i = 0; i < lista.length; i++) {
      var r = lista[i], c;
      if (r.a === q.a) {
        if (r.m && q.m && r.d && q.d) {
          if (r.m === q.m && r.d === q.d) c = { delta: PESOS.nascIgual, rotulo: "nascimento idêntico" };
          else if (r.m === q.d && r.d === q.m) c = { delta: PESOS.nascTroca, rotulo: "nascimento com dia e mês trocados" };
          else c = { delta: PESOS.nascMesDia, rotulo: "mesmo ano de nascimento, dia ou mês diferente" };
        } else if (r.m && q.m && r.m !== q.m) c = { delta: PESOS.nascMesDia, rotulo: "mesmo ano de nascimento, mês diferente" };
        else c = { delta: PESOS.nascAno, rotulo: "ano de nascimento compatível" };
      } else if (Math.abs(r.a - q.a) === 1) c = { delta: PESOS.nascProximo, rotulo: "ano de nascimento difere em 1" };
      else c = { delta: PESOS.nascConflito, rotulo: "nascimento incompatível (" + r.a + " x " + q.a + ")" };
      if (!melhor || c.delta > melhor.delta) melhor = c;
    }
    return melhor;
  }

  // ---------- pais ----------
  var PAISES = {
    RU: ["russia", "russian federation", "russia federacao", "rus", "ru"], UA: ["ukraine", "ucrania", "ukr", "ua"],
    BY: ["belarus", "bielorrussia", "blr", "by"], IR: ["iran", "iran islamic republic of", "ira", "irao", "irn", "ir"],
    SY: ["syria", "syrian arab republic", "siria", "syr", "sy"], KP: ["north korea", "korea democratic people s republic of", "korea north", "coreia do norte", "dprk", "prk", "kp"],
    CN: ["china", "chn", "cn"], HK: ["hong kong", "hkg", "hk"], BR: ["br", "brazil", "brasil", "bra"],
    MX: ["mexico", "mex", "mx"], TR: ["turkey", "turkiye", "turquia", "tur", "tr"], AE: ["united arab emirates", "uae", "emirados arabes unidos", "are", "ae"],
    LB: ["lebanon", "libano", "lbn", "lb"], IQ: ["iraq", "iraque", "irq", "iq"], AF: ["afghanistan", "afeganistao", "afg", "af"],
    MM: ["myanmar", "burma", "mmr", "mm"], LY: ["libya", "libia", "lby", "ly"], YE: ["yemen", "iemen", "yem", "ye"],
    SD: ["sudan", "sudao", "sdn", "sd"], SS: ["south sudan", "sudao do sul", "ssd", "ss"], SO: ["somalia", "som", "so"],
    PK: ["pakistan", "paquistao", "pak", "pk"], IN: ["india", "ind", "in"], CO: ["colombia", "col", "co"],
    VE: ["venezuela", "ven", "ve"], CU: ["cuba", "cub", "cu"], NI: ["nicaragua", "nic", "ni"], PA: ["panama", "pan", "pa"],
    CY: ["cyprus", "chipre", "cyp", "cy"], DE: ["germany", "alemanha", "deu", "de"], FR: ["france", "franca", "fra", "fr"],
    GB: ["united kingdom", "uk", "reino unido", "great britain", "gbr", "gb"], US: ["united states", "united states of america", "usa", "estados unidos", "eua", "us"],
    SA: ["saudi arabia", "arabia saudita", "sau", "sa"], EG: ["egypt", "egito", "egy", "eg"], PS: ["palestine", "palestina", "state of palestine", "pse", "ps"],
    CD: ["congo democratic republic of the", "democratic republic of the congo", "drc", "cod", "cd"], ML: ["mali", "mli", "ml"],
    CF: ["central african republic", "caf", "cf"], ZW: ["zimbabwe", "zwe", "zw"], HT: ["haiti", "hti", "ht"],
    GE: ["georgia", "georgia pais", "geo", "ge"], AM: ["armenia", "arm", "am"], AZ: ["azerbaijan", "azerbaijao", "aze", "az"],
    KZ: ["kazakhstan", "cazaquistao", "kaz", "kz"], UZ: ["uzbekistan", "uzbequistao", "uzb", "uz"], MD: ["moldova", "moldavia", "mda", "md"],
    RS: ["serbia", "srb", "rs"], BA: ["bosnia and herzegovina", "bosnia", "bih", "ba"], PT: ["portugal", "prt", "pt"], ES: ["spain", "espanha", "esp", "es"],
    IT: ["italy", "italia", "ita", "it"], CH: ["switzerland", "suica", "che", "ch"], NL: ["netherlands", "holanda", "paises baixos", "nld", "nl"],
    JP: ["japan", "japao", "jpn", "jp"], KR: ["south korea", "korea south", "korea republic of", "coreia do sul", "kor", "kr"],
    TW: ["taiwan", "twn", "tw"], TH: ["thailand", "tailandia", "tha", "th"], MY: ["malaysia", "malasia", "mys", "my"],
    SG: ["singapore", "singapura", "sgp", "sg"], ID: ["indonesia", "idn", "id"], PH: ["philippines", "filipinas", "phl", "ph"],
    VN: ["vietnam", "viet nam", "vnm", "vn"], NG: ["nigeria", "nga", "ng"], ZA: ["south africa", "africa do sul", "zaf", "za"],
    AR: ["argentina", "arg", "ar"], CL: ["chile", "chl", "cl"], PE: ["peru", "per", "pe"], EC: ["ecuador", "equador", "ecu", "ec"],
    BO: ["bolivia", "bol", "bo"], PY: ["paraguay", "paraguai", "pry", "py"], UY: ["uruguay", "uruguai", "ury", "uy"]
  };
  var PAIS_COD = Object.create(null);
  (function () {
    for (var cod in PAISES) {
      for (var i = 0; i < PAISES[cod].length; i++) PAIS_COD[PAISES[cod][i]] = cod;
      PAIS_COD[cod.toLowerCase()] = cod;
    }
  })();
  function codigoPais(txt) {
    var n = norm(txt);
    if (!n) return "";
    return PAIS_COD[n] || n.toUpperCase();
  }
  // o campo do registro pode listar varios paises ("Switzerland, Spain, Japan")
  function codigosPais(txt) {
    var partes = String(txt || "").split(/[,;]/), out = [];
    for (var i = 0; i < partes.length; i++) { var c = codigoPais(partes[i]); if (c && out.indexOf(c) < 0) out.push(c); }
    return out;
  }

  // ---------- preparo dos registros e indice invertido ----------
  function prepara(registros) {
    for (var k = 0; k < registros.length; k++) {
      var d = registros[k];
      d.__n = norm(d[1]);
      d.__aliases = (d[2] || []).map(norm);
      d.__dd = (d[10] || []).map(parseDoc);
      d.__docs = d.__dd.map(function (x) { return x.num; });
      d.__nasc = parseNascimentos(d[9]);
      d.__pais = codigosPais(d[6]);
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

  function tokensDoRegistro(d) {
    var vistos = Object.create(null), out = [];
    var fontes = [d.__n].concat(d.__aliases);
    for (var i = 0; i < fontes.length; i++) {
      var t = fontes[i].split(" ");
      for (var j = 0; j < t.length; j++) {
        if (t[j].length > 1 && !vistos[t[j]]) { vistos[t[j]] = 1; out.push(t[j]); }
      }
    }
    // nome feito so de iniciais ("K M A"): sem isso o registro nao entra no indice
    if (!out.length) {
      var ini = d.__n.split(" ");
      for (var m = 0; m < ini.length; m++) if (ini[m] && !vistos[ini[m]]) { vistos[ini[m]] = 1; out.push(ini[m]); }
    }
    return out;
  }

  // chaves de inicio e fim: duas palavras a uma letra de distancia dividem uma das metades
  function metades(t) {
    var k = Math.floor((t.length - 1) / 2);
    return [["p", t.substr(0, k)], ["s", t.substr(t.length - k)]];
  }

  // vocabulario de palavras -> registros, trigramas -> palavras, metades -> palavras,
  // chave fonetica -> palavras. Uma consulta toca so as palavras vizinhas, nao os 45 mil registros.
  function indexa(registros) {
    var n = registros.length;
    var idx = { n: n, voc: [], vid: Object.create(null), post: [], tri: Object.create(null), met: Object.create(null), fon: Object.create(null) };
    var voc = idx.voc, vid = idx.vid, post = idx.post, k, i, t, id;
    for (k = 0; k < n; k++) {
      var toks = tokensDoRegistro(registros[k]);
      for (i = 0; i < toks.length; i++) {
        t = toks[i];
        id = vid[t];
        if (id === undefined) { id = voc.length; vid[t] = id; voc.push(t); post.push([]); }
        post[id].push(k);
      }
    }
    for (id = 0; id < voc.length; id++) {
      t = voc[id];
      if (t.length < 4) continue;
      var vistos = Object.create(null);
      for (i = 0; i + 3 <= t.length; i++) {
        var g = t.substr(i, 3);
        if (vistos[g]) continue;
        vistos[g] = 1;
        (idx.tri[g] || (idx.tri[g] = [])).push(id);
      }
      var m = metades(t);
      for (i = 0; i < m.length; i++) {
        if (m[i][1].length < 2) continue;
        var ch = m[i][0] + m[i][1];
        (idx.met[ch] || (idx.met[ch] = [])).push(id);
      }
      var f = chaveToken(t);
      (idx.fon[f] || (idx.fon[f] = [])).push(id);
    }
    idx.acc = new Float32Array(n);
    idx.sel = new Int32Array(n);
    idx.tokn = new Int32Array(n);
    idx.melhorTok = new Float32Array(n);
    idx.stamp = 0;
    registros.__idx = idx;
    return idx;
  }

  // palavras do vocabulario parecidas com t, com a forca do parentesco (0 a 1)
  function vizinhas(idx, t) {
    var out = Object.create(null), id, i, lista;
    id = idx.vid[t];
    if (id !== undefined) out[id] = 1;
    if (t.length < 4) return out;
    lista = idx.fon[chaveToken(t)];
    if (lista) for (i = 0; i < lista.length; i++) if (out[lista[i]] === undefined) out[lista[i]] = 0.95;
    var nq = t.length - 2, cont = Object.create(null), g, p, tocados = [];
    for (i = 0; i < nq; i++) {
      g = t.substr(i, 3);
      p = idx.tri[g];
      if (!p) continue;
      for (var j = 0; j < p.length; j++) {
        if (cont[p[j]] === undefined) { cont[p[j]] = 0; tocados.push(p[j]); }
        cont[p[j]]++;
      }
    }
    var minimo = Math.ceil(nq * 0.5);
    for (i = 0; i < tocados.length; i++) {
      id = tocados[i];
      if (out[id] !== undefined || cont[id] < minimo) continue;
      var v = idx.voc[id];
      if (equivalente(t, v)) out[id] = 0.9;
      else if (v.indexOf(t) > -1 || t.indexOf(v) > -1) out[id] = 0.8;
      else out[id] = 0.4 + 0.3 * (cont[id] / nq);
    }
    var mt = metades(t);
    for (i = 0; i < 3; i++) {
      for (var h = 0; h < 2; h++) {
        var tam = mt[h][1].length + (i - 1);
        if (tam < 2) continue;
        var chave = mt[h][0] + (h === 0 ? t.substr(0, tam) : t.substr(t.length - tam));
        lista = idx.met[chave];
        if (!lista) continue;
        for (var q = 0; q < lista.length; q++) {
          if (out[lista[q]] !== undefined) continue;
          if (equivalente(t, idx.voc[lista[q]])) out[lista[q]] = 0.9;
        }
      }
    }
    return out;
  }

  // 'limite' registros mais promissores. Cada palavra da consulta soma o peso (idf) da palavra
  // vizinha mais parecida; palavra comum demais so reforça quem ja entrou por uma palavra rara.
  function candidatos(registros, q, filtro, limite) {
    filtro = filtro || { fonte: "todas", tipo: "todos" };
    limite = limite || 500;
    var idx = registros.__idx;
    if (!idx || idx.n !== registros.length) idx = indexa(registros);
    var toks = q.split(" ").filter(Boolean);
    var consulta = [], i, j;
    for (i = 0; i < toks.length; i++) {
      var viz = vizinhas(idx, toks[i]), ids = [], tam = 0;
      for (var id in viz) { ids.push(Number(id)); tam += idx.post[id].length; }
      consulta.push({ viz: viz, ids: ids, tam: tam });
    }
    var ordem = consulta.slice().sort(function (a, b) { return a.tam - b.tam; });
    var tocados = [], stamp = ++idx.stamp, acc = idx.acc, sel = idx.sel, tokn = idx.tokn, mt = idx.melhorTok;
    var N = registros.length, multi = toks.length > 1;
    for (i = 0; i < ordem.length; i++) {
      var c = ordem[i], novos = !(multi && c.tam > 3000 && tocados.length);
      var marca = stamp * 64 + i + 1;
      for (j = 0; j < c.ids.length; j++) {
        var vid2 = c.ids[j], pesoV = c.viz[vid2] * Math.log(1 + N / idx.post[vid2].length), pl = idx.post[vid2];
        for (var r = 0; r < pl.length; r++) {
          var rec = pl[r];
          if (sel[rec] !== stamp) {
            if (!novos) continue;
            sel[rec] = stamp; acc[rec] = 0; tokn[rec] = 0; mt[rec] = 0;
            tocados.push(rec);
          }
          if (tokn[rec] === marca) {
            if (pesoV > mt[rec]) { acc[rec] += pesoV - mt[rec]; mt[rec] = pesoV; }
          } else {
            tokn[rec] = marca; mt[rec] = pesoV; acc[rec] += pesoV;
          }
        }
      }
    }
    var out = [];
    for (i = 0; i < tocados.length; i++) {
      var d = registros[tocados[i]];
      if (filtro.fonte !== "todas" && d[3] !== filtro.fonte) continue;
      if (filtro.tipo !== "todos" && d[4] !== filtro.tipo) continue;
      out.push([acc[tocados[i]], d]);
    }
    out.sort(function (a, b) { return b[0] - a[0]; });
    return out.slice(0, limite);
  }

  // Varredura linear com mascaras de trigrama (o metodo antigo). Fica so como
  // referencia para o benchmark medir o que o indice invertido deixa passar.
  function candidatosVarredura(registros, q, filtro, limite) {
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

  // ---------- desambiguacao: nascimento, pais, documento ----------
  function leConsulta(c) {
    c = c || {};
    var info = { q: String(c.q || ""), avisos: [], nasc: null, pais: "", doc: null };
    if (c.nasc && String(c.nasc).trim()) {
      info.nasc = parseData(c.nasc);
      if (!info.nasc) info.avisos.push("Data de nascimento não reconhecida: use dd/mm/aaaa, aaaa-mm-dd ou só o ano.");
    }
    if (c.pais && String(c.pais).trim()) info.pais = codigoPais(c.pais);
    var docTxt = c.doc && String(c.doc).trim() ? String(c.doc) : "";
    if (!docTxt && !/[a-zA-ZÀ-ɏЀ-ӿ]/.test(info.q) && /[0-9]/.test(info.q)) docTxt = info.q;
    else if (!docTxt && info.q.replace(/[^0-9]/g, "").length >= 6 && !/[a-zA-ZÀ-ɏЀ-ӿ]/.test(info.q.replace(/\b(cpf|cnpj|doc|documento|rg|passaporte|passport|id|n[ºo°]?)(?![a-zA-Z])/gi, ""))) docTxt = info.q;
    if (docTxt) {
      info.doc = parseDoc(docTxt);
      if ((info.doc.tipo === "cpf" || info.doc.tipo === "cnpj") && !info.doc.mascarado && !info.doc.valido) {
        info.avisos.push((info.doc.tipo === "cpf" ? "CPF" : "CNPJ") + " com dígito verificador inválido: confira a digitação.");
      }
    }
    info.nomeNorm = norm(info.q);
    info.temNome = /[a-z]/.test(info.nomeNorm) && info.nomeNorm.replace(/ /g, "").length >= 3;
    return info;
  }

  function ajusta(d, info, base) {
    var aj = [], score = base, delta = 0;
    if (info.doc) {
      var doc = info.doc, achou = false, mascarado = false, mesmoTipo = false, compat = false;
      for (var i = 0; i < d.__dd.length; i++) {
        var r = d.__dd[i];
        if (doc.tipo === "outro" || r.tipo === "outro") {
          if (doc.tipo === "outro" && r.tipo === "outro" && doc.num.length >= 5) { mesmoTipo = true; if (doc.num === r.num) achou = true; }
          continue;
        }
        if (doc.tipo !== r.tipo) continue;
        mesmoTipo = true;
        if (!doc.mascarado && !r.mascarado) { if (doc.num === r.num) achou = true; }
        else if (docsCompativeis(doc.num, r.num)) { mascarado = true; compat = true; }
      }
      if (achou) return { score: 100, base: base, ajustes: [{ k: "doc", rotulo: "documento idêntico", delta: 100 - base }] };
      if (mascarado && compat) { delta += PESOS.docMascarado; aj.push({ k: "doc", rotulo: "documento mascarado compatível", delta: PESOS.docMascarado }); }
      else if (mesmoTipo) { delta += PESOS.docDiverge; aj.push({ k: "doc", rotulo: "documento diferente do registro", delta: PESOS.docDiverge }); }
      else if ((doc.tipo === "cpf" && d[4] === "entidade") || (doc.tipo === "cnpj" && d[4] === "pessoa")) {
        delta += PESOS.docTipo; aj.push({ k: "doc", rotulo: "tipo de documento incompatível com o registro", delta: PESOS.docTipo });
      }
    }
    if (base >= PESOS.pisoBonus || delta < 0) {
      if (info.nasc && d.__nasc.length) {
        var cn = comparaNasc(info.nasc, d.__nasc);
        if (cn && (cn.delta < 0 || base >= PESOS.pisoBonus)) { delta += cn.delta; aj.push({ k: "nasc", rotulo: cn.rotulo, delta: cn.delta }); }
      }
      if (info.pais && d.__pais.length) {
        var igual = d.__pais.indexOf(info.pais) > -1;
        var dp = igual ? PESOS.paisIgual : PESOS.paisDiverge;
        if (dp < 0 || base >= PESOS.pisoBonus) { delta += dp; aj.push({ k: "pais", rotulo: igual ? "mesmo país" : "país diferente (" + d[6] + ")", delta: dp }); }
      }
    }
    score = Math.max(0, Math.min(100, Math.round(base + delta)));
    return { score: score, base: base, ajustes: aj };
  }

  // documento completo vira consulta direta no dicionario; trecho ou mascara, varredura
  function porDocumento(registros, doc) {
    var out = [], i, j;
    if (!doc || doc.num.length < 4) return out;
    var completo = (doc.tipo === "cpf" || doc.tipo === "cnpj") && !doc.mascarado;
    if (completo && registros.__docIdx && registros.__docIdx.n === registros.length) {
      var l = registros.__docIdx.m[doc.num] || [];
      for (i = 0; i < l.length; i++) out.push({ rec: registros[l[i]], score: 100, rotulo: "documento idêntico" });
      return out;
    }
    for (i = 0; i < registros.length; i++) {
      var d = registros[i];
      for (j = 0; j < d.__dd.length; j++) {
        var r = d.__dd[j];
        if (!r.num) continue;
        if (doc.tipo === r.tipo && (doc.tipo === "cpf" || doc.tipo === "cnpj")) {
          if (!doc.mascarado && !r.mascarado) { if (doc.num === r.num) { out.push({ rec: d, score: 100, rotulo: "documento idêntico" }); break; } }
          else if (docsCompativeis(doc.num, r.num)) { out.push({ rec: d, score: 100 - (doc.mascarado || r.mascarado ? 8 : 0), rotulo: "documento mascarado compatível" }); break; }
        } else if (doc.tipo === "outro" && r.num.indexOf(doc.num) > -1) {
          out.push({ rec: d, score: r.num === doc.num ? 100 : PESOS.docParcial, rotulo: r.num === doc.num ? "documento idêntico" : "trecho do documento" }); break;
        }
      }
    }
    return out;
  }
  function indexaDocumentos(registros) {
    var m = Object.create(null);
    for (var i = 0; i < registros.length; i++) {
      var dd = registros[i].__dd;
      for (var j = 0; j < dd.length; j++) {
        if ((dd[j].tipo === "cpf" || dd[j].tipo === "cnpj") && !dd[j].mascarado) (m[dd[j].num] || (m[dd[j].num] = [])).push(i);
      }
    }
    registros.__docIdx = { n: registros.length, m: m };
  }

  // Busca completa: candidatos pelo indice, score de nome, ajuste por nascimento/pais/documento.
  // consulta: { q, nasc, pais, doc }  opts: { fonte, tipo, limiar, candidatos }
  function busca(registros, consulta, opts) {
    opts = opts || {};
    var limiar = opts.limiar == null ? 60 : opts.limiar;
    var filtro = { fonte: opts.fonte || "todas", tipo: opts.tipo || "todos" };
    var info = leConsulta(consulta), res = [], vistos = Object.create(null), i;
    var temCtx = !!(info.doc || info.nasc || info.pais);
    if (info.temNome && info.nomeNorm.length >= 3) {
      var cands = candidatos(registros, info.nomeNorm, filtro, opts.candidatos || 500);
      for (i = 0; i < cands.length; i++) {
        var d = cands[i][1];
        var base = melhorSim(info.nomeNorm, d.__n, d.__aliases);
        if (base < (temCtx ? limiar - 15 : limiar)) continue;
        var a = temCtx ? ajusta(d, info, base) : { score: base, base: base, ajustes: [] };
        if (a.score >= limiar) { res.push({ rec: d, score: a.score, base: a.base, ajustes: a.ajustes }); vistos[d[0]] = 1; }
      }
    }
    if (info.doc && info.doc.num.length >= 4) {
      if (!registros.__docIdx || registros.__docIdx.n !== registros.length) indexaDocumentos(registros);
      var achados = porDocumento(registros, info.doc);
      for (i = 0; i < achados.length; i++) {
        var rec = achados[i].rec;
        if (filtro.fonte !== "todas" && rec[3] !== filtro.fonte) continue;
        if (filtro.tipo !== "todos" && rec[4] !== filtro.tipo) continue;
        if (vistos[rec[0]]) {
          for (var k = 0; k < res.length; k++) if (res[k].rec[0] === rec[0] && achados[i].score > res[k].score) {
            res[k].score = achados[i].score;
            res[k].ajustes = [{ k: "doc", rotulo: achados[i].rotulo, delta: achados[i].score - res[k].base }];
          }
          continue;
        }
        vistos[rec[0]] = 1;
        res.push({ rec: rec, score: achados[i].score, base: 0, ajustes: [{ k: "doc", rotulo: achados[i].rotulo, delta: achados[i].score }] });
      }
    }
    var ql = info.nomeNorm.length;
    res.sort(function (x, y) {
      return y.score - x.score || y.base - x.base ||
        Math.abs(x.rec.__n.length - ql) - Math.abs(y.rec.__n.length - ql) || (x.rec[1] < y.rec[1] ? -1 : 1);
    });
    return { resultados: res, avisos: info.avisos, info: info };
  }

  // Servidor: guarda a base e responde as buscas. Roda dentro do Web Worker
  // (site/worker.js) ou na propria pagina quando o navegador nao tem worker.
  function servidor() {
    var base = [];
    function limpa(r, q, comExplicacao) {
      var raw = r.rec.slice(0, 12);
      var o = { rec: raw, score: r.score, base: r.base, ajustes: r.ajustes };
      if (comExplicacao && q) {
        // explica contra o nome (ou apelido) que de fato casou
        var alvo = r.rec.__n, s = similaridade(q, alvo), via = "", al = r.rec.__aliases || [];
        for (var i = 0; i < al.length && i < 8; i++) {
          var s2 = similaridade(q, al[i]);
          if (s2 > s) { s = s2; alvo = al[i]; via = raw[2][i] || al[i]; }
        }
        o.exp = explica(q, alvo);
        if (via) o.via = via;
      }
      return o;
    }
    return {
      carregar: function (lista) { base = prepara(lista); indexa(base); indexaDocumentos(base); return base.length; },
      adicionar: function (lista) { base = base.concat(prepara(lista)); indexa(base); indexaDocumentos(base); return base.length; },
      total: function () { return base.length; },
      base: function () { return base; },
      buscar: function (consulta, opts) {
        var t0 = Date.now();
        var r = busca(base, consulta, opts);
        var max = (opts && opts.maximo) || 500;
        var q = r.info.nomeNorm;
        return {
          resultados: r.resultados.slice(0, max).map(function (x, i) { return limpa(x, q, i < 60); }),
          total: r.resultados.length, avisos: r.avisos, ms: Date.now() - t0
        };
      },
      melhor: function (consulta, opts) {
        var r = busca(base, consulta, { limiar: 0, candidatos: (opts && opts.candidatos) || 300, fonte: "todas", tipo: "todos" });
        return r.resultados.length ? limpa(r.resultados[0], r.info.nomeNorm, false) : null;
      }
    };
  }

  // Contrato de mensagens usado pelo Web Worker e pelo modo sem worker: o mesmo codigo atende os dois.
  function buscaJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " em " + url);
      return r.json();
    });
  }
  function despacha(srv, tipo, a) {
    a = a || {};
    try {
      switch (tipo) {
        case "carregarUrl": return buscaJson(a.url).then(function (j) { return srv.carregar(j); });
        case "adicionarUrl": return buscaJson(a.url).then(function (j) { return { total: srv.adicionar(j), adicionados: j.length }; });
        case "carregar": return Promise.resolve(srv.carregar(a.lista));
        case "adicionar": return Promise.resolve(srv.adicionar(a.lista));
        case "total": return Promise.resolve(srv.total());
        case "buscar": return Promise.resolve(srv.buscar(a.consulta, a.opts));
        case "melhor": return Promise.resolve(srv.melhor(a.consulta, a.opts));
      }
      return Promise.reject(new Error("mensagem desconhecida: " + tipo));
    } catch (e) { return Promise.reject(e); }
  }

  var Motor = {
    despacha: despacha,
    PESOS: PESOS, norm: norm, chaveToken: chaveToken, chaveNome: chaveNome, equivalente: equivalente, levLimitado: levLimitado,
    mascara: mascara, popcount: popcount, dice: dice, jaroWinkler: jaroWinkler,
    cobertura: cobertura, similaridade: similaridade, similaridadeLetras: similaridadeLetras, melhorSim: melhorSim, faixa: faixa, explica: explica,
    validaCPF: validaCPF, validaCNPJ: validaCNPJ, parseDoc: parseDoc, docsCompativeis: docsCompativeis,
    parseData: parseData, parseNascimentos: parseNascimentos, comparaNasc: comparaNasc, codigoPais: codigoPais, codigosPais: codigosPais,
    prepara: prepara, indexa: indexa, indexaDocumentos: indexaDocumentos, candidatos: candidatos, candidatosVarredura: candidatosVarredura,
    leConsulta: leConsulta, ajusta: ajusta, porDocumento: porDocumento, busca: busca, servidor: servidor
  };
  raiz.Motor = Motor;
  if (typeof module !== "undefined" && module.exports) module.exports = Motor;
})(typeof window !== "undefined" ? window : globalThis);
