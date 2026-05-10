"use strict";

const H = require("../consultas/legacy_helpers");
const { listarSaldos, listarLotesUsuario } = require("../inventario/core");
const { obtenerTextoMisGastos, obtenerTextoMisVentas, obtenerTextoMiMargen } = require("../gastos");

const normTxt = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

async function formatoLotesBrief(usuarioId) {
  const lotes = await listarLotesUsuario(usuarioId);
  if (!lotes?.length) return "(sin lotes cargados)";
  return lotes
    .slice(0, 12)
    .map((L) => {
      const nombre = L.nombre || `Lote #${L.id}`;
      const ha = L.hectareas != null ? ` · ${Number(L.hectareas)} ha` : "";
      const cult = L.cultivo ? ` · cultivo ref: ${L.cultivo}` : "";
      const arr = L.arrendado ? " (arrendado)" : "";
      return `- ${nombre}${ha}${cult}${arr}`;
    })
    .join("\n");
}

async function formatoInventarioBrief(usuarioId) {
  try {
    const rows = await listarSaldos({ usuarioId });
    const arr = Array.isArray(rows) ? rows : [];
    if (!arr.length) return "(sin stock en inventario)";
    return JSON.stringify(arr, null, 0).slice(0, 2200);
  } catch (_e) {
    return "Inventario: no disponible ahora.";
  }
}

const rutaConsultaRegistros = async ({ mensaje, usuario, numeroWhatsapp }) => {
  const t = normTxt(mensaje);
  const wa = H.normalizarWhatsapp(numeroWhatsapp);

  const tomaGasto = /\b(gast[oó]|cu[aá]nto gast|mis gastos|categor(i|í)a)\b/.test(t);
  const tomaVenta = /\b(venta|vend[ií]|mis ventas|factur)\b/.test(t);
  const tomaMargen =
    /\b(margen|rentabilidad|balance|resultado|c[uú]enta)\b/.test(t) ||
    /\b(qu[eé] me dej[oó]|c[oó]mo vengo|c[oó]mo estoy)\b/.test(t);
  const tomaInv = /\b(animal|cabez|novill|terner|ganad|stock|inventario|invent)\b/.test(t);
  const tomaLotes =
    /\b(lotes?|parcela|campo(s)?)\b/.test(t) &&
    /\b(mis\b|cuant|cual|c[uú]ant|mostr[aá]?|list|r[eé]sume)\b/.test(t);

  const bloques = [];

  if ((tomaGasto && !tomaVenta) || (tomaGasto && t.includes("gast") && !t.includes("vent"))) {
    bloques.push("--- Gastos del mes ---\n" + (await obtenerTextoMisGastos(wa)));
  } else if ((tomaVenta && !tomaGasto) || (t.includes("venta") && !t.includes("gast"))) {
    bloques.push("--- Ventas del mes ---\n" + (await obtenerTextoMisVentas(wa)));
  } else if (tomaMargen || (tomaGasto && tomaVenta)) {
    bloques.push("--- Margen / finanzas ---\n" + (await obtenerTextoMiMargen(wa)));
  }

  if (tomaInv) {
    bloques.push("--- Inventario ---\n" + (await formatoInventarioBrief(usuario.id)));
  }

  if (tomaLotes) {
    bloques.push("--- Lotes ---\n" + (await formatoLotesBrief(usuario.id)));
  }

  let bloqueFallback = "";
  if (!bloques.length) {
    try {
      const r = await H.obtenerResumenFinanciero(usuario.id);
      bloqueFallback = `Resumen financiero (JSON):\n${JSON.stringify(r || {}).slice(0, 2000)}`;
    } catch (_e) {
      bloqueFallback = "Finanzas: sin datos o error al leer.";
    }
    if (/\b(animal|invent|inventario|lote)\b/.test(t)) {
      bloqueFallback +=
        "\n\n" +
        "--- Inventario ---\n" +
        (await formatoInventarioBrief(usuario.id)) +
        "\n\n--- Lotes ---\n" +
        (await formatoLotesBrief(usuario.id));
    }
  }

  const payload = [...bloques, bloqueFallback].filter(Boolean).join("\n\n");

  const out = await H.generarConPromptLibre({
    system:
      "Sos AgroHabilis. Respondé en español argentino: resumí los datos del productor para WhatsApp (negritas con * donde ayude). No inventes registros.",
    user: `Pregunta:\n${mensaje}\n\nDatos internos:\n${payload}`,
  });

  const txt = String(out?.texto || "").trim();
  return txt || "Todavía no tengo registros cargados para mostrar.";
};

module.exports = { rutaConsultaRegistros };
