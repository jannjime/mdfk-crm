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

## Fase 2 (implementada)

**El cerebro** vive en el mismo servicio del puente (`puente-qr/src/cerebro/`):
`BRAIN_DISPATCH_URL=http://<proyecto>_puente:3001/cerebro/despacho` y
`BRAIN_HEALTH_URL=http://<proyecto>_puente:3001/health`. Contesta en todos los
canales (WhatsApp API o QR, Instagram, Messenger) por el contrato de siempre:
firma HMAC, memoria propia por conversación, piensa por `/api/bot/llm` (la
llave de IA no sale del CRM), herramientas `guardar_datos_cliente`,
`mover_etapa` y `pasar_a_persona`, `dispatch_superado`. Del kit trae la
humanización (mensajes cortos partidos con `|||`, sin símbolos de bot) y los
filtros de salida: una cifra de dinero o un enlace que no esté en el perfil o
el conocimiento del negocio bloquea la respuesta, se reescribe una vez y, si
vuelve a fallar, sale un respaldo y la conversación pasa a una persona.

**La entrevista** (`/agent/entrevista`): las 9 preguntas de «/personaliza»
del kit, una por pantalla. La IA arma la plantilla con los datos REALES
(precios, enlaces, nombre del agente), el dueño la revisa y se aplica con
`POST /api/agent/rubro`. Entradas: la guía de inicio (con la IA vinculada),
la pantalla Agente y Ajustes → WhatsApp (QR) al conectar.

**Coexistencia**: botón «Tomar chat / Devolver a la IA» en la cabecera de la
conversación. Contestar desde el teléfono pausa la IA sola (eco).

**Corrección `@lid`**: lo que el negocio escribía desde el teléfono a un chat
`@lid` llegaba sin número y abría un contacto nuevo. El puente aprende y
guarda el par `@lid` ↔ número (mensajes con `senderPn`, contactos), el CRM
guarda el `@lid` en `contact.wa_user_id` (`lid:<id>`) y asigna el eco por él;
un eco a un `@lid` desconocido se descarta en vez de inventar un contacto. Las
respuestas salen por el `@lid` del contacto. WhatsApp por QR no tiene
ventana: el compositor dice «Sin límite de ventana».

Verificado de punta a punta en local (CRM + cerebro + IA simulada + puente
simulado): respuesta partida en dos mensajes marcados IA, ficha guardada por
herramienta, precio inventado (S/ 39) bloqueado y reescrito con el real
(S/ 60); entrevista completa en el navegador → plantilla revisada y guardada.
