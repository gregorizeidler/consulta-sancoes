/* Benchmark de qualidade do match: precisao e recall contra tests/fixtures/benchmark.json.
 * Uso:  node tests/benchmark.js            relatorio
 *       node tests/benchmark.js --check    falha se ficar abaixo de tests/benchmark_minimos.json
 *       node tests/benchmark.js --json     saida em JSON (para comparar versoes)
 *       MOTOR=/caminho/motor_antigo.js node tests/benchmark.js   mede outro motor com as mesmas perguntas
 * Precisao: dos resultados com score >= limiar, quantos eram o registro certo (esperado no rotulo).
 * Recall:   das consultas que tinham resposta, quantas devolveram o registro certo com score >= limiar.
 * Negativos: consulta sem resposta; qualquer resultado >= limiar e falso positivo. */
"use strict";
const fs = require("fs");
const path = require("path");

const motorPath = process.env.MOTOR || path.join(__dirname, "..", "site", "motor.js");
const Motor = require(motorPath);
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "benchmark.json"), "utf8"));
const LIMIARES = [85, 70];
const args = process.argv.slice(2);

const registros = Motor.prepara(fx.registros.map((d) => d.slice()));

// mesmo contrato para o motor novo (busca com contexto) e o antigo (so nome)
function executa(c) {
  if (Motor.busca) {
    const r = Motor.busca(registros, { q: c.q, nasc: c.nasc, pais: c.pais, doc: c.doc }, { limiar: 60, candidatos: 500 });
    return r.resultados.map((x) => ({ id: x.rec[0], score: x.score }));
  }
  const q = Motor.norm(c.q);
  if (q.length < 3) return [];
  return Motor.candidatos(registros, q, { fonte: "todas", tipo: "todos" }, 500)
    .map((p) => ({ id: p[1][0], score: Motor.melhorSim(q, p[1].__n, p[1].__aliases) }))
    .filter((x) => x.score >= 60).sort((a, b) => b.score - a.score);
}

const t0 = Date.now();
const respostas = fx.consultas.map((c) => ({ c: c, r: executa(c) }));
const ms = Date.now() - t0;

function mede(limiar) {
  const porCat = {};
  const tot = { tp: 0, fp: 0, pos: 0, achou: 0, top1: 0, mrr: 0, neg: 0, negFp: 0 };
  for (const { c, r } of respostas) {
    const cat = porCat[c.cat] || (porCat[c.cat] = { n: 0, pos: 0, achou: 0, top1: 0, tp: 0, fp: 0, negLimpo: 0, neg: 0 });
    const esp = new Set(c.esp), acima = r.filter((x) => x.score >= limiar);
    cat.n++;
    const tp = acima.filter((x) => esp.has(x.id)).length, fp = acima.length - tp;
    cat.tp += tp; cat.fp += fp; tot.tp += tp; tot.fp += fp;
    if (esp.size) {
      cat.pos++; tot.pos++;
      if (tp > 0) { cat.achou++; tot.achou++; }
      if (acima.length && esp.has(acima[0].id)) { cat.top1++; tot.top1++; }
      const pos = r.findIndex((x) => esp.has(x.id));
      if (pos > -1) tot.mrr += 1 / (pos + 1);
    } else {
      cat.neg++; tot.neg++;
      if (!acima.length) cat.negLimpo++; else tot.negFp++;
    }
  }
  const precisao = tot.tp + tot.fp ? tot.tp / (tot.tp + tot.fp) : 1;
  const recall = tot.pos ? tot.achou / tot.pos : 1;
  return {
    limiar: limiar, precisao: precisao, recall: recall, f1: 2 * precisao * recall / (precisao + recall || 1),
    top1: tot.pos ? tot.top1 / tot.pos : 1, mrr: tot.pos ? tot.mrr / tot.pos : 1,
    negativosLimpos: tot.neg ? 1 - tot.negFp / tot.neg : 1, falsosPositivos: tot.fp, porCat: porCat
  };
}
const medidas = LIMIARES.map(mede);

if (args.includes("--json")) {
  console.log(JSON.stringify({ motor: motorPath, consultas: fx.consultas.length, registros: registros.length, ms: ms, medidas: medidas.map((m) => ({
    limiar: m.limiar, precisao: m.precisao, recall: m.recall, f1: m.f1, top1: m.top1, mrr: m.mrr, negativosLimpos: m.negativosLimpos, falsosPositivos: m.falsosPositivos })) }, null, 1));
  process.exit(0);
}

const pct = (x) => (100 * x).toFixed(1).padStart(5) + "%";
console.log("Benchmark do match: " + fx.consultas.length + " consultas, " + registros.length + " registros, " + ms + " ms (" + path.basename(motorPath) + ")");
for (const m of medidas) {
  console.log("\nLimiar " + m.limiar + "  precisao " + pct(m.precisao) + "  recall " + pct(m.recall) + "  F1 " + pct(m.f1) +
    "  top-1 " + pct(m.top1) + "  MRR " + m.mrr.toFixed(3) + "  negativos limpos " + pct(m.negativosLimpos) + "  falsos positivos " + m.falsosPositivos);
  console.log("  " + "categoria".padEnd(18) + "n".padStart(5) + "  recall   top-1   neg.limpos  FP");
  for (const k of Object.keys(m.porCat)) {
    const c = m.porCat[k];
    console.log("  " + k.padEnd(18) + String(c.n).padStart(5) + "  " + (c.pos ? pct(c.achou / c.pos) : "    - ") + "  " +
      (c.pos ? pct(c.top1 / c.pos) : "    - ") + "  " + (c.neg ? pct(c.negLimpo / c.neg) : "     -  ") + "     " + c.fp);
  }
}

if (args.includes("--check")) {
  const minimos = JSON.parse(fs.readFileSync(path.join(__dirname, "benchmark_minimos.json"), "utf8"));
  let falhas = 0;
  for (const m of medidas) {
    const piso = minimos[String(m.limiar)];
    if (!piso) continue;
    for (const k of Object.keys(piso)) {
      if (k === "porCategoria") continue;
      if (m[k] < piso[k]) { console.log("FALHOU limiar " + m.limiar + ": " + k + " " + m[k].toFixed(3) + " < " + piso[k]); falhas++; }
    }
    for (const cat of Object.keys(piso.porCategoria || {})) {
      const c = m.porCat[cat];
      const v = c.pos ? c.achou / c.pos : c.negLimpo / c.neg;
      if (v < piso.porCategoria[cat]) { console.log("FALHOU limiar " + m.limiar + ", " + cat + ": " + v.toFixed(3) + " < " + piso.porCategoria[cat]); falhas++; }
    }
  }
  if (falhas) { console.log("\nBenchmark abaixo do minimo (" + falhas + " falhas)"); process.exit(1); }
  console.log("\nBenchmark dentro dos minimos");
}
