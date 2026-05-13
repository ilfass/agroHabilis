"use strict";

const { inferirComandoNatural, resolverComandoAlias } = require("../intent_classifier");
const H = require("../consultas/legacy_helpers");
const { hayProveedorIa, ejecutarJsonConCadenaIA } = require("../agent/ia/json_chain");
/**
 * Fallback conversacional cuando el clasificador marca `intencion=comando`
 * pero ningún match concreto cae. Antes acá había un mensaje rígido tipo
 * "No reconocí el comando" que generaba respuestas tipo robot. Ahora
 * delegamos al pipeline general para que el LLM responda en forma
 * natural y proponga alternativas — mucho más agente, menos chatbot.
 *
 * Lo lazy-require-amos para no romper el ciclo de carga (router.js ya
 * importa este módulo).
 */
const fallbackConversacional = (args) =>
  require("./agro_general").rutaAgroGeneral(args);

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

const comandoEsSensible = (cmd = "") =>
  new Set(["REGISTRAR_GASTO", "REGISTRAR_VENTA", "CREAR_ALERTA"]).has(String(cmd || "").trim());

const pushGateTrace = (clasificacion, evento) => {
  if (!clasificacion || typeof clasificacion !== "object") return;
  const arr = Array.isArray(clasificacion.agentGateTrace) ? clasificacion.agentGateTrace : [];
  arr.push({
    etapa: "agent_gate_comando",
    ...evento,
  });
  clasificacion.agentGateTrace = arr.slice(-20);
};

const validarSenalComandoLocal = (cmd = "", texto = "") => {
  const t = String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (cmd === "REGISTRAR_GASTO") {
    const ok = /\b(gaste|compre|gasto|compra)\b/.test(t) && /\d/.test(texto);
    return { ok, faltantes: ok ? [] : ["monto o concepto de gasto"] };
  }
  if (cmd === "REGISTRAR_VENTA") {
    const ok = /\b(vendi|venta)\b/.test(t) && /\d/.test(texto);
    return { ok, faltantes: ok ? [] : ["cantidad o monto de venta"] };
  }
  if (cmd === "CREAR_ALERTA") {
    const ok = /\d/.test(texto) && /\b(alerta|avisame|avisa|cuando)\b/i.test(texto);
    return { ok, faltantes: ok ? [] : ["umbral numérico y condición de alerta"] };
  }
  return { ok: true, faltantes: [] };
};

const gatearComandoAntesDeEjecutar = async ({ comando, textoPregunta, clasificacion }) => {
  const cmd = String(comando || "").trim();
  if (!comandoEsSensible(cmd)) return { decision: "ejecutar", comando: cmd };

  const v = validarSenalComandoLocal(cmd, textoPregunta);
  if (v.ok) {
    pushGateTrace(clasificacion, {
      ok: true,
      via: "validacion_local",
      comando_candidato: cmd,
      decision: "ejecutar",
    });
    return { decision: "ejecutar", comando: cmd };
  }

  if (!hayProveedorIa()) {
    pushGateTrace(clasificacion, {
      ok: false,
      via: "validacion_local_sin_ia",
      comando_candidato: cmd,
      decision: "aclarar",
      faltantes: v.faltantes,
    });
    return {
      decision: "aclarar",
      repregunta: `Para continuar me falta: ${v.faltantes.join(", ")}. Pasamelo en una línea y lo ejecuto.`,
    };
  }

  const system = [
    "Sos un guardrail de comandos en AgroHabilis (WhatsApp).",
    "Te llega un comando sensible candidato y el texto del usuario.",
    "Decidí si se puede ejecutar ya o si hay que pedir aclaración.",
    "Respondé SOLO JSON válido:",
    '{"decision":"ejecutar|aclarar","comando_final":"REGISTRAR_GASTO|REGISTRAR_VENTA|CREAR_ALERTA","repregunta":"string","confianza":0.0}',
    "Reglas:",
    "- ejecutar solo si hay datos operativos suficientes en este mensaje.",
    "- si no alcanza, usar aclarar y escribir repregunta breve (voseo).",
    "- no inventes montos, categorías ni condiciones.",
  ].join(" ");
  const user = [`Comando candidato: ${cmd}`, `Mensaje: ${textoPregunta}`].join("\n");
  try {
    const out = await ejecutarJsonConCadenaIA({
      system,
      user,
      maxTokens: Number(process.env.COMANDO_GATE_MAX_TOKENS || 140),
      contextLabel: "IA.comando_gate",
      orderEnvVar: "COMANDO_GATE_IA_ORDER",
    });
    const parsed = out?.parsed || {};
    const decision = String(parsed?.decision || "aclarar").trim().toLowerCase();
    const comandoFinal = String(parsed?.comando_final || cmd).trim();
    const confianzaRaw = Number(parsed?.confianza);
    const confianza = Number.isFinite(confianzaRaw) ? Math.max(0, Math.min(1, confianzaRaw)) : null;
    if (decision === "ejecutar" && comandoEsSensible(comandoFinal)) {
      const v2 = validarSenalComandoLocal(comandoFinal, textoPregunta);
      if (v2.ok) {
        pushGateTrace(clasificacion, {
          ok: true,
          via: "ia_gate",
          provider: out?.providerUsed || null,
          model: out?.model || null,
          provider_trace: out?.trace || [],
          comando_candidato: cmd,
          comando_final: comandoFinal,
          decision: "ejecutar",
          confianza,
        });
        return { decision: "ejecutar", comando: comandoFinal };
      }
    }
    pushGateTrace(clasificacion, {
      ok: false,
      via: "ia_gate",
      provider: out?.providerUsed || null,
      model: out?.model || null,
      provider_trace: out?.trace || [],
      comando_candidato: cmd,
      comando_final: comandoFinal || cmd,
      decision: "aclarar",
      confianza,
    });
    return {
      decision: "aclarar",
      repregunta:
        String(parsed?.repregunta || "").trim() ||
        `Para ejecutar ${cmd} me faltan datos concretos. Mandamelo en una línea con número y detalle.`,
    };
  } catch (_e) {
    pushGateTrace(clasificacion, {
      ok: false,
      via: "ia_gate_error",
      comando_candidato: cmd,
      decision: "aclarar",
      faltantes: v.faltantes,
    });
    return {
      decision: "aclarar",
      repregunta: `Para continuar me falta: ${v.faltantes.join(", ")}. Pasamelo en una línea y lo ejecuto.`,
    };
  }
};

const rutaComando = async ({ clasificacion, mensaje, usuario, numeroWhatsapp }) => {
  const textoPregunta = String(mensaje || "").trim();
  const u = textoPregunta.toUpperCase();

  const comandoIa = clasificacion?.comandoIa;
  if (comandoIa?.comando) {
    const gate = await gatearComandoAntesDeEjecutar({
      comando: comandoIa.comando,
      textoPregunta,
      clasificacion,
    });
    if (gate?.decision === "aclarar" && gate?.repregunta) return gate.repregunta;
    let salida = await H.ejecutarComandoYHumanizar({
      comando: gate?.comando || comandoIa.comando,
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
    const gate = await gatearComandoAntesDeEjecutar({
      comando,
      textoPregunta,
      clasificacion,
    });
    if (gate?.decision === "aclarar" && gate?.repregunta) return gate.repregunta;
    const salida = await H.ejecutarComandoYHumanizar({
      comando: gate?.comando || comando,
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

  /**
   * No matcheamos ningún comando concreto. Antes acá devolvíamos
   * "No reconocí el comando. Escribí VER COMANDOS para ver la lista."
   * — pero eso aplicaba a CUALQUIER mensaje que el clasificador hubiera
   * marcado como `intencion=comando` (incluso preguntas conversacionales
   * legítimas como "Sos un agente?", "De qué trata?", "Quiero saber si...").
   *
   * Resultado: el bot quedaba "rígido como chatbot" — exactamente la
   * crítica del productor (sesión 2026-05-12).
   *
   * Ahora, en lugar de cortar con un mensaje rígido, delegamos al
   * pipeline conversacional general (rutaAgroGeneral → LLM en modo
   * agro). El LLM puede responder de forma natural y, si conviene,
   * sugerir comandos suavemente.
   */
  try {
    return await fallbackConversacional({ clasificacion, mensaje, usuario });
  } catch (e) {
    /** Último recurso si rutaAgroGeneral falla: un fallback amable. */
    console.warn("[rutaComando] fallback conversacional falló:", e?.message || e);
    return (
      "Te leí, pero no estoy del todo seguro de qué necesitás. " +
      "¿Querés que te ayude con precios, clima, registro de inventario o análisis? " +
      "También podés escribir *VER COMANDOS* para ver todo lo que puedo hacer."
    );
  }
};

module.exports = { rutaComando, ejecutarComandoYHumanizar };
