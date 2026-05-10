"use strict";

const { inferirComandoNatural, resolverComandoAlias } = require("../intent_classifier");
const H = require("../consultas/legacy_helpers");

/** PASO 12: capa ejecutable única para comandos (inyecta deps vía helpers). */
const ejecutarComandoYHumanizar = (args) => H.ejecutarComandoYHumanizar(args);

const normalizarTextoComando = (texto = "") =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

async function ejecutarComandoPlan({ textoPregunta, comandoAlias, usuario, numeroWhatsapp }) {
  if (
    !["QUIERO PLAN GRATIS", "QUIERO PLAN BASICO", "QUIERO PLAN PRO"].includes(comandoAlias)
  ) {
    return null;
  }
  if (!usuario?.id) {
    return "Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.";
  }
  const { actualizarPlanPorWhatsapp } = require("../planes");
  const objetivo = comandoAlias.endsWith("PRO") ? "pro" : comandoAlias.endsWith("BASICO") ? "basico" : "gratis";
  let outPlan = "";
  if (["basico", "pro"].includes(objetivo)) {
    try {
      const { crearLinkSuscripcionParaUsuario } = require("../mercado_pago");
      const pago = await crearLinkSuscripcionParaUsuario({
        whatsapp: numeroWhatsapp,
        planObjetivo: objetivo,
      });
      outPlan = [
        `Perfecto. Para activar *${String(pago.planNombre || objetivo).toUpperCase()}* completá la suscripción acá:`,
        `${pago.initPoint}`,
        "",
        "Cuando Mercado Pago confirme el cobro, te activo el plan automáticamente por webhook.",
      ].join("\n");
    } catch (error) {
      outPlan =
        "Ahora mismo no pude generar el link de pago 😓. Intentá de nuevo en unos minutos o avisame así lo revisamos.";
    }
  } else {
    const { cancelarSuscripcionMpPorWhatsapp } = require("../mercado_pago");
    const cancel = await cancelarSuscripcionMpPorWhatsapp({
      whatsapp: numeroWhatsapp,
    });
    const actualizado = await actualizarPlanPorWhatsapp({ whatsapp: numeroWhatsapp, plan: objetivo });
    const txtPlan = String(actualizado?.plan || objetivo).toUpperCase();
    if (cancel?.cancelledInMp) {
      outPlan = [
        `✅ Plan actualizado: *${txtPlan}*.`,
        "Tu suscripción de Mercado Pago quedó cancelada correctamente.",
        "Podés verificarlo en tu cuenta de Mercado Pago > Suscripciones.",
        "Incluye resumen semanal y consultas limitadas.",
      ].join("\n");
    } else if (cancel?.reason === "sin_suscripcion_activa") {
      outPlan = `✅ Plan actualizado: *${txtPlan}*.\nNo encontré una suscripción activa en MP para cancelar.\nSi querés, podés verificarlo en Mercado Pago > Suscripciones.\nIncluye resumen semanal y consultas limitadas.`;
    } else if (cancel?.reason === "usuario_no_encontrado") {
      outPlan = `✅ Plan actualizado: *${txtPlan}*.\nNo pude validar el usuario para cancelar MP, pero tu plan ya quedó en Gratis.`;
    } else {
      outPlan = `✅ Plan actualizado: *${txtPlan}*.\nNo pude confirmar la cancelación automática en MP ahora.\nSi querés, te paso el paso a paso para cancelarla manualmente en Mercado Pago.`;
    }
  }
  return outPlan;
}

const mapaHeurAComando = {
  "MI RESUMEN": "MI_RESUMEN",
  "MIS ALERTAS": "MIS_ALERTAS",
  "MI MARGEN": "MI_MARGEN",
  "__ALERTA__": "CREAR_ALERTA",
  "__GASTO__": "REGISTRAR_GASTO",
  "__VENTA__": "REGISTRAR_VENTA",
  "MI PLAN": "PLANES",
};

const rutaComando = async ({ clasificacion, mensaje, usuario, numeroWhatsapp }) => {
  const textoPregunta = String(mensaje || "").trim();
  const u = textoPregunta.toUpperCase();

  const comandoIa = clasificacion?.comandoIa;
  if (comandoIa?.comando) {
    let salida = await H.ejecutarComandoYHumanizar({
      comando: comandoIa.comando,
      parametros: comandoIa.parametros || {},
      usuario,
      numeroWhatsapp,
      textoOriginal: textoPregunta,
    });
    if (salida) {
      const nivel = H.detectarNivelUsuarioConsulta(textoPregunta);
      salida =
        nivel === "SIMPLE"
          ? H.compactarRespuestaSimple(H.sanitizarPlaceholders(String(salida)), 12)
          : H.sanitizarPlaceholders(String(salida));
      return salida;
    }
  }

  const comandoAlias = resolverComandoAlias(normalizarTextoComando(textoPregunta));
  const heurFirst = inferirComandoNatural(textoPregunta);
  const planAlias = ["QUIERO PLAN GRATIS", "QUIERO PLAN BASICO", "QUIERO PLAN PRO"].includes(
    String(heurFirst || "").toUpperCase()
  )
    ? String(heurFirst).toUpperCase()
    : ["QUIERO PLAN GRATIS", "QUIERO PLAN BASICO", "QUIERO PLAN PRO"].includes(comandoAlias)
    ? comandoAlias
    : null;

  if (planAlias) {
    const planOut = await ejecutarComandoPlan({
      textoPregunta,
      comandoAlias: planAlias,
      usuario,
      numeroWhatsapp,
    });
    if (planOut) return planOut;
  }

  if (/\bMI\s+RESUMEN\b/.test(u)) {
    const s = await H.ejecutarComandoYHumanizar({
      comando: "MI_RESUMEN",
      parametros: {},
      usuario,
      numeroWhatsapp,
      textoOriginal: textoPregunta,
    });
    if (s) return s;
  }
  if (/\bMIS\s+ALERTAS\b/.test(u)) {
    const s = await H.ejecutarComandoYHumanizar({
      comando: "MIS_ALERTAS",
      parametros: {},
      usuario,
      numeroWhatsapp,
      textoOriginal: textoPregunta,
    });
    if (s) return s;
  }
  if (/\bMI\s+MARGEN\b/.test(u)) {
    const s = await H.ejecutarComandoYHumanizar({
      comando: "MI_MARGEN",
      parametros: {},
      usuario,
      numeroWhatsapp,
      textoOriginal: textoPregunta,
    });
    if (s) return s;
  }
  if (/\bVER\s+COMANDOS\b/.test(u)) {
    return [
      "*Comandos útiles*",
      "• *MI RESUMEN* — panorama de tu situación",
      "• *MIS ALERTAS* — alertas de precio",
      "• *MI MARGEN* — gastos y ventas del mes",
      "• *PLANES* — opciones de plan",
      "",
      "También podés escribir en lenguaje natural (ej. «avisame cuando la soja supere X»).",
    ].join("\n");
  }

  if (/\bPLANES\b/.test(u)) {
    const s = await H.ejecutarComandoYHumanizar({
      comando: "PLANES",
      parametros: {},
      usuario,
      numeroWhatsapp,
      textoOriginal: textoPregunta,
    });
    if (s) return s;
  }

  const heur = inferirComandoNatural(textoPregunta);
  const comando = mapaHeurAComando[heur];
  if (comando) {
    const salida = await H.ejecutarComandoYHumanizar({
      comando,
      parametros: {},
      usuario,
      numeroWhatsapp,
      textoOriginal: textoPregunta,
    });
    if (salida) {
      const nivel = H.detectarNivelUsuarioConsulta(textoPregunta);
      return nivel === "SIMPLE"
        ? H.compactarRespuestaSimple(H.sanitizarPlaceholders(salida), 8)
        : H.sanitizarPlaceholders(salida);
    }
  }

  return "No reconocí el comando. Escribí *VER COMANDOS* para ver la lista.";
};

module.exports = { rutaComando, ejecutarComandoYHumanizar };
