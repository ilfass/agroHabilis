"use strict";

const { query } = require("../../config/database");
const H = require("../consultas/legacy_helpers");

let recolectarPreciosCACFresco;
try {
  ({ recolectarPreciosCACFresco } = require("../../jobs/recolector"));
} catch (_e) {
  recolectarPreciosCACFresco = null;
}

async function precioRecienteSuficiente(cultivo) {
  const c = String(cultivo || "").trim();
  if (!c) return false;
  const r = await query(
    `
      SELECT MAX(creado_en) AS t
      FROM precios
      WHERE LOWER(TRIM(cultivo)) = LOWER($1)
    `,
    [c]
  );
  const t = r.rows[0]?.t;
  if (!t) return false;
  const ageMs = Date.now() - new Date(t).getTime();
  return ageMs < 10 * 60 * 60 * 1000;
}

function pedidoTipoCambioSinCultivo(clasificacion, mensaje = "") {
  if (clasificacion?.variante_precio === "dolar") return true;
  if (/\binsumo|hacienda\b/i.test(String(clasificacion?.producto || ""))) return false;
  if (clasificacion?.cultivo && String(clasificacion.cultivo).trim()) return false;
  const t = String(mensaje || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const mencionaGranoOCultivo = /\b(soja|ma[ií]z|trigo|girasol|cebada|sorgo|papa|patata|tonel|qq\b|grano)\b/.test(
    t
  );
  return H.esConsultaDolar(mensaje) && !mencionaGranoOCultivo;
}

const rutaPrecio = async ({ clasificacion, mensaje, usuario }) => {
  const cultivos = usuario?.cultivos || [];
  let cultivo =
    clasificacion?.cultivo ||
    (clasificacion?.producto && !/insumo|hacienda/i.test(String(clasificacion.producto))
      ? clasificacion.producto
      : null) ||
    H.detectarCultivoConsulta(mensaje, cultivos) ||
    H.detectarCultivoEnTexto(mensaje);
  cultivo = cultivo ? H.parseCultivo(String(cultivo)) : null;

  const nivel = H.detectarNivelUsuarioConsulta(mensaje);
  const nivelPrecio = nivel === "SIMPLE" ? "INTERMEDIO" : nivel;

  const esDolar = pedidoTipoCambioSinCultivo(clasificacion, mensaje);
  if (esDolar) {
    const base = await H.responderDolarActual();
    let salida = base;
    if (nivel !== "SIMPLE") {
      const human = await H.humanizarRespuestaPrecioConIA({
        pregunta: mensaje,
        textoBase: base,
        usuario,
      });
      salida = H.limpiarMarcadoresRespuestaPrecio(human);
    } else {
      salida = H.compactarRespuestaSimple(H.sanitizarPlaceholders(salida), 10);
    }
    return H.enriquecerConGroundingAgroSiHaceFalta({
      pregunta: mensaje,
      textoBase: salida,
      intencion: "precio",
    });
  }

  const esInsumo =
    /\binsumo/i.test(String(clasificacion?.producto || "")) || H.esConsultaInsumos(mensaje);
  if (esInsumo) {
    const base = await H.responderInsumos({
      pregunta: mensaje,
      usuario,
      nivel: nivelPrecio,
    });
    const salida =
      nivel === "SIMPLE"
        ? H.compactarRespuestaSimple(H.sanitizarPlaceholders(String(base || "")), 8)
        : H.sanitizarPlaceholders(String(base || ""));
    return H.enriquecerConGroundingAgroSiHaceFalta({
      pregunta: mensaje,
      textoBase: salida,
      intencion: "precio",
    });
  }

  /**
   * Mención de categoría de hacienda sin verbo de decisión (ej. respuesta
   * corta "El novillo" tras un catch-all de "mercado"). Si la regex de
   * `esConsultaHaciendaVenta` ya pesca, perfecto. Si no, igual queremos
   * router a hacienda en vez de defaultear silenciosamente a soja.
   */
  const mensajeNormHac = String(mensaje || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const mencionaHaciendaAislada = /\b(novill|vaca|vaquillona|terner|invernada|cria|cría|hacienda|ganad|toro|cebu)/.test(
    mensajeNormHac
  );

  const esHacienda =
    /hacienda/i.test(String(clasificacion?.producto || "")) ||
    H.esConsultaHaciendaVenta(mensaje) ||
    (mencionaHaciendaAislada && !cultivo);
  if (esHacienda) {
    const base = await H.responderHaciendaSimple(mensaje, nivelPrecio);
    const salida =
      nivel === "SIMPLE"
        ? H.compactarRespuestaSimple(H.sanitizarPlaceholders(String(base || "")), 10)
        : H.sanitizarPlaceholders(String(base || ""));
    return H.enriquecerConGroundingAgroSiHaceFalta({
      pregunta: mensaje,
      textoBase: salida,
      intencion: "precio",
    });
  }

  /**
   * Antes había `if (!cultivo) cultivo = "soja";` — eso producía respuestas
   * con dump de soja cuando el productor preguntaba "mercado" → "el novillo".
   * Un agente repregunta concretamente en vez de inventar el cultivo.
   */
  if (!cultivo) {
    return [
      "¿De qué grano querés el precio?",
      "Ej: *soja*, *maíz*, *trigo*, *girasol*, *cebada*, *sorgo*.",
      "Si querés hacienda, decime *novillo*, *vaca*, *vaquillona*, *ternero*, *invernada*.",
    ].join("\n");
  }

  const ok = await precioRecienteSuficiente(cultivo);
  if (!ok && typeof recolectarPreciosCACFresco === "function") {
    // Se ejecuta en segundo plano para no bloquear ni demorar la respuesta de WhatsApp
    recolectarPreciosCACFresco().catch((err) => {
      console.warn("[precio] Error en segundo plano de recolectarPreciosCACFresco:", err.message || err);
    });
  }

  let base = await H.responderDatosCultivo(cultivo, nivelPrecio);

  // Inyectamos SIEMPRE las posiciones de futuros disponibles para este cultivo (sin usar regex)
  try {
    const cultivoSqlLike = cultivo ? `%${cultivo}%` : "%soja%";
    const rFut = await query(
      `
        SELECT posicion, precio_usd, variacion, volumen, fecha, fuente
        FROM futuros_posiciones
        WHERE LOWER(cultivo) LIKE LOWER($1)
          AND fecha = (SELECT MAX(fecha) FROM futuros_posiciones WHERE LOWER(cultivo) LIKE LOWER($1))
        ORDER BY posicion
        LIMIT 8
      `,
      [cultivoSqlLike]
    );

    if (rFut.rows.length) {
      const lineasFut = rFut.rows.map(
        (f) => `  · Posición: ${f.posicion} | Precio: USD ${f.precio_usd}${f.variacion ? ` (Var: ${f.variacion})` : ""} | Fuente: ${f.fuente} | Fecha Ref: ${f.fecha.toISOString().split("T")[0]}`
      );
      base += `\n\n--- Posiciones de Futuros (MATba-Rofex / CBOT) ---\n` + lineasFut.join("\n");
    }
  } catch (errFut) {
    console.warn("[precio] Error al inyectar futuros posiciones:", errFut.message || errFut);
  }

  const human = await H.humanizarRespuestaPrecioConIA({
    pregunta: mensaje,
    textoBase: base,
    usuario,
  });
  const humanLimpio = H.limpiarMarcadoresRespuestaPrecio(human);
  return H.enriquecerConGroundingAgroSiHaceFalta({
    pregunta: mensaje,
    textoBase: humanLimpio,
    intencion: "precio",
  });
};

module.exports = { rutaPrecio };
