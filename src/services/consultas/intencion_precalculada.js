"use strict";

/**
 * Alineación con la intención previa (`detectarIntencionIA` en WhatsApp) sin duplicar el clasificador.
 * Prioriza señales explícitas como comando Gemini o sólo tipo de cambio.
 */
const fusionarIntencionPrecalculada = (clasificacion, precalc, mensaje = "") => {
  if (!precalc || typeof precalc !== "object") return clasificacion;
  const tipo = String(precalc.tipo || "").trim();
  const cmd = precalc.comando != null ? String(precalc.comando).trim() : "";
  const parametros =
    typeof precalc.parametros === "object" && precalc.parametros ? { ...precalc.parametros } : {};

  if (tipo === "comando" && cmd) {
    return {
      ...clasificacion,
      intencion: "comando",
      comandoIa: { comando: cmd, parametros },
      confianza: "alta",
    };
  }

  if (tipo === "tipo_cambio") {
    return {
      ...clasificacion,
      intencion: "precio",
      variante_precio: "dolar",
      confianza: "alta",
    };
  }

  if (tipo === "no_agro") {
    return { ...clasificacion, intencion: "no_agro", confianza: "alta" };
  }

  if (tipo === "saludo") {
    const compacto = String(mensaje || "").trim().length < 56;
    if (clasificacion.intencion === "saludo" || clasificacion.confianza !== "alta" || compacto) {
      return { ...clasificacion, intencion: "saludo", confianza: "alta" };
    }
  }

  if (tipo === "ayuda_uso") {
    return {
      ...clasificacion,
      intencion: "agro_general",
      ayuda_recurso: parametros.recurso || parametros.tema || null,
      confianza: "alta",
    };
  }

  if (tipo === "consulta_registros") {
    return {
      ...clasificacion,
      intencion: "consulta_registros",
      requiere_datos_propios: true,
      confianza: "alta",
    };
  }

  if (tipo === "meta_fecha" || tipo === "meta_hora") {
    return {
      ...clasificacion,
      intencion: "agro_general",
      meta_consulta: tipo === "meta_hora" ? "hora" : "fecha",
      confianza: "alta",
    };
  }

  return clasificacion;
};

module.exports = { fusionarIntencionPrecalculada };
