/* Mede o que o indice invertido deixa passar: para uma amostra fixa de consultas do benchmark,
 * compara os resultados >= limiar do indice com os de uma varredura completa (todos os registros,
 * mesma funcao de score). Uso: node tests/indice_oracle.js [amostra=60] [--check] */
"use strict";
const fs = require("fs");
const path = require("path");
const Motor = require("../site/motor.js");
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "benchmark.json"), "utf8"));
const amostra = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 60);
const LIMIAR = 70;
const registros = Motor.prepara(fx.registros.map((d) => d.slice()));
const nomes = fx.consultas.filter((c) => c.q && Motor.norm(c.q).length >= 4);
const passo = Math.max(1, Math.floor(nomes.length / amostra));
let oraculo = 0, indice = 0, varrMs = 0, idxMs = 0, perdidos = [];
for (let i = 0; i < nomes.length && i / passo < amostra; i += passo) {
  const q = Motor.norm(nomes[i].q);
  let t0 = Date.now();
  const cheio = new Set();
  for (const d of registros) if (Motor.melhorSim(q, d.__n, d.__aliases) >= LIMIAR) cheio.add(d[0]);
  varrMs += Date.now() - t0;
  t0 = Date.now();
  const achados = new Set(Motor.busca(registros, { q: nomes[i].q }, { limiar: LIMIAR }).resultados.map((x) => x.rec[0]));
  idxMs += Date.now() - t0;
  oraculo += cheio.size;
  cheio.forEach((id) => { if (achados.has(id)) indice++; else perdidos.push(nomes[i].q + " -> " + id); });
}
const recall = oraculo ? indice / oraculo : 1;
console.log("Indice invertido x varredura completa (limiar " + LIMIAR + ", " + Math.min(amostra, Math.ceil(nomes.length / passo)) + " consultas)");
console.log("  resultados da varredura: " + oraculo + "   achados pelo indice: " + indice + "   recall do indice: " + (100 * recall).toFixed(2) + "%");
console.log("  tempo: varredura " + varrMs + " ms, indice " + idxMs + " ms (" + (varrMs / Math.max(1, idxMs)).toFixed(0) + "x mais rapido)");
if (perdidos.length) console.log("  perdidos (ate 8): " + perdidos.slice(0, 8).join(" | "));
if (process.argv.includes("--check") && recall < 0.98) { console.log("FALHOU: recall do indice abaixo de 98%"); process.exit(1); }
