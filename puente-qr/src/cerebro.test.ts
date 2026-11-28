import { test } from "node:test";
import assert from "node:assert/strict";
import { cifrasDeDinero, dominiosDe, normalizarCifra, permitidosDe, revisarSalida } from "./cerebro/guardas.ts";
import { dividirMensajes, saneaHumano } from "./cerebro/humanizar.ts";
import { firmaValida } from "./cerebro/index.ts";
import { textoDelMensaje } from "./cerebro/turno.ts";
import { createHmac } from "node:crypto";

const negocio = `Consulta: S/ 60. Baño perro pequeño: S/ 45, mediano: 60 soles. Corte desde S/ 1,250.00.
Reserva en https://lolitapet.pe/reservar o en maps.app.goo.gl/abc`;

test("cifras de dinero: S/, soles, miles y decimales", () => {
  assert.deepEqual(cifrasDeDinero("El baño cuesta S/ 45 y la consulta 60 soles"), ["45", "60"]);
  assert.equal(normalizarCifra("1,250.00"), "1250");
  assert.equal(normalizarCifra("1.250,50"), "1250.5");
  assert.deepEqual(cifrasDeDinero("Tenemos 3 horarios y 2 sedes"), []);
});

test("solo pasan las cifras y enlaces que el negocio guardó", () => {
  const p = permitidosDe(negocio);
  assert.equal(revisarSalida("El baño de tu perrito mediano es S/ 60 🐶", p).ok, true);
  assert.equal(revisarSalida("Reserva aquí: https://lolitapet.pe/reservar", p).ok, true);
  assert.equal(revisarSalida("El corte sale S/ 1250", p).ok, true);
  const caro = revisarSalida("El baño está en oferta a S/ 39", p);
  assert.equal(caro.ok, false);
  assert.equal(revisarSalida("Mira https://otra-tienda.com", p).ok, false);
  // «Sr.Juan» no es un enlace.
  assert.equal(revisarSalida("Hola Sr.Juan, ¿cómo está?", p).ok, true);
  assert.deepEqual(dominiosDe("escríbenos a ventas@lolitapet.pe"), ["lolitapet.pe"]);
});

test("humanizar: sin símbolos de bot, emojis intactos, partido en mensajes", () => {
  assert.equal(saneaHumano("**Claro** — te ayudo… 🐶"), "*Claro*, te ayudo... 🐶");
  assert.deepEqual(dividirMensajes("Hola ||| ¿Para cuándo? |||"), ["Hola", "¿Para cuándo?"]);
  assert.equal(dividirMensajes("a|||b|||c|||d|||e|||f").length, 4);
});

test("firma del despacho: HMAC del cuerpo crudo con la BOT_API_KEY", () => {
  process.env.BOT_API_KEY = "clave-de-prueba-1234567890";
  const cuerpo = '{"dispatchId":"d1"}';
  const firma = `sha256=${createHmac("sha256", process.env.BOT_API_KEY).update(cuerpo).digest("hex")}`;
  assert.equal(firmaValida(cuerpo, firma), true);
  assert.equal(firmaValida(cuerpo + " ", firma), false);
  assert.equal(firmaValida(cuerpo, undefined), false);
});

test("lo que no es texto llega al modelo explicado", () => {
  assert.match(textoDelMensaje({ id: "1", type: "audio", text: null }), /nota de voz/);
  assert.match(textoDelMensaje({ id: "1", type: "image", text: null, caption: "mi perro" }), /mi perro/);
  assert.equal(textoDelMensaje({ id: "1", type: "text", text: " hola " }), "hola");
});
