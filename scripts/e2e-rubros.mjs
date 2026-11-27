/**
 * Self-test E2E — MDFK: plantillas por rubro (Agente → «Plantilla por rubro»).
 *
 * Requiere la app viva con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock
 * y OPENROUTER_BASE_URL → ai-mock (la IA de «Otros» contesta un gimnasio).
 *
 * Uso: node --env-file=<env> scripts/e2e-rubros.mjs
 * Sale con 1 si algún check falla. Las capturas van a .tmp/.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "e2e-rubros@mdfk.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "password-e2e-rubros";
const S = Date.now().toString(36);
const PN = `PN-RUB-${S}`;

let failures = 0;
function ok(name, cond, extra = "") {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FALLA  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(".tmp", { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const req = ctx.request;
const api = (p, init = {}) =>
  req.fetch(`${BASE}${p}`, { ...init, headers: { origin: BASE, ...(init.headers ?? {}) } });
const etapas = async () =>
  ((await (await api("/api/pipeline/stages")).json()).stages ?? []).map((s) => s.name);
const kb = async () => (await (await api("/api/kb")).json()).entries ?? [];
const perfil = async () => (await (await api("/api/agent/profile")).json()).profile;

try {
  console.log("== Preparación ==");
  let r = await api("/api/auth/sign-up/email", { method: "POST", data: { email: EMAIL, password: PASSWORD, name: "Dueño" } });
  if (!r.ok()) r = await api("/api/auth/sign-in/email", { method: "POST", data: { email: EMAIL, password: PASSWORD } });
  ok("login", r.ok());

  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("dialog", (d) => void d.accept());

  console.log("\n== Tienda online desde la pantalla ==");
  await page.goto(`${BASE}/agent`);
  await page.getByText("Plantilla por rubro").waitFor();
  await page.getByRole("radio", { name: /Tienda online/ }).click();
  await page.getByText("Pedido armado").first().waitFor();
  await page.screenshot({ path: ".tmp/rubros-1-tienda-vista.png", fullPage: false });
  await page.getByRole("button", { name: "Aplicar plantilla" }).click();
  await page.getByRole("status").filter({ hasText: "Plantilla aplicada" }).waitFor();
  ok("aviso de aplicada con etapas actualizadas", (await page.getByRole("status").filter({ hasText: "Plantilla aplicada" }).innerText()).includes("Etapas del pipeline actualizadas"));
  const e1 = await etapas();
  ok("pipeline de tienda", JSON.stringify(e1) === JSON.stringify(["Nuevo", "Consultando", "Pedido armado", "Pago pendiente", "Enviado", "Entregado", "No compró"]), JSON.stringify(e1));
  const p1 = await perfil();
  ok("agente de tienda", p1.name === "Asistente de ventas" && p1.instructions.includes("[COMPLETAR"));
  const k1 = await kb();
  ok("8 preguntas en el conocimiento", k1.length === 8, String(k1.length));
  const qr = (await (await api("/api/quick-replies")).json()).respuestas ?? [];
  ok("respuestas rápidas /pago y /pedido", ["pago", "pedido"].every((a) => qr.some((q) => q.atajo === a)), JSON.stringify(qr.map((q) => q.atajo)));

  console.log("\n== Aplicarla dos veces no duplica ==");
  r = await api("/api/agent/rubro", { method: "POST", data: { rubro: "tienda-online" } });
  const d2 = await r.json();
  ok("0 preguntas y 0 respuestas nuevas", d2.conocimientoAgregado === 0 && d2.respuestasAgregadas === 0, JSON.stringify(d2));
  ok("el conocimiento sigue con 8", (await kb()).length === 8);

  console.log("\n== «Otros» con IA ==");
  await page.reload();
  await page.getByRole("radio", { name: /Otros/ }).click();
  const generar = page.getByRole("button", { name: "Generar con IA" });
  ok("sin descripción no se puede generar", await generar.isDisabled());
  await page.getByLabel("Describe tu negocio").fill("Gimnasio en Miraflores con clases de funcional y spinning");
  await generar.click();
  await page.getByText("Clase de prueba agendada").first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: ".tmp/rubros-2-otros-generada.png", fullPage: false });
  await page.getByRole("button", { name: "Aplicar plantilla" }).click();
  await page.getByRole("status").filter({ hasText: "Plantilla aplicada" }).waitFor();
  const e2 = await etapas();
  ok("pipeline del gimnasio", JSON.stringify(e2) === JSON.stringify(["Nuevo", "Clase de prueba agendada", "Probó la clase", "Membresía activa", "No se inscribió"]), JSON.stringify(e2));
  const p2 = await perfil();
  ok("agente del gimnasio, con la regla de [COMPLETAR] agregada", p2.name === "Coach virtual" && p2.instructions.includes("[COMPLETAR"));
  ok("conocimiento sumado (8 + 2)", (await kb()).length === 10);

  console.log("\n== Con leads, las etapas no se tocan ==");
  await api("/api/settings/whatsapp", { method: "PUT", data: { wabaId: "WABA-RUB", phoneNumberId: PN, token: "tok-rub" } });
  await api("/api/dev/wa-mock/inbound", { method: "POST", data: { phoneNumberId: PN, from: `51987${Math.floor(100000 + Math.random() * 899999)}`, name: `Cliente ${S}`, text: "Hola" } });
  for (let i = 0; i < 40; i++) {
    const board = await (await api("/api/pipeline/board")).json().catch(() => ({}));
    if (JSON.stringify(board).includes(`Cliente ${S}`)) break;
    await espera(250);
  }
  r = await api("/api/agent/rubro", { method: "POST", data: { rubro: "comida" } });
  const d3 = await r.json();
  ok("etapas conservadas", d3.etapas === "conservadas", JSON.stringify(d3));
  const e3 = await etapas();
  ok("abiertas iguales; ganada/perdida renombradas", JSON.stringify(e3) === JSON.stringify(["Nuevo", "Clase de prueba agendada", "Probó la clase", "Entregado", "Cancelado"]), JSON.stringify(e3));
  ok("el agente sí cambió", (await perfil()).name === "Asistente de pedidos");

  console.log("\n== Camino infeliz ==");
  r = await api("/api/agent/rubro", { method: "POST", data: { rubro: "no-existe" } });
  ok("rubro desconocido → 4xx", r.status() >= 400 && r.status() < 500, String(r.status()));
  r = await api("/api/agent/rubro/generar", { method: "POST", data: { descripcion: "corto" } });
  ok("descripción muy corta → 4xx", r.status() >= 400 && r.status() < 500, String(r.status()));
  r = await api("/api/agent/rubro", { method: "POST", data: { plantilla: { agente: {} } } });
  ok("plantilla mal formada → 4xx", r.status() >= 400 && r.status() < 500, String(r.status()));

  await page.reload();
  await page.getByRole("radio", { name: /Centro odontológico/ }).click();
  await page.getByText("Cita agendada").first().waitFor();
  await page.screenshot({ path: ".tmp/rubros-3-odontologia.png", fullPage: false });
  ok("sin errores de JS en la página", errores.length === 0, errores.join(" | "));
} catch (err) {
  failures++;
  console.log(`  FALLA  excepción: ${err?.stack ?? err}`);
} finally {
  await browser.close();
}
console.log(failures === 0 ? "\nTodo verde." : `\n${failures} fallas.`);
process.exit(failures === 0 ? 0 : 1);
