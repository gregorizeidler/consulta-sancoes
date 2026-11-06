/* Web Worker: carrega o indice, monta o indice invertido e responde as buscas fora da thread da tela. */
"use strict";
importScripts("motor.js");
var servidor = Motor.servidor();

self.onmessage = function (e) {
  var m = e.data || {};
  Motor.despacha(servidor, m.tipo, m.args).then(
    function (valor) { self.postMessage({ id: m.id, ok: true, valor: valor }); },
    function (erro) { self.postMessage({ id: m.id, ok: false, erro: String(erro && erro.message || erro) }); }
  );
};
self.postMessage({ pronto: true });
