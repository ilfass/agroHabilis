"use strict";

const { query } = require("../../config/database");
const { calcularFlete } = require("../fletes");
const H = require("../consultas/legacy_helpers");

const RETENCIONES = {
  soja: 0.33,
  maiz: 0.12,
  trigo: 0.12,
  girasol: 0.07,
  papa: 0,
};

const RETENCIONES_TEXT = {
  soja: "33%",
  maiz: "12%",
  trigo: "12%",
  girasol: "7%",
  papa: "0%",
};

async function obtenerUltimoPrecioSpot(cultivo) {
  try {
    const res = await query(
      `
        SELECT cultivo, mercado, precio, moneda, fecha
        FROM precios
        WHERE LOWER(cultivo) = LOWER($1)
        ORDER BY fecha DESC,
          CASE
            WHEN LOWER(mercado) LIKE '%cac%' THEN 1
            WHEN LOWER(mercado) LIKE '%rosario%' THEN 2
            WHEN LOWER(mercado) LIKE '%magyp%' THEN 3
            ELSE 9
          END,
          creado_en DESC
        LIMIT 1
      `,
      [cultivo]
    );
    return res.rows[0] || null;
  } catch (e) {
    console.error("[obtenerUltimoPrecioSpot] Error:", e);
    return null;
  }
}

async function resolverTipoCambioMep() {
  try {
    const res = await query(
      `
        SELECT valor
        FROM tipo_cambio
        WHERE LOWER(tipo) LIKE '%mep%' OR LOWER(tipo) LIKE '%bolsa%'
        ORDER BY fecha DESC
        LIMIT 1
      `
    );
    return Number(res.rows[0]?.valor) || 1200; // fallback razonable si falla
  } catch (e) {
    console.error("[resolverTipoCambioMep] Error:", e);
    return 1200;
  }
}

const rutaFletes = async ({ clasificacion, mensaje, usuario }) => {
  const t = String(mensaje || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  // 1. Extraer los parámetros de flete con IA libre estructurada en JSON
  let parser = {
    origen: null,
    destino: null,
    toneladas: 28,
    tipo_carga: "granos",
    precio_local_ofrecido: null,
    grano_o_cultivo: null,
  };

  try {
    const pSystem = [
      "Sos el extractor de parámetros de logística de AgroHabilis.",
      "Leé la pregunta del productor y devolvé un objeto JSON con los siguientes campos:",
      "- origen (string o null): localidad de origen (ej: Tandil, Pergamino, Junín).",
      "- destino (string o null): localidad de destino (ej: Rosario, Bahia Blanca, Liniers).",
      "- toneladas (number): cantidad de toneladas a transportar (asumí 28 si no se menciona).",
      "- tipo_carga (string): 'granos', 'hacienda' o 'fruta'. Asumí 'granos' por defecto. Si menciona 'novillo', 'vaca', 'ternero', asumí 'hacienda'.",
      "- precio_local_ofrecido (number o null): si mencionan una oferta local o precio local de venta en pesos (ej: 'me ofrecen 250.000 en Tandil', extraé 250000).",
      "- grano_o_cultivo (string o null): 'soja', 'maiz', 'trigo', 'girasol', etc. si se menciona en relación al flete.",
      "Devolvé EXCLUSIVAMENTE un JSON válido (sin fences, sin texto extra).",
    ].join("\n");

    const outParse = await H.generarConPromptLibre({
      system: pSystem,
      user: `Mensaje:\n"${mensaje}"\n\nJSON:`,
    });

    const parsedJson = JSON.parse(
      String(outParse?.texto || "")
        .replace(/^```json/i, "")
        .replace(/^```/i, "")
        .replace(/```$/i, "")
        .trim()
    );

    if (parsedJson) {
      parser = { ...parser, ...parsedJson };
    }
  } catch (e) {
    console.warn("[rutaFletes] Falló el parsing con IA, aplicando heurísticas básicas:", e.message);
    // Fallback heurístico simple
    const regexMonto = /\b(?:ofrecen|pagan|ofrecido|local)?\s*\$?\s*(\d{2,3}(?:\.\d{3})*(?:,\d+)?)\b/;
    const matchM = t.match(regexMonto);
    if (matchM) {
      parser.precio_local_ofrecido = Number(matchM[1].replace(/\./g, "").replace(/,/g, "."));
    }
  }

  // Completar datos faltantes con el perfil del usuario
  const origenDefinido = parser.origen || usuario?.partido || usuario?.provincia || "Tandil";
  const cultivoDefinido = parser.grano_o_cultivo ? H.parseCultivo(parser.grano_o_cultivo) : "soja";

  let destinoDefinido = parser.destino;
  if (!destinoDefinido) {
    if (parser.tipo_carga === "hacienda") {
      destinoDefinido = "Mercado Liniers";
    } else {
      // Por defecto para Tandil/Pampa es Bahía Blanca o Rosario, buscamos si hay puerto preferido
      destinoDefinido = "Puerto Rosario";
    }
  }

  const toneladasDefinidas = Number(parser.toneladas) || 28;
  const tipoCargaDefinido = parser.tipo_carga || "granos";

  // 2. Calcular Flete real
  const dataFlete = await calcularFlete(origenDefinido, destinoDefinido, tipoCargaDefinido, toneladasDefinidas);

  if (dataFlete.error) {
    return [
      `⚠️ *AgroHabilis - Logística*`,
      `No pude calcular el flete solicitado de *${origenDefinido}* a *${destinoDefinido}*.`,
      `Detalle: _${dataFlete.error}_`,
      `Rutas de granos precargadas: *Tandil*, *Pergamino*, *Junín*, *Santa Rosa*, *Paraná*, *Río Cuarto* hacia puertos de Rosario y Bahía Blanca.`,
    ].join("\n");
  }

  const costoFleteArsTn = Number(dataFlete.costo_ars_tn || 0);
  const totalFleteArs = Number(dataFlete.costo_total_ars || 0);

  // 3. Si hay arbitraje comercial (se ofreció un precio local)
  let bloqueArbitraje = "";
  if (parser.precio_local_ofrecido) {
    const spot = await obtenerUltimoPrecioSpot(cultivoDefinido);
    const usdMep = await resolverTipoCambioMep();

    if (spot && spot.precio) {
      const precioPuertoArs = Number(spot.precio);
      const gastosComercialesPct = 0.02; // 2% de acopio/corredor
      const gastosComercialesArsTn = precioPuertoArs * gastosComercialesPct;
      
      // El precio neto en campo es el precio en puerto menos el flete, menos peajes asignados por tn y gastos
      const peajesPorTn = dataFlete.peajes_ars ? (dataFlete.peajes_ars / toneladasDefinidas) : 0;
      const precioNetoCampoArs = precioPuertoArs - costoFleteArsTn - peajesPorTn - gastosComercialesArsTn;

      const precioLocal = Number(parser.precio_local_ofrecido);
      const diferenciaPorTn = precioNetoCampoArs - precioLocal;
      const diferenciaTotal = diferenciaPorTn * toneladasDefinidas;

      const usdNetoTn = precioNetoCampoArs / usdMep;
      const usdLocalTn = precioLocal / usdMep;

      bloqueArbitraje = [
        "",
        `⚖️ *ARBITRAJE COMERCIAL (${cultivoDefinido.toUpperCase()})*`,
        `Cotización Puerto (${spot.mercado}): *$${precioPuertoArs.toLocaleString("es-AR")}/tn*`,
        `Costo Flete por tn: *- $${costoFleteArsTn.toLocaleString("es-AR")}/tn*`,
        `Peajes + Comisión (2%): *- $${(peajesPorTn + gastosComercialesArsTn).toLocaleString("es-AR", { maximumFractionDigits: 0 })}/tn*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `*PRECIO NETO EN CAMPO (Puerto):*`,
        `👉 *$${precioNetoCampoArs.toLocaleString("es-AR", { maximumFractionDigits: 0 })}/tn* (~USD ${usdNetoTn.toLocaleString("es-AR", { maximumFractionDigits: 1 })}/tn)`,
        `👉 *Tu Oferta Local:* *$${precioLocal.toLocaleString("es-AR")}/tn* (~USD ${usdLocalTn.toLocaleString("es-AR", { maximumFractionDigits: 1 })}/tn)`,
        "",
        diferenciaPorTn > 0 
          ? `📈 *¡CONVIENE ENVIAR AL PUERTO!*`
          : `📉 *¡CONVIENE VENDER LOCAL!*`,
        diferenciaPorTn > 0
          ? `Ganás *$${diferenciaPorTn.toLocaleString("es-AR", { maximumFractionDigits: 0 })}* extra por tonelada.`
          : `Evitás perder *$${Math.abs(diferenciaPorTn).toLocaleString("es-AR", { maximumFractionDigits: 0 })}* por tonelada al asumir el flete.`,
        `Diferencia en viaje completo (${toneladasDefinidas} tn): *${diferenciaTotal >= 0 ? "+" : "-"} $${Math.abs(diferenciaTotal).toLocaleString("es-AR", { maximumFractionDigits: 0 })}*`,
      ].join("\n");
    } else {
      bloqueArbitraje = [
        "",
        `⚠️ *Arbitraje limitado*: No tengo cotización spot vigente cargada para *${cultivoDefinido}* en puerto para comparar.`,
      ].join("\n");
    }
  }

  // 4. Formatear respuesta de flete general
  const respuesta = [
    `🚚 *AGROHABILIS - CÁLCULO DE FLETE*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📍 *Ruta:* ${origenDefinido} ➔ ${destinoDefinido}`,
    `📏 *Distancia:* *${dataFlete.distancia_km || "s/d"} km*`,
    `📦 *Carga:* *${toneladasDefinidas} tn* (${tipoCargaDefinido})`,
    `💸 *Peajes estimados:* $${Number(dataFlete.peajes_ars || 0).toLocaleString("es-AR")}`,
    `⛽ *Ajuste gasoil:* $${Number(dataFlete.gasoil_actual_ars || 0).toLocaleString("es-AR")}/lt (factor ${dataFlete.gasoil_factor})`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `💰 *Costo Flete:*`,
    `• Por Tonelada: *USD ${Number(dataFlete.costo_usd_tn || 0).toFixed(2)}/tn* (~*$${costoFleteArsTn.toLocaleString("es-AR", { maximumFractionDigits: 0 })}/tn*)`,
    `• Costo Total del Viaje: *USD ${Number(dataFlete.costo_total_usd || 0).toFixed(2)}* (~*$${totalFleteArs.toLocaleString("es-AR", { maximumFractionDigits: 0 })}*)`,
    bloqueArbitraje,
    "",
    `⚠️ _Valores referenciales y sujetos a negociación de tarifa de flete corta/larga._`,
  ].join("\n");

  return respuesta;
};

module.exports = { rutaFletes };
