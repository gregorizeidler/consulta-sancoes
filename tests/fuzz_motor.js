/* Fuzzing do motor de match: entradas aleatorias e invariantes que valem para qualquer entrada.
 * Uso: node tests/fuzz_motor.js [iteracoes=3000] [semente]
 * A semente aparece na saida; rodar de novo com ela reproduz exatamente a falha.
 * Tres familias de teste:
 *   1. robustez: nenhuma entrada (unicode, controle, vazio, gigante) derruba o motor;
 *   2. propriedades: limites do score, idempotencia, simetria, dv de CPF/CNPJ;
 *   3. metamorficos: mudancas que nao alteram a identidade (caixa, acento, pontuacao, ordem)
 *      nao podem derrubar o score. */
"use strict";
const fs = require("fs");
const path = require("path");
const Motor = require("../site/motor.js");

const iteracoes = Number(process.argv[2]) || 3000;
const semente = Number(process.argv[3]) || (Date.now() % 2147483647);
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(semente);
const inteiro = (n) => Math.floor(rnd() * n);
const pick = (a) => a[inteiro(a.length)];

let falhas = 0, verificacoes = 0;
const exemplos = {};
function confere(nome, ok, detalhe) {
  verificacoes++;
  if (ok) return;
  falhas++;
  exemplos[nome] = exemplos[nome] || [];
  if (exemplos[nome].length < 3) exemplos[nome].push(detalhe);
}
function tenta(nome, fn) {
  try { return fn(); } catch (e) { confere(nome, false, "excecao: " + (e && e.message) + " | " + (e && e.stack || "").split("\n")[1]); }
}

// ---- geradores de entrada hostil ----
const PEDACOS = ["", " ", "  ", "\t", "\n", "\u0000", "​", "﻿", "‮", "ß", "ø", "ł", "İ", "ǅ", "ﬁ", "ñ", "é", "ü", "ç",
  "Ж", "ё", "щ", "Ъ", "ї", "ا", "م", "中", "文", "日", "🙂", "👨‍👩‍👧", "\ud83d", "\ude00", "-", "'", ".", ",", "/", "\\", "*", "(", ")", "[", "]",
  "0", "1", "9", "99", "al", "el", "bin", "de", "da", "the", "ltd", "mohammed", "muhammad", "putin", "vladimir", "sberbank"];
function lixo() {
  const n = inteiro(14);
  let s = "";
  for (let i = 0; i < n; i++) s += rnd() < 0.6 ? pick(PEDACOS) : String.fromCharCode(inteiro(0x2500));
  if (rnd() < 0.03) s = s.repeat(1 + inteiro(400));
  return s;
}
const LETRAS = "abcdefghijklmnopqrstuvwxyz";
function palavra() { let n = 2 + inteiro(10), s = ""; while (n--) s += LETRAS[inteiro(26)]; return s; }
function nomeAleatorio() { const n = 1 + inteiro(5), t = []; for (let i = 0; i < n; i++) t.push(palavra()); return t.join(" "); }

// ---- base: a real se existir, senao uma sintetica ----
let registros;
const arq = path.join(__dirname, "..", "docs", "dados", "indice.json");
const fixture = path.join(__dirname, "fixtures", "benchmark.json");
if (fs.existsSync(fixture)) registros = JSON.parse(fs.readFileSync(fixture, "utf8")).registros;
else if (fs.existsSync(arq)) registros = JSON.parse(fs.readFileSync(arq, "utf8")).slice(0, 5000);
else {
  registros = [];
  for (let i = 0; i < 800; i++) registros.push(["s" + i, nomeAleatorio().toUpperCase(), [], pick(["ofac", "ceis", "eu"]), pick(["pessoa", "entidade"]), "", pick(["Russia", "BR", ""]), "", "", pick(["", "1970", "12 Mar 1980"]), [], ""]);
}
Motor.prepara(registros);

// ---- 1. robustez e propriedades de string ----
for (let i = 0; i < iteracoes; i++) {
  const a = lixo(), b = lixo();
  const na = tenta("norm", () => Motor.norm(a)), nb = tenta("norm", () => Motor.norm(b));
  if (typeof na !== "string" || typeof nb !== "string") continue;
  confere("norm so ASCII minusculo", /^[a-z0-9 ]*$/.test(na) && !/^ | $|  /.test(na), JSON.stringify(a) + " -> " + JSON.stringify(na));
  confere("norm idempotente", Motor.norm(na) === na, JSON.stringify(a) + " -> " + na + " -> " + Motor.norm(na));
  const s = tenta("similaridade", () => Motor.similaridade(na, nb));
  confere("score inteiro em 0..100", Number.isInteger(s) && s >= 0 && s <= 100, JSON.stringify([na, nb, s]));
  if (na) confere("auto-similaridade 100", Motor.similaridade(na, na) === 100, na);
  const d1 = tenta("dice", () => Motor.dice(na, nb)), d2 = Motor.dice(nb, na);
  confere("dice simetrico e em 0..1", d1 === d2 && d1 >= 0 && d1 <= 1, JSON.stringify([na, nb, d1, d2]));
  const jw = tenta("jw", () => Motor.jaroWinkler(na, nb));
  confere("jaro-winkler em 0..1", jw >= 0 && jw <= 1.0000001, JSON.stringify([na, nb, jw]));
  tenta("explica", () => Motor.explica(na, nb));
  tenta("chaveNome", () => Motor.chaveNome(na));
  tenta("parseData", () => Motor.parseData(a));
  tenta("parseNascimentos", () => Motor.parseNascimentos(a));
  tenta("parseDoc", () => Motor.parseDoc(a));
  tenta("codigoPais", () => Motor.codigoPais(a));
  const lim = inteiro(4);
  const x = na.slice(0, 20), y = nb.slice(0, 20);
  const lv = Motor.levLimitado(x, y, lim);
  confere("levLimitado consistente com o limite", lv >= 0 && (lv <= lim || lv === lim + 1), JSON.stringify([x, y, lim, lv]));
  confere("levLimitado simetrico", Motor.levLimitado(y, x, lim) === lv, JSON.stringify([x, y, lim]));
}

// ---- 2. busca com contexto aleatorio ----
for (let i = 0; i < Math.min(iteracoes / 6, 400); i++) {
  const ctx = {
    q: rnd() < 0.7 ? (rnd() < 0.5 ? lixo() : nomeAleatorio()) : (rnd() < 0.5 ? registros[inteiro(registros.length)][1] : ""),
    nasc: rnd() < 0.4 ? (rnd() < 0.5 ? lixo() : pick(["01/02/1970", "1970-02-01", "1970", "31/12/1999"])) : undefined,
    pais: rnd() < 0.4 ? (rnd() < 0.5 ? lixo() : pick(["Brasil", "Russia", "IR", ""])) : undefined,
    doc: rnd() < 0.4 ? (rnd() < 0.5 ? lixo() : pick(["123.456.789-09", "***.456.789-**", "12.345.678/0001-95", "123"])) : undefined
  };
  const r = tenta("busca", () => Motor.busca(registros, ctx, { limiar: inteiro(80) }));
  if (!r) continue;
  let ordenado = true;
  for (let k = 1; k < r.resultados.length; k++) if (r.resultados[k - 1].score < r.resultados[k].score) ordenado = false;
  confere("busca ordenada por score", ordenado, JSON.stringify(ctx).slice(0, 120));
  confere("busca com score em 0..100", r.resultados.every((x) => x.score >= 0 && x.score <= 100 && Number.isInteger(x.score)), JSON.stringify(ctx).slice(0, 120));
  const ids = r.resultados.map((x) => x.rec[0]);
  confere("busca sem registro repetido", new Set(ids).size === ids.length, JSON.stringify(ctx).slice(0, 120));
}

// ---- 3. CPF / CNPJ ----
let cpfTrocas = 0, cpfPassou = 0;
function cpfAleatorio() {
  const d = []; for (let i = 0; i < 9; i++) d.push(inteiro(10));
  for (let t = 9; t < 11; t++) { let s = 0; for (let i = 0; i < t; i++) s += d[i] * (t + 1 - i); let v = (s * 10) % 11; if (v === 10) v = 0; d.push(v); }
  return d.join("");
}
function cnpjAleatorio() {
  const d = []; for (let i = 0; i < 12; i++) d.push(inteiro(10));
  const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (let t = 12; t < 14; t++) { let s = 0; for (let i = 0; i < t; i++) s += d[i] * pesos[i + (13 - t)]; const m = s % 11; d.push(m < 2 ? 0 : 11 - m); }
  return d.join("");
}
for (let i = 0; i < Math.min(iteracoes, 2000); i++) {
  const c = cpfAleatorio();
  if (/^(\d)\1{10}$/.test(c)) continue;
  confere("CPF gerado valida", Motor.validaCPF(c), c);
  // trocar um digito de verificacao sempre invalida; trocar um dos 9 primeiros quase sempre
  // (o resto 10 e o resto 0 geram o mesmo digito, entao raramente a troca passa despercebida)
  const pos = 9 + inteiro(2), novo = (Number(c[pos]) + 1 + inteiro(9)) % 10;
  const errado = c.slice(0, pos) + novo + c.slice(pos + 1);
  confere("CPF com digito verificador errado nao valida", !Motor.validaCPF(errado), c + " -> " + errado);
  const p9 = inteiro(9), e9 = c.slice(0, p9) + ((Number(c[p9]) + 1 + inteiro(9)) % 10) + c.slice(p9 + 1);
  cpfTrocas++; if (Motor.validaCPF(e9)) cpfPassou++;
  const fmt = c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  const pd = Motor.parseDoc("CPF: " + fmt);
  confere("parseDoc le CPF formatado", pd.tipo === "cpf" && pd.valido && pd.num === c, fmt);
  const mascarado = "***." + c.slice(3, 6) + "." + c.slice(6, 9) + "-**";
  const pm = Motor.parseDoc(mascarado);
  confere("CPF mascarado e reconhecido e compativel", pm.tipo === "cpf" && pm.mascarado && Motor.docsCompativeis(pm.num, c), mascarado);
  const outro = cpfAleatorio();
  confere("mascara nao casa CPF de outro final", outro.slice(3, 9) === c.slice(3, 9) || !Motor.docsCompativeis(pm.num, outro), mascarado + " x " + outro);
  const n = cnpjAleatorio();
  if (/^(\d)\1{13}$/.test(n)) continue;
  confere("CNPJ gerado valida", Motor.validaCNPJ(n), n);
  const p2 = 12 + inteiro(2), n2 = (Number(n[p2]) + 1 + inteiro(9)) % 10;
  const errado2 = n.slice(0, p2) + n2 + n.slice(p2 + 1);
  confere("CNPJ com digito verificador errado nao valida", !Motor.validaCNPJ(errado2), n + " -> " + errado2);
}

confere("troca em digito de CPF passa em menos de 15% dos casos", cpfTrocas === 0 || cpfPassou / cpfTrocas < 0.15, cpfPassou + "/" + cpfTrocas);

// ---- 4. metamorficos sobre nomes reais ----
const nomes = registros.filter((d) => d[4] !== "aeronave" && Motor.norm(d[1]).length >= 4);
function semAcentoCaixaPontuacao(s) {
  return s.split(" ").map((t, i) => (i % 2 ? t.toUpperCase() : t.toLowerCase())).join(pick([" ", ", ", "-", " . "])) + pick(["", ".", " ", ";"]);
}
for (let i = 0; i < Math.min(iteracoes / 3, 800); i++) {
  const d = pick(nomes), q = Motor.norm(d[1]);
  const ruido = Motor.norm(semAcentoCaixaPontuacao(q));
  confere("caixa/pontuacao nao muda o nome normalizado", ruido === q, q + " -> " + ruido);
  const t = q.split(" ");
  if (t.length >= 2 && t.length <= 5) {
    const emb = t.slice(); for (let k = emb.length - 1; k > 0; k--) { const j = inteiro(k + 1); const tmp = emb[k]; emb[k] = emb[j]; emb[j] = tmp; }
    const s = Motor.similaridade(emb.join(" "), q);
    confere("ordem trocada continua >= 90", s >= 90, emb.join(" ") + " x " + q + " = " + s);
  }
  const longas = t.map((x, k) => k).filter((k) => t[k].length >= 6 && /^[a-z]+$/.test(t[k]));
  if (longas.length && t.length <= 4) {
    const k = pick(longas), w = t[k], p = 1 + inteiro(w.length - 3), v = t.slice();
    v[k] = w.slice(0, p) + w[p + 1] + w[p] + w.slice(p + 2);
    if (v[k] !== w) {
      const s = Motor.similaridade(v.join(" "), q);
      confere("uma transposicao em palavra longa continua >= 85", s >= 85, v.join(" ") + " x " + q + " = " + s);
    }
  }
  const r = tenta("busca nome real", () => Motor.busca(registros, { q: d[1] }, { limiar: 90 }));
  if (r) confere("o proprio nome acha o proprio registro", r.resultados.some((x) => x.rec[0] === d[0]), d[1] + " (" + d[0] + ")");
}

console.log("Fuzzing do motor: " + verificacoes + " verificacoes, " + iteracoes + " iteracoes, semente " + semente);
if (falhas) {
  console.log("\n" + falhas + " FALHAS");
  for (const k of Object.keys(exemplos)) { console.log("  " + k); exemplos[k].forEach((e) => console.log("     " + e)); }
  console.log("\nReproduzir: node tests/fuzz_motor.js " + iteracoes + " " + semente);
  process.exit(1);
}
console.log("Nenhuma violacao.");
