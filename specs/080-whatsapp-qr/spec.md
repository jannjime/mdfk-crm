# 080 — WhatsApp por QR (puente)

**Estado**: implementado (fase 1) · **Fecha**: 2026-11-27 · **Bandera**: `whatsapp_qr` en `CHANNELS`

## El problema

Conectar un número por la API oficial exige app de Meta, verificación y un
número que no esté en la app del teléfono. Para un negocio pequeño (y para la
agencia que lo instala) lo que funciona hoy es escanear un QR, como WhatsApp
Web. El dueño pidió poder conectar así, y que el kit de agente de WhatsApp
(Baileys) se fusione con el CRM.

## La decisión

Un **conector opcional** (constitución II.3), no un cambio del núcleo:

- La sesión web vive en un **puente aparte** (`puente-qr/`, su propio
  contenedor, en la red interna, sin dominio público). Baileys no entra al
  proceso del CRM ni a su imagen.
- El CRM gana el canal `whatsapp_qr`, apagado por defecto. Con él apagado,
  `/api/webhooks/qr`, `/api/settings/whatsapp-qr` y la pantalla responden 404.
- El puente se autentica con la misma `BOT_API_KEY` que el cerebro; la sesión
  de WhatsApp nunca pasa por el CRM (no hay secreto nuevo que cifrar).
- Entrada: el puente avisa `mensaje`, `eco` (lo que el negocio escribió desde
  el teléfono: saliente manual que pausa la IA) y `estado`. Todo pasa por el
  mismo `recibirEvento` (047): guardado antes de procesar, reintento, dedup.
- Salida: texto por `POST /enviar` del puente. Sin ventana de 24 h ni
  plantillas. Adjuntos de salida, ubicaciones y citas: fuera de esta entrega.
- Para el cerebro, el canal es `whatsapp` (`canalDelEvento`): el contrato no
  gana un valor nuevo.
- Identidad: `qr:<número>`, en su propio espacio; el contacto guarda `phone`.

## Contrato del puente

`GET /health` (sin llave) · `GET /estado` · `POST /conectar {sesion}` ·
`POST /desconectar` · `POST /enviar {to,text}` → `{id}` ·
`POST /escribiendo {to}` · `GET /media/:id`. Todo con `X-API-Key`.

## Riesgos asumidos

- No es la API oficial: WhatsApp puede bloquear números que hacen envíos
  masivos. La pantalla lo dice antes de conectar.
- Si se pierde el volumen del puente, hay que volver a escanear.

## Verificación

- Unitarias: `tests/unit/whatsapp-qr.test.ts`, `webhook-eventos.test.ts`;
  `puente-qr/src/mensajes.test.ts`.
- De punta a punta (local, Postgres real + puente real + puente simulado):
  QR real generado y mostrado en Ajustes; mensaje entrante → contacto, lead en
  «Nuevo» y Bandeja con distintivo; reentrega sin duplicar; envío desde la
  Bandeja sale por el puente; eco del propio envío no duplica; eco escrito en
  el teléfono queda como manual y pausa la IA; foto entrante copiada al volumen.

## Fase 2

El agente del kit como cerebro (despacho + `/api/bot/*`), con su guion,
filtros de precios/enlaces y respuestas humanizadas, para todos los canales.
