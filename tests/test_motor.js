/* Roda com: node tests/test_motor.js
   Testes do motor de busca difusa contra a base real (se ela estiver gerada). */
const fs = require("fs");
const path = require("path");
const Motor = require("../site/motor.js");

let falhas = 0, total = 0;
function ok(cond, msg, extra) {
  total++;
  if (cond) { console.log("  ok   " + msg); }
  else { falhas++; console.log("  FALHOU " + msg + (extra ? " -> " + extra : "")); }
}

console.log("normalizacao");
ok(Motor.norm("José da Silva") === "jose da silva", "tira acento e caixa");
ok(Motor.norm("SBERBANK  of   Russia") === "sberbank of russia", "colapsa espacos");
ok(Motor.norm("A.-B/C") === "a b c", "troca pontuacao por espaco");

console.log("similaridade");
ok(Motor.similaridade("banco nacional de cuba", "banco nacional de cuba") === 100, "nome identico = 100");
ok(Motor.similaridade("sberbnak", "sberbank") >= 70, "erro de digitacao acima de 70",
   String(Motor.similaridade("sberbnak", "sberbank")));
ok(Motor.similaridade("zaslon", "jsc scientific and technical center zaslon") >= 90,
   "nome curto dentro de nome oficial longo", String(Motor.similaridade("zaslon", "jsc scientific and technical center zaslon")));
ok(Motor.similaridade("aerocaribbean", "aerocaribbean airlines") >= 85, "nome parcial de empresa",
   String(Motor.similaridade("aerocaribbean", "aerocaribbean airlines")));
ok(Motor.similaridade("putin vladimir", "putin vladimir vladimirovich") >= 85, "consulta e prefixo do nome completo",
   String(Motor.similaridade("putin vladimir", "putin vladimir vladimirovich")));
ok(Motor.similaridade("putin vladimir", "putin") < 75,
   "registro so com o sobrenome nao vira correspondencia forte",
   String(Motor.similaridade("putin vladimir", "putin")));
ok(Motor.similaridade("kim jong un", "jong un kim") >= 90, "mesmas palavras em outra ordem",
   String(Motor.similaridade("kim jong un", "jong un kim")));
ok(Motor.similaridade("ali khamenei", "khamis al khanjar") < 70, "nao casa palavra curta parecida (ali/al)",
   String(Motor.similaridade("ali khamenei", "khamis al khanjar")));
ok(Motor.equivalente("sberbnak", "sberbank"), "typo de transposicao conta como mesma palavra");
ok(!Motor.equivalente("ali", "al"), "palavra de 3 letras exige igualdade");
ok(Motor.similaridade("joao da silva", "petrobras") < 60, "nome sem relacao fica baixo",
   String(Motor.similaridade("joao da silva", "petrobras")));

console.log("base real");
const arquivo = path.join(__dirname, "..", "docs", "dados", "indice.json");
if (!fs.existsSync(arquivo)) {
  console.log("  (base nao gerada, pulando testes de base real)");
} else {
  const dados = Motor.prepara(JSON.parse(fs.readFileSync(arquivo, "utf8")));
  function busca(q, limiar) {
    const nq = Motor.norm(q);
    const cands = Motor.candidatos(dados, nq, null, 400);
    const out = [];
    for (const c of cands) {
      const s = Motor.melhorSim(nq, c[1].__n, c[1].__aliases);
      if (s >= (limiar || 70)) out.push([s, c[1]]);
    }
    out.sort((a, b) => b[0] - a[0]);
    return out;
  }
  const t0 = Date.now();
  const r1 = busca("sberbnak");
  const ms = Date.now() - t0;
  ok(r1.length > 0 && r1[0][1][1].toUpperCase().includes("SBERBANK"), "acha Sberbank com typo",
     r1.length ? r1[0][1][1] + " " + r1[0][0] + "%" : "nada");
  ok(busca("zaslon").length > 0, "acha Zaslon pelo nome curto");
  ok(busca("banco nacional de cuba")[0][0] === 100, "melhor resultado vem com 100%");
  ok(ms < 1500, "busca completa abaixo de 1,5s", ms + " ms");
  console.log("  (" + (r1.length) + " candidatos com >=70% para 'sberbnak'; " + ms + " ms)");
  const porDoc = dados.filter(d => d.__docs.length && d.__docs[0].length > 5);
  ok(porDoc.length > 1000, "base tem registros com documento", String(porDoc.length));
}

console.log("");
console.log(falhas === 0 ? "TODOS OS " + total + " TESTES PASSARAM" : falhas + " DE " + total + " FALHARAM");
process.exit(falhas === 0 ? 0 : 1);
