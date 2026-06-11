"use strict";

const H = require("../consultas/legacy_helpers");

const norm = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const SENAL_GASTO_CLARA = /\b(gast[eé]|compr[eé]|gasto\b|compra\b)\b/;
const SENAL_GANADERIA_O_STOCK =
  /\b(ganad|hacienda|stock|inventario|lote|parcela|campo|vacas?|novill|terner|vaquillon|toros?|invernada|macho|hembra)\b/;

const decidirAccionFallbackRegistrar = async ({ mensaje, tieneNumero }) => {
  const txt = String(mensaje || "").trim();
  const t = norm(txt);
  if (!txt) return { accion: "pedir_aclaracion", repregunta: "" };
  if (SENAL_GASTO_CLARA.test(t) && tieneNumero) return { accion: "intentar_gasto", repregunta: "" };
  if (SENAL_GANADERIA_O_STOCK.test(t)) return { accion: "intentar_inventario", repregunta: "" };

  try {
    const out = await H.generarConPromptLibre({
      system: [
        "Sos un micro-router para registro agro por WhatsApp.",
        "Elegí UNA accion y respondé SOLO JSON válido:",
        '{"accion":"pedir_aclaracion|intentar_gasto|intentar_inventario","repregunta":"string"}',
        "Reglas:",
        "- intentar_gasto SOLO si hay señal clara de gasto/compra y monto utilizable.",
        "- intentar_inventario para stock/ganadería/lotes/inventario o altas productivas.",
        "- pedir_aclaracion si está ambiguo.",
        "repregunta corta, concreta, en voseo; solo si pedir_aclaracion.",
      ].join(" "),
      user: `Mensaje: ${txt}`,
    });
    const raw = String(out?.texto || "").trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
    const parsed = JSON.parse(json);
    const accion = String(parsed?.accion || "").trim();
    if (["pedir_aclaracion", "intentar_gasto", "intentar_inventario"].includes(accion)) {
      return { accion, repregunta: String(parsed?.repregunta || "").trim() };
    }
  } catch (_e) {
    // fallback seguro más abajo
  }

  return {
    accion: "pedir_aclaracion",
    repregunta:
      "Decime si querés que *registre* un dato nuevo o que *te muestre* lo ya cargado. " +
      "Si es registro, mandame una línea con dato concreto (ej: «gasté 250000 en semilla» o «120 novillos en lote 2»).",
  };
};

async function registrarDatoGanadero({ texto, usuarioId, numeroWhatsapp }) {
  const { manejarInventarioWhatsapp } = require("../inventario/whatsapp_flow");
  const inv = await manejarInventarioWhatsapp({
    texto,
    usuarioId,
    numeroWhatsapp,
  });
  if (inv?.respuesta != null) return inv.respuesta;
  return "No pude interpretar el registro ganadero. Probá con cantidad y categoría (ej: «120 novillos en lote norte»).";
}

async function registrarDatoAgricola(ctx) {
  return registrarDatoGanadero(ctx);
}

async function registrarLote(ctx) {
  return registrarDatoGanadero(ctx);
}

const rutaRegistrar = async ({ mensaje, usuario, numeroWhatsapp }) => {
  const t = norm(mensaje);

  if (!usuario?.id) {
    return "Para registrar datos necesito tu perfil. Mandame un hola y te guío en el alta.";
  }

  const whatsapp = H.normalizarWhatsapp(numeroWhatsapp);

  // Soporte para mensajes compuestos (ej: "Hoy nacieron 2 terneros y ayer gasté 185 mil en alimento")
  // Separamos por conjunciones "y", comas o puntos si contienen múltiples señales independientes.
  const tieneGastoVenta = /(gast[eé]|compr[eé]|gasto\b|compra\b|vendi|vend[ií]|venta\b)/i.test(t) && /\d/.test(mensaje);
  const tieneGanaderiaAgricola = /\b(terner|novill|vacas?|parici|naci[oó]|aplic|labor|siembra|lluvia|cosecha)\b/i.test(t);
  
  if (tieneGastoVenta && tieneGanaderiaAgricola) {
    const partes = mensaje.split(/\s+\by\b\s+|\s*,\s*|\s*\.\s+/i).map(p => p.trim()).filter(Boolean);
    if (partes.length >= 2) {
      const respuestas = [];
      for (const parte of partes) {
        if (norm(parte) === t) continue;
        const respParte = await rutaRegistrar({ mensaje: parte, usuario, numeroWhatsapp });
        if (respParte && !respParte.includes("Contame qué querés registrar")) {
          respuestas.push(respParte);
        }
      }
      if (respuestas.length > 0) {
        return respuestas.join("\n\n");
      }
    }
  }

  if (/(vendi|vend[ií]|venta\b)/.test(t) && /\d/.test(mensaje)) {
    const base = await H.registrarVenta(usuario, mensaje);
    const systemInstruction = usuario.es_delegado
      ? `Sos AgroHabilis. Confirmá el registro de venta en forma breve y natural, máximo 6 líneas. Saludá al operario/encargado "${usuario.nombre_operario}" y mencioná que la venta fue cargada a la cuenta de "${usuario.nombre}".`
      : "Sos AgroHabilis. Confirmá el registro de venta en forma breve y natural, máximo 6 líneas.";
    const out = await H.generarConPromptLibre({
      system: systemInstruction,
      user: `Resultado sistema:\n${base}`,
    });
    return String(out?.texto || base).trim();
  }

  if (/(gast[eé]|compr[eé]|gasto\b|compra\b)/.test(t) && /\d/.test(mensaje)) {
    const base = await H.registrarGasto(usuario, mensaje);
    const systemInstruction = usuario.es_delegado
      ? `Sos AgroHabilis. Confirmá el gasto en forma breve y natural, máximo 6 líneas. Saludá al operario/encargado "${usuario.nombre_operario}" y mencioná que el gasto fue cargado a la cuenta de "${usuario.nombre}".`
      : "Sos AgroHabilis. Confirmá el gasto en forma breve y natural, máximo 6 líneas.";
    const out = await H.generarConPromptLibre({
      system: systemInstruction,
      user: `Resultado sistema:\n${base}`,
    });
    return String(out?.texto || base).trim();
  }

  if (/\b(lote|parcela|campo)\b/.test(t) && /(alta|nuevo|crear|registr)/.test(t)) {
    return registrarLote({ texto: mensaje, usuarioId: usuario.id, numeroWhatsapp });
  }

  if (/\b(aplic|labor|siembra|lluvia|cosecha)\b/.test(t)) {
    return registrarDatoAgricola({ texto: mensaje, usuarioId: usuario.id, numeroWhatsapp });
  }

  if (/\b(terner|novill|vacas?|parici|naci[oó]|sanidad|vacun)\b/.test(t)) {
    return registrarDatoGanadero({ texto: mensaje, usuarioId: usuario.id, numeroWhatsapp });
  }

  const { manejarInventarioWhatsapp } = require("../inventario/whatsapp_flow");
  const inv = await manejarInventarioWhatsapp({
    texto: mensaje,
    usuarioId: usuario.id,
    numeroWhatsapp,
  });
  if (inv?.manejado && inv.respuesta != null) return inv.respuesta;
  const decision = await decidirAccionFallbackRegistrar({
    mensaje,
    tieneNumero: /\d/.test(mensaje),
  });

  if (decision.accion === "intentar_gasto" && SENAL_GASTO_CLARA.test(t) && /\d/.test(mensaje)) {
    const base = await H.registrarGasto(usuario, mensaje);
    const systemInstruction = usuario.es_delegado
      ? `Sos AgroHabilis. Confirmá en forma natural o pedí un dato que falte, máximo 6 líneas. Saludá al operario/encargado "${usuario.nombre_operario}" y mencioná que el gasto fue cargado a la cuenta de "${usuario.nombre}".`
      : "Sos AgroHabilis. Confirmá en forma natural o pedí un dato que falte, máximo 6 líneas.";
    const out = await H.generarConPromptLibre({
      system: systemInstruction,
      user: `Resultado sistema:\n${base}`,
    });
    return String(out?.texto || base).trim();
  }

  if (decision.accion === "intentar_inventario") {
    const inv2 = await manejarInventarioWhatsapp({
      texto: mensaje,
      usuarioId: usuario.id,
      numeroWhatsapp,
      opciones: {
        forzarCapaUsuarioLlm: true,
        capaGemini: { capa: "inventario", inventario_modo: "registro" },
      },
    });
    if (inv2?.respuesta != null) return inv2.respuesta;
  }

  return (
    String(decision.repregunta || "").trim() ||
    "Contame qué querés registrar con formato concreto (monto/categoría/lote), y lo cargo."
  );
};

module.exports = {
  rutaRegistrar,
  registrarDatoGanadero,
  registrarDatoAgricola,
  registrarLote,
};
