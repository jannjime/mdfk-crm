# 081 — Recordatorios de citas + el cerebro agenda

**Estado**: implementado · **Fecha**: 2026-11-28 · **Bandera**: `AGENDA=on`

## El problema

Un negocio de sesiones (cámara hiperbárica) necesita que las citas no se
crucen, verlas en un calendario y avisarle al cliente antes. La agenda (015)
ya resuelve horarios, huecos sin cruces, bloqueos y el calendario; faltaban
los recordatorios (la edición cloud los tiene, la raíz no) y que el cerebro
del kit supiera agendar.

## Recordatorios

- Ajustes → Agenda → «Recordatorios de citas»: hasta 4 reglas, cada una con
  su antelación (30 min… 2 días) y su texto, con `{nombre}`, `{fecha}`,
  `{hora}`, `{negocio}`, `{enlace}` y vista previa. De fábrica: uno, 2 horas
  antes. Interruptor para apagarlos.
- Proceso en segundo plano cada minuto (solo con `AGENDA=on`). Salen por la
  conversación del cliente (cualquier canal). UNA vez: se reclama con un
  INSERT sobre la llave única (cita, antelación) antes de enviar.
- No sale si la cita ya empezó, o si se agendó después de la hora del
  recordatorio (agendar a las 3 para las 4 no dispara el de «2 horas antes»).
- Con la API oficial de WhatsApp fuera de la ventana de 24 h, queda
  `fallido` con el motivo (Meta exige plantilla); por QR sale siempre.
- Tablas: `reminder_settings` (reglas por organización) y `booking_reminder`
  (bitácora). Migración 0034.

## El cerebro agenda

Herramientas nuevas en `puente-qr/src/cerebro`: `ver_horarios` (siempre antes
de ofrecer una hora), `agendar_cita` (con el `startUtc` de un hueco ofrecido) y
`mover_cita`. Un 409 (el hueco se ocupó) le hace volver a consultar. El
contexto de la cita (próxima, sin cerrar, última cerrada) entra al prompt.

## Verificado

Unitarias (`tests/unit/recordatorios.test.ts`) y de punta a punta en local:
el cliente pide cita → el cerebro consulta huecos y reserva (`source=ai`); una
cita a 90 min creada ayer dispara el recordatorio de 2 h en la siguiente
pasada, una sola vez; el calendario la muestra.
