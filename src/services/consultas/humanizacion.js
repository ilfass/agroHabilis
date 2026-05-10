"use strict";

const limpiarMarcadoresRespuestaPrecio = (texto = "") => {
  let t = String(texto || "");
  t = t.replace(/(\bfuente\b\s*[:\-]?\s*)sin dato puntual hoy/gi, "$1fuente no informada");
  t = t.replace(/,\s*sin dato puntual hoy\s*,/gi, ", fuente no informada,");
  t = t.replace(/\bs\/fuente\b/gi, "fuente no informada");
  t = t.replace(/\bsin dato puntual hoy\b/gi, "referencia puntual no informada");
  t = t.replace(/\bsin datos en base\b/gi, "referencia puntual no informada");
  t = t.replace(/\bestoy referencia puntual no informada\b/gi, "no tengo referencia puntual informada");
  t = t.replace(/\bestamos referencia puntual no informada\b/gi, "no tenemos referencia puntual informada");
  return t;
};

const humanizarRespuestaPrecioLocal = ({ textoBase = "" } = {}) => {
  const limpio = limpiarMarcadoresRespuestaPrecio(String(textoBase || "").trim());
  if (!limpio) return "";
  const lineas = limpio
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const util = lineas.filter(
    (l) =>
      !/^hola[,!]?/i.test(l) &&
      !/^━+/.test(l) &&
      !/^(tipo priorizado|fuente|📈|📊|🎯|📌)/i.test(l)
  );
  if (!util.length) return limpio;
  const titular = util.find((l) => /^(🌾|🌽|🌱|🌻|🥔|🐄|🐮)/.test(l)) || util[0];
  const promedio = lineas.find((l) => /promedio/i.test(l));
  const rango = lineas.find((l) => /rango/i.test(l));
  const referencia = lineas.find((l) => /referencia prioritaria/i.test(l));
  const lectura = lineas.find((l) => /lectura/i.test(l));
  return [
    "Claro, te paso el dato.",
    titular,
    promedio || rango || null,
    promedio && rango ? rango : null,
    referencia ? referencia.replace(/^🎯\s*/i, "") : null,
    lectura ? lectura.replace(/^📌\s*/i, "") : "Si querés, te lo comparo con maíz/soja para decisión de venta.",
  ]
    .filter(Boolean)
    .join("\n");
};

const humanizarRespuestaPrecioConIA = async ({
  pregunta = "",
  textoBase = "",
  usuario = null,
  generarConPromptLibre,
  sanitizarPlaceholders,
} = {}) => {
  const base = String(textoBase || "").trim();
  if (!base) return "";
  const system = [
    "Sos AgroHabilis, asesor agro para WhatsApp.",
    "Reescribí la respuesta en tono humano y accionable.",
    "Obligatorio: preservar intactos todos los números, precios, fechas, fuentes y mercados presentes.",
    "No inventes datos nuevos.",
    "Máximo 7 líneas, español rioplatense.",
  ].join("\n");
  const user = JSON.stringify(
    {
      pregunta,
      usuario: { nombre: usuario?.nombre || null, plan: usuario?.plan || null },
      respuesta_base: base,
    },
    null,
    2
  );
  try {
    const ia = await generarConPromptLibre({ system, user });
    const txt = sanitizarPlaceholders(String(ia?.texto || "").trim());
    if (!txt) return humanizarRespuestaPrecioLocal({ textoBase: base });
    if (/^\{[\s\S]*\}$/.test(txt)) return humanizarRespuestaPrecioLocal({ textoBase: base });
    return limpiarMarcadoresRespuestaPrecio(txt);
  } catch (_e) {
    return humanizarRespuestaPrecioLocal({ textoBase: base });
  }
};

const compactarRespuestaSimple = (texto = "", maxLineas = 8, { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : (x) => String(x || "").toLowerCase().trim();
  const raw = String(texto || "").trim();
  if (!raw) return raw;
  const lines = raw
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");
  if (lines.length <= maxLineas) return raw;
  const out = [];
  for (const l of lines) {
    const low = norm(l);
    if (/complemento web|plantilla|fuentes?:/i.test(low)) continue;
    if (/^(riesgo|contexto|lectura|recomendaci[oó]n|decisi[oó]n)/.test(low)) continue;
    out.push(l);
    if (out.length >= maxLineas) break;
  }
  return (out.length ? out : lines.slice(0, maxLineas)).join("\n").trim();
};

const adaptarRespuestaPorNivel = (nivel, bloques = {}) => {
  const limpiar = (txt = "") =>
    String(txt)
      .split("\n")
      .map((l) => l.trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const limitarLineas = (txt = "", max = 4) =>
    limpiar(txt)
      .split("\n")
      .slice(0, max)
      .join("\n")
      .trim();

  if (nivel === "TECNICO") return limpiar(bloques.tecnico || bloques.intermedio || bloques.simple || "");
  if (nivel === "INTERMEDIO") return limpiar(bloques.intermedio || bloques.simple || bloques.tecnico || "");
  return limitarLineas(bloques.simple || bloques.intermedio || bloques.tecnico || "", 4);
};

const lineaDatoTrazable = ({ etiqueta = "Dato", valor = "s/d", unidad = "", fuente = "base interna", fecha = null, tipo = "REAL" }) =>
  `- ${etiqueta}: ${valor}${unidad ? ` ${unidad}` : ""} (${tipo} | fuente ${fuente}${fecha ? ` | fecha ${fecha}` : ""})`;

const embellecerRespuestaWhatsApp = (texto = "") => {
  let t = String(texto || "").trim();
  if (!t) return t;
  t = t
    .replace(/^Rango:/gim, "📊 *Rango:*")
    .replace(/^Promedio:/gim, "📈 *Promedio:*")
    .replace(/^Tendencia:/gim, "📉 *Tendencia:*")
    .replace(/^Recomendación:/gim, "✅ *Recomendación:*")
    .replace(/^Referencia de mercado/gim, "🧾 *Referencia de mercado*")
    .replace(/^Datos de /gim, "📌 *Datos de* ")
    .replace(/^Fecha:/gim, "🗓️ *Fecha:*")
    .replace(/^Tipo de dato:/gim, "🏷️ *Tipo de dato:*")
    .replace(/\n{3,}/g, "\n\n");

  const lines = t.split("\n");
  const firstIdx = lines.findIndex((l) => l.trim());
  if (firstIdx >= 0) {
    const first = lines[firstIdx].trim();
    if (!first.startsWith("*") && !first.startsWith("-") && !first.includes("━━━━━━━━")) {
      lines[firstIdx] = `*${first}*`;
    }
  }
  return lines.join("\n").trim();
};

const limpiarSalidaSaludoIA = (texto = "") => {
  let t = String(texto || "").trim();
  if (!t) return "";
  t = t
    .replace(/\b(DATO REAL|CONTEXT|NO_DATA)\b/gi, "")
    .replace(/━━━━━━━━[\s\S]*$/g, "")
    .replace(/📦\s*PLANTILLA[\s\S]*$/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t;
};

const humanizarComandoLocal = ({ usuario, comando, datosTexto }) => {
  const nombre = String(usuario?.nombre || "").trim().split(" ")[0] || "che";
  const base = String(datosTexto || "").trim();
  if (!base) return "Listo, ya procesé tu pedido.";
  if (comando === "MI_RESUMEN") return base;
  if (comando === "MIS_ALERTAS") {
    if (/no ten[eé]s alertas activas/i.test(base)) return "No tenés alertas activas. ¿Querés crear una ahora?";
    return `${nombre}, estas son tus alertas activas:\n${base}`;
  }
  if (comando === "MI_MARGEN") return `${nombre}, este es tu margen del mes:\n${base}`;
  if (comando === "REGISTRAR_GASTO") return `${base}\n¿En cuántas hectáreas lo aplicaste?`;
  if (comando === "REGISTRAR_VENTA") return `${base}\n¿Querés que te calcule el margen con esta venta?`;
  if (comando === "CREAR_ALERTA") return `${base}\n¿Querés agregar otra alerta?`;
  if (comando === "ANALIZAR_CULTIVO") return `${nombre}, te paso el análisis:\n${base}`;
  return base;
};

const humanizarComandoConIA = async (
  { usuario, comando, datosTexto } = {},
  { generarConPromptLibreFn, humanizarComandoLocalFn } = {}
) => {
  const generarConPromptLibre =
    typeof generarConPromptLibreFn === "function" ? generarConPromptLibreFn : async () => ({ texto: "" });
  const humanizarComandoLocalImpl =
    typeof humanizarComandoLocalFn === "function" ? humanizarComandoLocalFn : humanizarComandoLocal;
  const system = [
    "Sos AgroHabilis.",
    "Humanizá una salida de comando para WhatsApp.",
    "Reglas: no inventar datos, no agregar números no presentes, tono natural, máximo 5 líneas salvo listado de alertas.",
  ].join("\n");
  const user = JSON.stringify(
    {
      comando,
      usuario: { nombre: usuario?.nombre || null, plan: usuario?.plan || null },
      datos: datosTexto,
    },
    null,
    2
  );
  try {
    const out = await generarConPromptLibre({ system, user });
    const txt = String(out?.texto || "").trim();
    if (!txt) return humanizarComandoLocalImpl({ usuario, comando, datosTexto });
    if (/^\{[\s\S]*\}$/.test(txt)) return humanizarComandoLocalImpl({ usuario, comando, datosTexto });
    if (/El usuario pidi[oó]/i.test(txt)) return humanizarComandoLocalImpl({ usuario, comando, datosTexto });
    return txt;
  } catch (_e) {
    return humanizarComandoLocalImpl({ usuario, comando, datosTexto });
  }
};

module.exports = {
  adaptarRespuestaPorNivel,
  embellecerRespuestaWhatsApp,
  compactarRespuestaSimple,
  humanizarComandoConIA,
  humanizarComandoLocal,
  limpiarSalidaSaludoIA,
  lineaDatoTrazable,
  limpiarMarcadoresRespuestaPrecio,
  humanizarRespuestaPrecioLocal,
  humanizarRespuestaPrecioConIA,
};
