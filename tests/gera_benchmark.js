/* Gera tests/fixtures/benchmark.json: corpus fixo e rotulado para medir precisao e recall do match.
 * Uso: node tests/gera_benchmark.js [docs/dados/indice.json]
 * A semente e fixa. Rodar de novo sobre a mesma base gera o mesmo arquivo; o arquivo e versionado
 * para que uma mudanca de peso ou limiar seja comparada sempre contra as mesmas perguntas.
 * As variantes de grafia vem da tabela escrita aqui, nao do motor: o motor nao corrige a propria prova. */
"use strict";
const fs = require("fs");
const path = require("path");

const arquivo = process.argv[2] || path.join(__dirname, "..", "docs", "dados", "indice.json");
const saida = path.join(__dirname, "fixtures", "benchmark.json");
const base = JSON.parse(fs.readFileSync(arquivo, "utf8"));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261106);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const inteiro = (n) => Math.floor(rnd() * n);
function embaralha(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = inteiro(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const simples = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9Ѐ-ӿ]+/g, " ").trim();
const toks = (s) => simples(s).split(" ").filter(Boolean);

// Variantes de grafia escritas a mao (translitaracao arabe, russa, ucraniana, portuguesa).
const VARIANTES = [
  ["mohammed", "muhammad", "mohamed", "mohammad", "muhammed", "mohamad"],
  ["ahmed", "ahmad", "ahmet"], ["hussein", "hussain", "husain", "husein"], ["hassan", "hasan"],
  ["abdul", "abdel", "abdal"], ["abdullah", "abdallah", "abdulla"], ["ibrahim", "ibraheem", "ebrahim"],
  ["osama", "usama", "oussama"], ["khaled", "khalid", "khalad"], ["mustafa", "moustafa", "mostafa"],
  ["yusuf", "yousef", "yousuf", "youssef"], ["omar", "umar", "oumar"], ["said", "saeed", "sayed"],
  ["yuri", "yuriy", "yury", "iurii"], ["sergey", "sergei", "serguei", "sergej"],
  ["alexander", "aleksandr", "alexandr", "oleksandr", "alexandre"], ["alexey", "aleksey", "alexei", "aleksei"],
  ["mikhail", "mikhael", "michail", "mihail"], ["dmitry", "dmitri", "dmitriy", "dmitrii"],
  ["vladimir", "wladimir", "vladimer"], ["evgeny", "yevgeny", "evgeniy", "eugene", "yevgeniy"],
  ["andrey", "andrei", "andrej", "andriy"], ["nikolay", "nikolai", "nikolaj", "mykola"],
  ["viktor", "victor", "wiktor"], ["anatoly", "anatoliy", "anatolii"], ["igor", "ihor"],
  ["valery", "valeriy", "valerii"], ["konstantin", "kostiantyn", "konstantyn"],
  ["gennady", "gennadiy", "gennadii"], ["vyacheslav", "viacheslav", "wjatscheslaw"],
  ["zhang", "chang"], ["wei", "wai"], ["li", "lee"], ["hossein", "hosein", "hussein"],
  ["mahmoud", "mahmud", "mahmood"], ["ali", "aly"], ["kamal", "kamel"], ["jamal", "gamal", "jamel"],
  ["tariq", "tarik", "tarek"], ["nasser", "nasir", "naser"], ["rashid", "rasheed", "rasid"],
  ["hamid", "hameed"], ["karim", "kareem"], ["zaid", "zayd", "zeid"], ["sheikh", "shaikh", "shaykh"],
  ["qasim", "kasim", "qassim"], ["mehdi", "mahdi", "mehdy"], ["reza", "riza"], ["ismail", "ismael", "esmail"],
  ["haji", "hajji"], ["sultan", "soltan"], ["hamza", "hamzah"], ["salman", "selman"], ["fatima", "fatma"],
  ["bashar", "bashir"], ["maher", "mahir"], ["suleiman", "sulaiman", "soliman", "sulayman"],
  ["jose", "josé"], ["joao", "joão"], ["goncalves", "gonçalves"], ["antonio", "antônio"]
];
const POR_TOKEN = new Map();
for (const grupo of VARIANTES) for (const t of grupo) POR_TOKEN.set(simples(t), grupo.map(simples));

const tipoOk = (d) => d[4] === "pessoa" || d[4] === "entidade";
const nomesDe = (d) => [d[1]].concat(d[2] || []);

// registros por nome normalizado: mesmo nome em varias listas = todos sao acerto
const porNome = new Map();
base.forEach((d) => {
  for (const n of nomesDe(d)) {
    const k = simples(n);
    if (!k) continue;
    if (!porNome.has(k)) porNome.set(k, new Set());
    porNome.get(k).add(d[0]);
  }
});
const esperados = (nome) => Array.from(porNome.get(simples(nome)) || []);

// erros de digitacao: troca, remocao, insercao, transposicao
function erro(t) {
  const i = 1 + inteiro(Math.max(1, t.length - 2));
  const op = inteiro(4), letras = "abcdefghijklmnopqrstuvwxyz";
  if (op === 0) { const c = pick(letras.split("").filter((x) => x !== t[i])); return t.slice(0, i) + c + t.slice(i + 1); }
  if (op === 1) return t.slice(0, i) + t.slice(i + 1);
  if (op === 2) return t.slice(0, i) + pick(letras.split("")) + t.slice(i);
  if (i + 1 < t.length && t[i] !== t[i + 1]) return t.slice(0, i) + t[i + 1] + t[i] + t.slice(i + 2);
  return t.slice(0, i) + t.slice(i + 1);
}

const consultas = [];
const alvos = new Set();
let n = 0;
function add(cat, q, esp, ctx) {
  const c = { id: ++n, cat: cat, q: q, esp: esp };
  if (ctx) Object.assign(c, ctx);
  consultas.push(c);
  esp.forEach((e) => alvos.add(e));
}

// parse de nascimento estrito (so campo inteiro com uma data completa)
function nascCompleto(x) {
  if (!x || x.length > 40) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x);
  if (m) return { a: +m[1], iso: x, br: m[3] + "/" + m[2] + "/" + m[1] };
  m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(x);
  if (m) {
    const mes = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }[m[2]];
    if (!mes) return null;
    const mm = String(mes).padStart(2, "0"), dd = String(m[1]).padStart(2, "0");
    return { a: +m[3], iso: m[3] + "-" + mm + "-" + dd, br: dd + "/" + mm + "/" + m[3] };
  }
  return null;
}

const pessoas = base.filter((d) => d[4] === "pessoa" && toks(d[1]).length >= 2 && toks(d[1]).length <= 4);
const comTipo = base.filter((d) => tipoOk(d) && toks(d[1]).length >= 2);

// 1. erro de digitacao (uma troca em palavra com 5+ letras)
embaralha(comTipo).filter((d) => toks(d[1]).some((t) => t.length >= 5 && /^[a-z]+$/.test(t))).slice(0, 320).forEach((d) => {
  const t = toks(d[1]);
  const longos = t.map((x, i) => i).filter((i) => t[i].length >= 5 && /^[a-z]+$/.test(t[i]));
  const i = pick(longos), v = t.slice();
  v[i] = erro(v[i]);
  add("digitacao", v.join(" "), esperados(d[1]));
});
// 2. dois erros em palavras diferentes
embaralha(pessoas).filter((d) => toks(d[1]).filter((t) => t.length >= 6 && /^[a-z]+$/.test(t)).length >= 2).slice(0, 120).forEach((d) => {
  const t = toks(d[1]), v = t.slice();
  const longos = t.map((x, i) => i).filter((i) => t[i].length >= 6 && /^[a-z]+$/.test(t[i]));
  const a = longos[0], b = longos[longos.length - 1];
  v[a] = erro(v[a]); v[b] = erro(v[b]);
  add("digitacao2", v.join(" "), esperados(d[1]));
});
// 3. ordem trocada (sobrenome primeiro)
embaralha(pessoas).slice(0, 220).forEach((d) => {
  const t = toks(d[1]);
  const v = t.length === 2 ? [t[1], t[0]] : [t[t.length - 1]].concat(t.slice(0, -1));
  add("ordem", v.join(" "), esperados(d[1]));
});
// 4. transliteracao: troca uma palavra por outra grafia da tabela
embaralha(comTipo).filter((d) => toks(d[1]).some((t) => POR_TOKEN.has(t))).slice(0, 260).forEach((d) => {
  const t = toks(d[1]), v = t.slice();
  const idx = t.map((x, i) => i).filter((i) => POR_TOKEN.has(t[i]));
  const i = pick(idx);
  const alternativas = POR_TOKEN.get(t[i]).filter((x) => x !== t[i]);
  if (!alternativas.length) return;
  v[i] = pick(alternativas);
  add("translit", v.join(" "), esperados(d[1]));
});
// 5. transliteracao com ordem trocada
embaralha(pessoas).filter((d) => toks(d[1]).some((t) => POR_TOKEN.has(t))).slice(0, 80).forEach((d) => {
  const t = toks(d[1]).slice(), i = pick(t.map((x, k) => k).filter((k) => POR_TOKEN.has(t[k])));
  const alt = POR_TOKEN.get(t[i]).filter((x) => x !== t[i]);
  if (!alt.length) return;
  t[i] = pick(alt);
  add("translit+ordem", t.reverse().join(" "), esperados(d[1]));
});
// 6. alias exato
embaralha(base.filter((d) => tipoOk(d) && (d[2] || []).length)).slice(0, 150).forEach((d) => {
  const a = pick(d[2].filter((x) => toks(x).length >= 1 && simples(x).length >= 5));
  if (!a) return;
  add("alias", a, esperados(a));
});
// 7. alfabeto cirilico (alias na base)
embaralha(base.filter((d) => (d[2] || []).some((a) => /[Ѐ-ӿ]/.test(a)))).slice(0, 80).forEach((d) => {
  const a = d[2].find((x) => /[Ѐ-ӿ]/.test(x));
  add("cirilico", a, esperados(a).concat([d[0]]).filter((v, i, arr) => arr.indexOf(v) === i));
});
// 8. ruido de formato: caixa, pontuacao, acento
embaralha(comTipo).slice(0, 120).forEach((d) => {
  const t = d[1].split(/\s+/);
  const q = t.map((x, i) => (i % 2 ? x.toLowerCase() : x[0] + x.slice(1).toLowerCase())).join(", ").replace(/,/g, "") + ".";
  add("formato", q, esperados(d[1]));
});

// 9. negativos: nome montado com palavras de registros diferentes e que nao existe na base
const nomesExistentes = new Set(porNome.keys());
const sobrenomes = pessoas.map((d) => toks(d[1]).slice(-1)[0]).filter((t) => t.length >= 4 && /^[a-z]+$/.test(t));
const primeiros = pessoas.map((d) => toks(d[1])[0]).filter((t) => t.length >= 4 && /^[a-z]+$/.test(t));
let mix = 0, tent = 0;
while (mix < 260 && tent++ < 10000) {
  const q = pick(primeiros) + " " + pick(sobrenomes);
  if (nomesExistentes.has(q)) continue;
  // se algum registro tem as duas palavras exatas, a combinacao e um acerto legitimo
  const [a, b] = q.split(" ");
  if (pessoas.some((d) => { const t = toks(d[1]); return t.includes(a) && t.includes(b); })) continue;
  add("mix-negativo", q, []);
  mix++;
}
// 10. negativos brasileiros: nomes comuns que nao devem acender listas internacionais
const comuns = ["joao da silva", "maria aparecida souza", "jose carlos pereira", "ana paula oliveira", "antonio carlos santos",
  "francisco de assis lima", "pedro henrique costa", "luiz fernando almeida", "marcos vinicius rocha", "carlos eduardo ribeiro",
  "paulo roberto gomes", "fernanda cristina martins", "juliana alves ferreira", "rafael augusto barbosa", "lucas gabriel carvalho",
  "patricia regina nunes", "roberto carlos dias", "sandra maria teixeira", "marcelo henrique araujo", "adriana lopes moreira"];
comuns.forEach((q) => add("comum-negativo", q, esperados(q)));

// 11. homonimos com contexto: mesmo nome, outro nascimento
const unicos = embaralha(pessoas.filter((d) => nascCompleto(d[9]) && esperados(d[1]).length === 1));
unicos.slice(0, 160).forEach((d) => {
  const nasc = nascCompleto(d[9]);
  add("nasc-confere", d[1], [d[0]], { nasc: nasc.br });
});
unicos.slice(160, 340).forEach((d) => {
  const nasc = nascCompleto(d[9]);
  const outro = nasc.a + (5 + inteiro(25)) * (inteiro(2) ? 1 : -1);
  add("nasc-diverge", d[1], [], { nasc: "15/06/" + outro });
});
// 12. mesmo nome, pais diferente
unicos.slice(340).filter((d) => d[6] && !d[6].includes(",")).slice(0, 140).forEach((d) => {
  const outro = pick(["Brazil", "Japan", "Portugal", "Argentina", "Canada"].filter((p) => simples(p) !== simples(d[6])));
  add("pais-diverge", d[1], [], { pais: outro });
});
// 13. documentos brasileiros: CPF completo, mascarado e errado
const comCpf = base.filter((d) => d[4] === "pessoa" && (d[10] || []).some((x) => /^CPF:/.test(x)));
const cpfDe = (d) => d[10].find((x) => /^CPF:/.test(x)).replace(/^CPF:\s*/, "");
const cpfs = embaralha(comCpf);
cpfs.slice(0, 80).forEach((d) => add("cpf-completo", "", [d[0]], { doc: cpfDe(d) }));
cpfs.slice(80, 160).forEach((d) => {
  const c = cpfDe(d).replace(/\D/g, "");
  add("cpf-mascarado", d[1], [d[0]], { doc: "***." + c.slice(3, 6) + "." + c.slice(6, 9) + "-**" });
});
const cpfsNaBase = new Set();
base.forEach((d) => (d[10] || []).forEach((x) => cpfsNaBase.add(String(x).replace(/\D/g, ""))));
function cpfValido(r) {
  for (;;) {
    const d = []; for (let i = 0; i < 9; i++) d.push(inteiro(10));
    for (let t = 9; t < 11; t++) { let s = 0; for (let i = 0; i < t; i++) s += d[i] * (t + 1 - i); let v = (s * 10) % 11; if (v === 10) v = 0; d.push(v); }
    const c = d.join("");
    if (!/^(\d)\1+$/.test(c) && !cpfsNaBase.has(c)) return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
}
cpfs.slice(160, 240).forEach((d) => {
  // nome certo, CPF valido que nao consta em nenhuma lista: nao e a mesma pessoa
  add("cpf-diverge", d[1], [], { doc: cpfValido() });
});
// 14. CPF com digito verificador invalido: a consulta nao pode confirmar ninguem
cpfs.slice(240, 280).forEach((d) => {
  const c = cpfDe(d).replace(/\D/g, "");
  const dv = (Number(c[10]) + 1) % 10;
  add("cpf-dv-invalido", "", [], { doc: c.slice(0, 10) + dv, dvInvalido: true });
});

// corpus: alvos + distratores (amostra fixa, para a densidade parecer com a base real)
const porId = new Map(base.map((d) => [d[0], d]));
const registros = [];
const usados = new Set();
alvos.forEach((id) => { if (porId.has(id)) { registros.push(porId.get(id)); usados.add(id); } });
const alvoFonte = {};
registros.forEach((d) => { alvoFonte[d[3]] = (alvoFonte[d[3]] || 0) + 1; });
for (const d of embaralha(base)) {
  if (registros.length >= 9000) break;
  if (usados.has(d[0])) continue;
  registros.push(d); usados.add(d[0]);
}
// o mix-negativo pode ter acertos legitimos nos distratores: esperados vazios continuam validos
// porque a checagem acima rodou sobre a base inteira.
fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida, JSON.stringify({
  versao: 1, semente: 20261106, gerado_de: "indice com " + base.length + " registros",
  contagem: consultas.reduce((a, c) => { a[c.cat] = (a[c.cat] || 0) + 1; return a; }, {}),
  registros: registros.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1)), consultas: consultas
}));
const kb = Math.round(fs.statSync(saida).size / 1024);
console.log("benchmark.json: " + consultas.length + " consultas, " + registros.length + " registros, " + kb + " KB");
console.log(JSON.stringify(consultas.reduce((a, c) => { a[c.cat] = (a[c.cat] || 0) + 1; return a; }, {})));
