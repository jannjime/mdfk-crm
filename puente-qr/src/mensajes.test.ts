import { test } from "node:test";
import assert from "node:assert/strict";
import {
  esChatDirecto,
  extraerContenido,
  idDeArchivoSeguro,
  numeroCanonico,
  numeroValido,
  segundos,
} from "./mensajes.ts";

test("solo chats uno a uno", () => {
  assert.equal(esChatDirecto("51987654321@s.whatsapp.net"), true);
  assert.equal(esChatDirecto("123456789@lid"), true);
  assert.equal(esChatDirecto("120363@g.us"), false);
  assert.equal(esChatDirecto("status@broadcast"), false);
  assert.equal(esChatDirecto("123@newsletter"), false);
  assert.equal(esChatDirecto(null), false);
});

test("el número real de un @lid sale de senderPn", () => {
  assert.equal(numeroCanonico("51987654321@s.whatsapp.net"), "51987654321");
  assert.equal(numeroCanonico("51987654321:12@s.whatsapp.net"), "51987654321");
  assert.equal(numeroCanonico("987@lid", "51987654321@s.whatsapp.net"), "51987654321");
  assert.equal(numeroCanonico("987@lid"), "987");
});

test("texto, adjuntos con su pie y envoltorios", () => {
  assert.deepEqual(extraerContenido({ conversation: "hola" }), {
    tipo: "text", texto: "hola", conArchivo: false, mime: null, nombreArchivo: null,
  });
  assert.equal(extraerContenido({ extendedTextMessage: { text: "link" } })?.texto, "link");
  const foto = extraerContenido({ imageMessage: { caption: "mira", mimetype: "image/jpeg" } });
  assert.deepEqual(foto, { tipo: "image", texto: "mira", conArchivo: true, mime: "image/jpeg", nombreArchivo: null });
  const audio = extraerContenido({ ephemeralMessage: { message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } } } });
  assert.equal(audio?.tipo, "audio");
  assert.equal(audio?.mime, "audio/ogg");
  const doc = extraerContenido({ documentWithCaptionMessage: { message: { documentMessage: { fileName: "cotizacion.pdf", caption: "ahí va" } } } });
  assert.equal(doc?.nombreArchivo, "cotizacion.pdf");
  assert.equal(extraerContenido({ reactionMessage: { text: "👍" } }), null);
  assert.equal(extraerContenido({ conversation: "   " }), null);
  assert.equal(extraerContenido(null), null);
});

test("utilidades", () => {
  assert.equal(segundos(1_790_000_000), 1_790_000_000);
  assert.equal(segundos({ toNumber: () => 42 }), 42);
  assert.equal(numeroValido("+51 987 654 321"), "51987654321");
  assert.equal(numeroValido("123"), null);
  assert.equal(numeroValido(51987654321), null);
  assert.equal(idDeArchivoSeguro("3EB0ABC123"), "3EB0ABC123");
  assert.equal(idDeArchivoSeguro("../../etc/passwd"), null);
});
