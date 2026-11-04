/* Vigilância fora do navegador: cruza a lista de nomes do vigilancia.json com a base
   do dia e com o que entrou nas últimas 24h. Roda no GitHub Action, todo dia.
   Uso: node src/vigilancia.js */
const fs = require("fs");
const path = require("path");
const M = require("../site/motor.js");

const ROOT = path.join(__dirname, "..");
const LIMIAR = 85;

function le(caminho, padrao) {
  try { return JSON.parse(fs.readFileSync(caminho, "utf8")); } catch (e) { return padrao; }
}

const config = le(path.join(ROOT, "vigilancia.json"), { nomes: [] });
const nomes = (config.nomes || []).filter(function (n) { return n && String(n).trim().length >= 3; });
const dados = le(path.join(ROOT, "docs", "dados", "indice.json"), []);
const resumo = le(path.join(ROOT, "data", "resumo.json"), {});
M.prepara(dados);

const alertas = nomes.map(function (vigiado) {
  const q = M.norm(vigiado);
  const achados = [];
  M.candidatos(dados, q, { fonte: "todas", tipo: "todos" }, 400).forEach(function (par) {
    const d = par[1];
    const s = M.melhorSim(q, d.__n, d.__aliases);
    if (s >= LIMIAR) achados.push({ id: d[0], nome: d[1], fonte: d[3], tipo: d[4], score: s, link: d[8], detalhe: d[9] || "" });
  });
  achados.sort(function (a, b) { return b.score - a.score; });
  const novos = (resumo.novos || []).filter(function (n) { return M.melhorSim(q, M.norm(n.n), []) >= LIMIAR; });
  return { vigiado: vigiado, total: achados.length, melhor: achados[0] || null, achados: achados.slice(0, 5), novos_hoje: novos.length };
});

const saida = {
  gerado_em: resumo.gerado_em || "",
  base_total: dados.length,
  limiar: LIMIAR,
  vigiados: nomes.length,
  com_alerta: alertas.filter(function (a) { return a.total > 0; }).length,
  alertas: alertas
};

const texto = JSON.stringify(saida, null, 1);
fs.writeFileSync(path.join(ROOT, "data", "vigilancia-alertas.json"), texto);
const destino = path.join(ROOT, "docs", "dados");
if (fs.existsSync(destino)) fs.writeFileSync(path.join(destino, "vigilancia-alertas.json"), texto);

console.log("vigilancia: " + nomes.length + " nome(s), " + saida.com_alerta + " com correspondencia");
alertas.forEach(function (a) {
  if (a.total) console.log("  ALERTA " + a.vigiado + " -> " + a.melhor.nome + " (" + a.melhor.score + "%)");
});
