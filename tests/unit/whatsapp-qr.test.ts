import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ WA_QR_BRIDGE_URL: "http://mdfk_puente:3001/" }),
}));

import {
  identidadQr,
  normalizarEventoQr,
  normalizarMensajeQr,
} from "@/server/whatsapp-qr/ingest";
import { esDelPuente, leerEstado, urlDeAdjunto, urlDelPuente } from "@/server/whatsapp-qr/puente";
import { estadoDeFila } from "@/server/whatsapp-qr/conexion";
import { canalDelEvento } from "@/server/brains/contract";
import { capabilitiesFor, windowMsFor } from "@/server/channels/capabilities";
import { parseChannels } from "@/server/channels/enabled";
import { parseIdentity } from "@/server/inbox/identity";

const base = {
  sesion: "org_1",
  tipo: "mensaje" as const,
  mensaje: { id: "ABC", numero: "51 987 654 321", nombre: " Ana ", timestamp: 1_790_000_000, tipo: "text", texto: "Hola" },
};

describe("080 — WhatsApp por QR: eventos del puente", () => {
  it("acepta un mensaje y lo normaliza al núcleo", () => {
    const evt = normalizarEventoQr(base);
    expect(evt?.tipo).toBe("mensaje");
    const m = normalizarMensajeQr(evt as never)!;
    expect(m).toMatchObject({ id: "ABC", phone: "51987654321", profileName: "Ana", type: "text", text: "Hola", timestamp: "1790000000" });
    expect(identidadQr(m)).toEqual({
      identity: "qr:51987654321",
      channel: "whatsapp_qr",
      phone: "51987654321",
      waUserId: null,
      profileName: "Ana",
    });
  });

  it("descarta lo que no es del puente o no trae nada que guardar", () => {
    expect(normalizarEventoQr({ tipo: "mensaje" })).toBeNull();
    expect(normalizarEventoQr({ object: "whatsapp_business_account" })).toBeNull();
    const vacio = normalizarEventoQr({ ...base, mensaje: { ...base.mensaje, texto: "   " } });
    expect(normalizarMensajeQr(vacio as never)).toBeNull();
    const sinNumero = normalizarEventoQr({ ...base, mensaje: { ...base.mensaje, numero: "abc-de" } });
    expect(sinNumero && normalizarMensajeQr(sinNumero as never)).toBeNull();
  });

  it("un adjunto conserva su tipo y su pie; un tipo raro se guarda como texto", () => {
    const foto = normalizarEventoQr({
      ...base,
      mensaje: { ...base.mensaje, tipo: "image", texto: "mira", adjunto: { id: "m1", mime: "image/jpeg" } },
    });
    expect(normalizarMensajeQr(foto as never)).toMatchObject({ type: "image", text: "mira", adjunto: { id: "m1", mime: "image/jpeg", nombre: null } });
    const raro = normalizarEventoQr({ ...base, mensaje: { ...base.mensaje, tipo: "poll" } });
    expect(normalizarMensajeQr(raro as never)?.type).toBe("text");
    // Una imagen que no llegó, con su texto: queda el texto.
    const sinArchivo = normalizarEventoQr({ ...base, mensaje: { ...base.mensaje, tipo: "image" } });
    expect(normalizarMensajeQr(sinArchivo as never)).toMatchObject({ type: "text", adjunto: null });
  });

  it("los estados del puente se leen sin fiarse de su forma", () => {
    expect(normalizarEventoQr({ sesion: "org_1", tipo: "estado", estado: { status: "conectado", phone: "51999" } })?.tipo).toBe("estado");
    expect(leerEstado({ status: "qr", qr: "data:image/png;base64,AAA" }).qr).toBe("data:image/png;base64,AAA");
    // Nunca una URL externa como QR, ni un QR fuera del estado «qr».
    expect(leerEstado({ status: "qr", qr: "https://evil.example/q.png" }).qr).toBeNull();
    expect(leerEstado({ status: "conectado", qr: "data:image/png;base64,AAA", phone: "+51 999" })).toMatchObject({ qr: null, phone: "51999" });
    expect(leerEstado("basura").status).toBe("desconectado");
    expect(estadoDeFila("qr")).toBe("esperando_qr");
    expect(estadoDeFila("conectando")).toBe("esperando_qr");
    expect(estadoDeFila("conectado")).toBe("conectado");
  });
});

describe("080 — WhatsApp por QR: el canal", () => {
  it("el puente se reconoce por su origen y nada más", () => {
    expect(urlDelPuente()).toBe("http://mdfk_puente:3001");
    expect(urlDeAdjunto("a b")).toBe("http://mdfk_puente:3001/media/a%20b");
    expect(esDelPuente("http://mdfk_puente:3001/media/x")).toBe(true);
    expect(esDelPuente("http://169.254.169.254/latest")).toBe(false);
  });

  it("sin ventana ni plantillas, formato de WhatsApp, y el cerebro lo ve como WhatsApp", () => {
    const caps = capabilitiesFor("whatsapp_qr");
    expect(caps.windowMs).toBeNull();
    expect(windowMsFor("whatsapp_qr")).toBe(Number.POSITIVE_INFINITY);
    expect(caps.textFormat).toBe("whatsapp");
    expect(caps.outboundMedia).toBe(false);
    expect(canalDelEvento("whatsapp_qr")).toBe("whatsapp");
    expect(canalDelEvento("instagram")).toBe("instagram");
  });

  it("se enciende solo con CHANNELS, y su identidad no se confunde con un teléfono de la API", () => {
    expect(parseChannels(undefined).has("whatsapp_qr")).toBe(false);
    expect(parseChannels("whatsapp,whatsapp_qr").has("whatsapp_qr")).toBe(true);
    expect(parseIdentity("qr:51987654321")).toBeNull();
  });
});
