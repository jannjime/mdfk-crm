/**
 * Los filtros de salida del kit (guardrails), alimentados por el CRM.
 *
 * En el kit las listas de precios y enlaces permitidos se escribían a mano en
 * `.env.local`. Aquí salen solas de lo que el negocio guardó en el CRM
 * (instrucciones, saludo, conocimiento y recursos): toda cifra que aparezca
 * ahí se puede decir; cualquier otra cifra de dinero bloquea la respuesta. Lo
 * mismo con los enlaces: solo dominios que aparezcan en esos textos.
 */

export type Permitidos = { cifras: Set<string>; dominios: Set<string> };

/** Normaliza una cifra: sin separadores de miles, sin ceros decimales sobrantes. */
export function normalizarCifra(raw: string): string | null {
  let s = raw.replace(/\s/g, "");
  // 1,250.50 / 1.250,50 / 1250 / 1250.00
  if (/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(s)) {
    const dec = /[.,](\d{1,2})$/.exec(s);
    const entero = (dec ? s.slice(0, -dec[0].length) : s).replace(/[.,]/g, "");
    s = dec ? `${entero}.${dec[1]}` : entero;
  } else {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return String(Math.round(n * 100) / 100);
}

const CIFRA = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const MONEDA_ANTES = new RegExp(String.raw`(?:S\/\.?|s\/\.?|US\$|\$|USD|PEN|€)\s?(${CIFRA})`, "g");
const MONEDA_DESPUES = new RegExp(String.raw`(${CIFRA})\s?(?:soles?|lucas?|d[oó]lares?|usd|pen|euros?)\b`, "gi");

/** Las cifras de dinero que dice un texto. */
export function cifrasDeDinero(texto: string): string[] {
  const out: string[] = [];
  for (const re of [MONEDA_ANTES, MONEDA_DESPUES]) {
    re.lastIndex = 0;
    for (const m of texto.matchAll(re)) {
      const n = normalizarCifra(m[1] ?? "");
      if (n) out.push(n);
    }
  }
  return out;
}

/** Todas las cifras de un texto (permitidas si están en lo que guardó el negocio). */
function todasLasCifras(texto: string): string[] {
  const out: string[] = [];
  for (const m of texto.matchAll(new RegExp(CIFRA, "g"))) {
    const n = normalizarCifra(m[0]);
    if (n) out.push(n);
  }
  return out;
}

const DOMINIO = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#][^\s]*)?/gi;

/**
 * Terminaciones que de verdad son dominios. Sin la lista, «Sr.Juan» o
 * «Dr.Pérez» parecerían enlaces y bloquearían una respuesta inocente.
 */
const TLD = new Set(
  "com pe net org io app co store shop la me link site info biz online xyz ly gl gle to be us es mx ar cl bo ec uy py ve edu gob gov ai dev page tv fm ws digital tech agency studio cloud art pro club live life world email blog".split(" ")
);

export function dominiosDe(texto: string): string[] {
  const out = new Set<string>();
  for (const m of texto.matchAll(DOMINIO)) {
    const d = (m[1] ?? "").toLowerCase().replace(/^www\./, "");
    if (d && TLD.has(d.split(".").pop() ?? "")) out.add(d);
  }
  return [...out];
}

export function permitidosDe(textoDelNegocio: string): Permitidos {
  return {
    cifras: new Set(todasLasCifras(textoDelNegocio)),
    dominios: new Set(dominiosDe(textoDelNegocio)),
  };
}

function dominioPermitido(d: string, permitidos: Set<string>): boolean {
  for (const p of permitidos) if (d === p || d.endsWith(`.${p}`)) return true;
  return false;
}

export type Revision = { ok: true } | { ok: false; motivo: string };

/** ¿Se puede enviar? Bloquea cifras de dinero y enlaces que el negocio no dio. */
export function revisarSalida(texto: string, p: Permitidos): Revision {
  for (const c of cifrasDeDinero(texto)) {
    if (!p.cifras.has(c)) return { ok: false, motivo: `importe no autorizado: ${c}` };
  }
  for (const d of dominiosDe(texto)) {
    if (!dominioPermitido(d, p.dominios)) return { ok: false, motivo: `enlace no autorizado: ${d}` };
  }
  return { ok: true };
}
