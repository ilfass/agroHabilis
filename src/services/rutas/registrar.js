"use strict";

const H = require("../consultas/legacy_helpers");

const norm = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

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

  if (/(vendi|vend[ií]|venta\b)/.test(t) && /\d/.test(mensaje)) {
    const base = await H.registrarVenta(whatsapp, mensaje);
    const out = await H.generarConPromptLibre({
      system:
        "Sos AgroHabilis. Confirmá el registro de venta en forma breve y natural, máximo 6 líneas.",
      user: `Resultado sistema:\n${base}`,
    });
    return String(out?.texto || base).trim();
  }

  if (/(gast[eé]|compr[eé]|gasto\b|compra\b)/.test(t) && /\d/.test(mensaje)) {
    const base = await H.registrarGasto(whatsapp, mensaje);
    const out = await H.generarConPromptLibre({
      system:
        "Sos AgroHabilis. Confirmá el gasto en forma breve y natural, máximo 6 líneas.",
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

  const base = await H.registrarGasto(whatsapp, mensaje);
  const out = await H.generarConPromptLibre({
    system: "Sos AgroHabilis. Confirmá en forma natural o pedí un dato que falte, máximo 6 líneas.",
    user: `Resultado sistema:\n${base}`,
  });
  return String(out?.texto || base).trim();
};

module.exports = {
  rutaRegistrar,
  registrarDatoGanadero,
  registrarDatoAgricola,
  registrarLote,
};
