# Puente de WhatsApp por QR + cerebro (MDFK CRM)

Servicio aparte que guarda la sesión web de WhatsApp (Baileys, del kit de
agente de WhatsApp) y se la presta al CRM. Spec: `specs/080-whatsapp-qr/spec.md`.

## Desplegar en Easypanel

1. En el proyecto del CRM: **+ Servicio → App**, nombre `puente`.
2. Fuente GitHub: el mismo repo, rama `main`, **Ruta de compilación `/puente-qr`**. Compilación: Dockerfile.
3. Entorno:
   ```
   BOT_API_KEY=<la misma del CRM>
   CRM_URL=http://<proyecto>_crm:3000
   ```
4. Almacenamiento: volumen `puente-data` en `/data` (ahí vive la sesión).
5. **Sin dominio**: solo lo usa el CRM por la red interna.
6. En el CRM: `CHANNELS=whatsapp,whatsapp_qr` y
   `WA_QR_BRIDGE_URL=http://<proyecto>_puente:3001`. Para que la IA conteste
   (el cerebro vive aquí mismo):
   `BRAIN_DISPATCH_URL=http://<proyecto>_puente:3001/cerebro/despacho` y
   `BRAIN_HEALTH_URL=http://<proyecto>_puente:3001/health`. Implementar.
7. Ajustes → WhatsApp (QR) → «Mostrar código QR» y escanéalo.

## Desarrollo

```bash
npm install
npm test        # lo puro: identidad, contenido de cada mensaje
npm run typecheck
BOT_API_KEY=... CRM_URL=http://localhost:3000 npm start
```
