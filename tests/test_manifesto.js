/* Roda com: node tests/test_manifesto.js
   Confere a corrente do manifesto e o hash do CSV publicado. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function canonico(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonico).join(",") + "]";
  return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonico(v[k])).join(",") + "}";
}
function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

let falhas = 0, total = 0;
function ok(cond, msg, extra) {
  total++;
  if (cond) console.log("  ok   " + msg);
  else { falhas++; console.log("  FALHOU " + msg + (extra ? " -> " + extra : "")); }
}

const arqManifesto = path.join(__dirname, "..", "data", "manifesto.json");
if (!fs.existsSync(arqManifesto)) {
  console.log("manifesto ainda nao gerado; nada a conferir");
  process.exit(0);
}
const manifesto = JSON.parse(fs.readFileSync(arqManifesto, "utf8"));
console.log("manifesto com " + manifesto.length + " dia(s)");

let anterior = "0".repeat(64);
let eloOk = true, hashOk = true;
for (const e of manifesto) {
  if (e.hash_anterior !== anterior) eloOk = false;
  const copia = Object.assign({}, e);
  delete copia.cadeia_hash;
  if (sha256(Buffer.from(canonico(copia), "utf8")) !== e.cadeia_hash) hashOk = false;
  anterior = e.cadeia_hash;
}
ok(eloOk, "cada dia aponta para o hash do dia anterior");
ok(hashOk, "o hash de cada linha confere com o conteudo");

const ultimo = manifesto[manifesto.length - 1];
const arqCsv = path.join(__dirname, "..", "docs", "dados", "sancoes.csv");
if (fs.existsSync(arqCsv)) {
  const h = sha256(fs.readFileSync(arqCsv));
  ok(h === ultimo.csv_sha256, "o CSV publicado bate com o hash do manifesto", h.slice(0, 16));
  ok(fs.statSync(arqCsv).size === ultimo.csv_bytes, "o tamanho do CSV bate");
}
const arqIndice = path.join(__dirname, "..", "docs", "dados", "indice.json");
if (fs.existsSync(arqIndice)) {
  ok(sha256(fs.readFileSync(arqIndice)) === ultimo.indice_sha256, "o indice publicado bate com o hash");
}

// tamper: mudar um registro tem de derrubar a corrente
const adulterado = JSON.parse(JSON.stringify(manifesto));
adulterado[0].total = adulterado[0].total + 1;
const copia = Object.assign({}, adulterado[0]);
delete copia.cadeia_hash;
ok(sha256(Buffer.from(canonico(copia), "utf8")) !== adulterado[0].cadeia_hash,
   "alterar um registro quebra o hash daquele dia");

console.log("");
console.log(falhas === 0 ? "TODOS OS " + total + " TESTES PASSARAM" : falhas + " DE " + total + " FALHARAM");
process.exit(falhas === 0 ? 0 : 1);
