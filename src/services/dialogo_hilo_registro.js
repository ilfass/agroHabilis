"use strict";

/**
 * Antes de ejecutar rutas que pueden confundir meta-intención con gasto/registro concreto:
 * 1) Empaqueta hechos verificables (perfil, lotes, saldos) — como "mirar la base".
 * 2) Dos pasadas de IA: extracción de hechos del mensaje → decisión JSON.
 * 3) Sin atajos regex: la decisión viene del modelo (no `tieneSenalOperativaClara`).
 *
 * Historial en `historial_consultas` mantiene el hilo; sin fila extra en conversacion_estado.
 *
 * Cadena de IA: delegada a `runProviderChain` con `DIALOGO_HILO_IA_ORDER`.
 */

const { runProviderChain } = require("./gemini");
const { conciliarPorSeguridad, ejecutarPasoConTraza } = require("./agent/orchestration/pasos");
const {
  AGENT_PROMPT_VERSION,
  buildDialogoRegistroPaso1System,
  buildDialogoRegistroPaso2System,
  buildDialogoRegistroPlanSystem,
  buildDialogoRegistroPaso3System,
} = require("./agent/prompts/builders");
const {
  construirHistorialNaturalParaPlantilla,
  obtenerUltimasInteracciones,
} = require("./consultas/contexto");
const { normalizarWhatsapp } = require("../models/usuario");
const { listarLotesUsuario, listarSaldos } = require("./inventario/core");

const hayProveedorIaDialogoHilo = () =>
  Boolean(
    process.env.OPENROUTER_API_KEY?.trim() ||
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GROQ_API_KEY?.trim()
  );

const usarDosPasosIa = () => !["0", "false", "no"].includes(String(process.env.DIALOGO_HILO_DOS_PASOS || "1").trim().toLowerCase());

/**
 * @returns {Promise<{ texto: string, tokensUsados?: number|null, model?: string, providerUsed: string }>}
 */
const llamarCadenaDialogoHilo = async ({ system, user }, opts = {}) => {
  const maxTok = Number((opts.maxTokens != null ? opts.maxTokens : process.env.DIALOGO_HILO_MAX_TOKENS) || 220);
  const out = await runProviderChain({
    system: String(system || "").trim(),
    user: String(user || "").trim(),
    contextLabel: "IA.dialogo_hilo",
    opts: {
      maxOutputTokens: Math.max(64, Math.floor(maxTok)),
      temperature: 0,
      orderEnvVar: "DIALOGO_HILO_IA_ORDER",
    },
  });
  return { ...out, providerUsed: out.providerUsed || "unknown" };
};

const INTENCIONES_VALIDAS = new Set([
  "registrar",
  "consulta_registros",
  "agro_general",
  "precio",
  "analisis_mercado",
  "clima",
]);

const MENSAJE_AMBIGUEDAD_DEFAULT =
  "No termino de entender si querés que *registre* algo nuevo o que te *muestre* lo que ya figure en el sistema.\n" +
  "¿Cuál de las dos?\n" +
  "Si es alta: mandame *cabezas/hectáreas* por mensaje o un *gasto* tipo «gasté 50000 en semilla».";

const parseJsonObj = (textoBruto = "") => {
  const raw = String(textoBruto || "").trim();
  const sinFence = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = sinFence.indexOf("{");
  const end = sinFence.lastIndexOf("}");
  const jsonStr = start >= 0 && end > start ? sinFence.slice(start, end + 1) : sinFence;
  return JSON.parse(jsonStr);
};

/**
 * Lecturas mínimas de base (sin pasar por plantillas pesadas).
 */
const empaquetarContextoVerificable = async (usuario) => {
  if (!usuario?.id) {
    return "(sin usuario autenticado en esta sesión)";
  }
  const lineas = [];
  lineas.push(
    `- Perfil: ${String(usuario.nombre || "s/n").trim()}, plan ${String(usuario.plan || "gratis")}, ` +
      `zona ${String(usuario.provincia || "").trim()} / ${String(usuario.partido || "").trim() || "s/d"}.`
  );
  lineas.push(`- Flag tiene_datos (gastos/ventas/movimientos alguna vez): ${usuario.tiene_datos ? "sí" : "no"}.`);
  const cult = Array.isArray(usuario.cultivos) ? usuario.cultivos.map((c) => c.cultivo).filter(Boolean) : [];
  if (cult.length) lineas.push(`- Cultivos declarados: ${cult.slice(0, 12).join(", ")}.`);

  try {
    const lotes = await listarLotesUsuario(usuario.id);
    const nL = Array.isArray(lotes) ? lotes.length : 0;
    if (!nL) lineas.push("- Lotes en base: ninguno.");
    else {
      const nombres = lotes
        .slice(0, 10)
        .map((L) => String(L.nombre || `id:${L.id}`).trim())
        .join("; ");
      lineas.push(`- Lotes en base (${nL}): ${nombres}${nL > 10 ? "…" : ""}.`);
    }
  } catch (_e) {
    lineas.push("- Lotes: no pude leer ahora.");
  }

  try {
    const saldos = await listarSaldos({ usuarioId: usuario.id });
    const nS = Array.isArray(saldos) ? saldos.length : 0;
    if (!nS) lineas.push("- Stock inventario (saldo): sin líneas.");
    else {
      lineas.push(`- Stock inventario: ${nS} línea(s). Ejemplos:`);
      for (const s of saldos.slice(0, 6)) {
        const lab = [s.dominio, s.etiqueta || s.item_clave].filter(Boolean).join(" · ");
        lineas.push(`  · ${lab}: ${s.cantidad} ${s.unidad || ""}`.trim());
      }
      if (nS > 6) lineas.push("  …");
    }
  } catch (_e) {
    lineas.push("- Inventario saldos: no pude leer ahora.");
  }

  return lineas.join("\n").slice(0, 1400);
};

const systemPaso1 = buildDialogoRegistroPaso1System();
const systemPaso2 = buildDialogoRegistroPaso2System();
const systemPasoPlan = buildDialogoRegistroPlanSystem();
const systemPaso3 = buildDialogoRegistroPaso3System();

const normalizarSalidaDecision = (raw, analisisPaso1, mensaje) => {
  const parsed = raw && typeof raw === "object" ? raw : {};
  let decision = String(parsed?.decision || parsed?.decision_final || "proceder")
    .toLowerCase()
    .trim();
  const confRaw = Number(parsed?.confianza);
  const confianza =
    Number.isFinite(confRaw) && confRaw >= 0 ? Math.max(0, Math.min(1, confRaw)) : null;

  if (decision === "repreguntar") {
    const repregunta = String(parsed?.repregunta || "").trim() || MENSAJE_AMBIGUEDAD_DEFAULT;
    return {
      tipo: "repreguntar",
      repregunta,
      motivo: String(parsed?.motivo || "ambiguedad_o_falta_datos").trim() || "ambiguedad_o_falta_datos",
      confianza,
    };
  }

  if (decision === "reclasificar") {
    let nueva = String(parsed?.intencion_nueva || "").trim();
    if (!INTENCIONES_VALIDAS.has(nueva)) nueva = "agro_general";
    if (analisisPaso1 && String(analisisPaso1.tipo || "") === "consulta_datos_existentes") {
      nueva = "consulta_registros";
    }
    return {
      tipo: "reclasificar",
      intencion_nueva: nueva,
      motivo: String(parsed?.motivo || "reclasificacion_con_hilo").trim() || "reclasificacion_con_hilo",
      confianza,
    };
  }

  return {
    tipo: "proceder",
    motivo: String(parsed?.motivo || "senal_operativa_clara").trim() || "senal_operativa_clara",
    confianza,
  };
};

const prioridadSeguridadDecision = (salida = {}) => {
  const t = String(salida?.tipo || "");
  if (t === "repreguntar") return 3;
  if (t === "reclasificar") return 2;
  if (t === "proceder") return 1;
  return 0;
};

const normalizarPlan = (raw = {}) => {
  const p = raw && typeof raw === "object" ? raw : {};
  const accion = String(p.accion_objetivo || "").trim();
  const herramienta = String(p.herramienta_sugerida || "").trim();
  const args = Array.isArray(p.argumentos_minimos) ? p.argumentos_minimos.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const faltantes = Array.isArray(p.faltantes) ? p.faltantes.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const puede = Boolean(p.puede_proceder);
  const confianzaNum = Number(p.confianza);
  return {
    accion_objetivo: accion || "aclarar",
    herramienta_sugerida: herramienta || "repregunta",
    argumentos_minimos: args.slice(0, 8),
    faltantes: faltantes.slice(0, 8),
    puede_proceder: puede,
    confianza:
      Number.isFinite(confianzaNum) && confianzaNum >= 0
        ? Math.max(0, Math.min(1, confianzaNum))
        : 0.5,
  };
};

/**
 * @returns {Promise<null | { earlyReturn: boolean, texto?: string, clasificacionPatch?: object }>}
 */
async function evaluarHiloAntesDeRegistroOGasto({
  mensaje = "",
  usuarioId = null,
  usuario = null,
  numeroWhatsapp = "",
  clasificacion = {},
  historialPrecargado = null,
} = {}) {
  const trace = [];
  const intencion = String(clasificacion?.intencion || "");
  const cmd = clasificacion?.comandoIa?.comando ? String(clasificacion.comandoIa.comando) : "";

  const apuntaRegistroRouter = intencion === "registrar";
  const apuntaComandoGasto = intencion === "comando" && cmd === "REGISTRAR_GASTO";
  if (!apuntaRegistroRouter && !apuntaComandoGasto) return null;

  if (!hayProveedorIaDialogoHilo()) return null;

  const wa = normalizarWhatsapp(numeroWhatsapp);
  const uid = usuario?.id != null ? usuario.id : usuarioId;
  const filas = Array.isArray(historialPrecargado) && historialPrecargado.length
    ? historialPrecargado.slice(0, Number(process.env.DIALOGO_HILO_HISTORIAL_TURNS || 5) || 5)
    : await obtenerUltimasInteracciones({
        usuarioId: usuario?.es_delegado ? null : (uid || null),
        whatsapp: wa,
        limite: Number(process.env.DIALOGO_HILO_HISTORIAL_TURNS || 5) || 5,
      });
  const hilo = construirHistorialNaturalParaPlantilla(filas, 420);
  const msg = String(mensaje || "").trim().slice(0, 900);
  const pack = await empaquetarContextoVerificable(usuario && usuario.id ? usuario : { id: uid, tiene_datos: false });

  const userBase = [
    "### Contexto verificable (solo lectura; no inventar)",
    pack,
    "### Hilo reciente",
    hilo || "(sin historial reciente en base)",
    "### Mensaje nuevo",
    msg,
    "### Nota del pipeline",
    apuntaComandoGasto
      ? "Se disparó COMANDO REGISTRAR_GASTO; el texto puede no ser un gasto."
      : "La ruta previa fue `registrar`.",
  ].join("\n\n");

  let analisisPaso1 = null;
  let planPaso = null;
  const max1 = Number(process.env.DIALOGO_HILO_PASO1_MAX_TOKENS || 140);

  try {
    if (usarDosPasosIa()) {
      const p1 = await ejecutarPasoConTraza({
        etapa: "paso1",
        trace,
        warnLabel: process.env.NODE_ENV !== "test" ? "[dialogo_hilo_registro] paso 1 omitido" : null,
        loggerWarn: (m) => console.warn(m),
        ejecutar: async () => {
          const out = await llamarCadenaDialogoHilo({ system: systemPaso1, user: userBase }, { maxTokens: max1 });
          return { ...out, parsed: parseJsonObj(String(out?.texto || "").trim()) };
        },
        normalizar: (raw) => raw?.parsed || null,
      });
      analisisPaso1 = p1.ok ? p1.normalizado : null;
      if (p1.ok) {
        trace.push({ etapa: "paso1_detalle", ok: true, prompt_version: AGENT_PROMPT_VERSION, analisis: analisisPaso1 });
      }
    }

    const userPaso2 = usarDosPasosIa()
      ? [
          userBase,
          "### Análisis previo (etapa 1, JSON)",
          JSON.stringify(analisisPaso1 || {}),
        ].join("\n\n")
      : userBase;

    // Paso plan: qué herramienta usar y si se puede ejecutar ya.
    const pPlan = await ejecutarPasoConTraza({
      etapa: "paso_plan",
      trace,
      ejecutar: async () => {
        const out = await llamarCadenaDialogoHilo(
          { system: systemPasoPlan, user: userPaso2 },
          { maxTokens: Number(process.env.DIALOGO_HILO_PLAN_MAX_TOKENS || 170) }
        );
        return { ...out, parsed: parseJsonObj(String(out?.texto || "").trim()) };
      },
      normalizar: (raw) => normalizarPlan(raw?.parsed || {}),
    });
    planPaso = pPlan.ok ? pPlan.normalizado : null;
    if (pPlan.ok) trace.push({ etapa: "paso_plan_detalle", ok: true, prompt_version: AGENT_PROMPT_VERSION, plan: planPaso });

    const p2 = await ejecutarPasoConTraza({
      etapa: "paso2",
      trace,
      ejecutar: async () => {
        const out = await llamarCadenaDialogoHilo(
          { system: systemPaso2, user: userPaso2 },
          { maxTokens: Number(process.env.DIALOGO_HILO_MAX_TOKENS || 260) }
        );
        return { ...out, parsed: parseJsonObj(String(out?.texto || "").trim()) };
      },
      normalizar: (raw) => raw?.parsed || {},
    });
    if (!p2.ok) throw new Error(p2.error || "fallo paso2");
    const parsed = p2.normalizado || {};
    let salida = normalizarSalidaDecision(parsed, analisisPaso1, mensaje);

    // Atajo determinista: si el plan ya marca consulta de registros con alta confianza, reclasificar directo.
    if (
      planPaso &&
      planPaso.accion_objetivo === "consultar_registros" &&
      planPaso.confianza >= Number(process.env.DIALOGO_HILO_PLAN_CONF_ALTA || 0.75)
    ) {
      salida = {
        tipo: "reclasificar",
        intencion_nueva: "consulta_registros",
        motivo: "plan_alta_confianza_consulta_registros",
      };
    }

    // Guardrail planificador: si el plan dice que no se puede proceder, no permitir "proceder".
    if (salida.tipo === "proceder" && planPaso && !planPaso.puede_proceder) {
      salida = {
        tipo: "repreguntar",
        repregunta:
          `Para cargarlo bien me faltan: ${planPaso.faltantes.join(", ")}.\n` +
          "Mandamelo en una sola línea y lo registro.",
        motivo: "planificador_detecto_faltantes",
      };
    }

    // Paso 3: autocheck IA adicional antes de aceptar la decisión.
    if (!["0", "false", "no"].includes(String(process.env.DIALOGO_HILO_AUTOCHECK || "1").trim().toLowerCase())) {
      try {
        const userPaso3 = [
          userBase,
          "### Analisis etapa 1",
          JSON.stringify(analisisPaso1 || {}),
          "### Decision candidata etapa 2",
          JSON.stringify(parsed || {}),
        ].join("\n\n");
        const p3 = await ejecutarPasoConTraza({
          etapa: "paso3_autocheck",
          trace,
          ejecutar: async () => {
            const out = await llamarCadenaDialogoHilo(
              { system: systemPaso3, user: userPaso3 },
              { maxTokens: Number(process.env.DIALOGO_HILO_PASO3_MAX_TOKENS || 180) }
            );
            return { ...out, parsed: parseJsonObj(String(out?.texto || "").trim()) };
          },
          normalizar: (raw) => raw?.parsed || {},
        });
        if (!p3.ok) throw new Error(p3.error || "fallo paso3");
        const parsed3 = p3.normalizado || {};
        const salidaPaso3 = normalizarSalidaDecision(parsed3, analisisPaso1, mensaje);
        trace.push({ etapa: "paso3_detalle", ok: true, prompt_version: AGENT_PROMPT_VERSION, salida_normalizada: salidaPaso3 });
        const conciliada = conciliarPorSeguridad({
          primaria: salida,
          critic: salidaPaso3,
          prioridadFn: prioridadSeguridadDecision,
          preferir: "critic",
        });
        salida = conciliada.salida;
        if (conciliada.desacuerdo) {
          trace.push({
            etapa: "critic_loop",
            ok: true,
            prompt_version: AGENT_PROMPT_VERSION,
            tipo: "desacuerdo_paso2_paso3",
            salida_elegida: salida,
          });
        }
      } catch (e3) {
        if (process.env.NODE_ENV !== "test") {
          console.warn("[dialogo_hilo_registro] paso 3 omitido:", e3.message);
        }
        trace.push({ etapa: "paso3_autocheck", ok: false, error: String(e3?.message || e3) });
      }
    }
    trace.push({
      etapa: "decision_final",
      ok: true,
      prompt_version: AGENT_PROMPT_VERSION,
      decision: salida?.tipo || null,
      motivo: salida?.motivo || null,
      intencion_nueva: salida?.intencion_nueva || null,
      planificador: planPaso || null,
    });

    if (salida.tipo === "proceder") {
      return {
        earlyReturn: false,
        debug: { trace, decisionFinal: salida },
      };
    }

    if (salida.tipo === "repreguntar") {
      return {
        earlyReturn: true,
        texto: salida.repregunta,
        debug: { trace, decisionFinal: salida },
      };
    }

    if (salida.tipo === "reclasificar") {
      return {
        earlyReturn: false,
        clasificacionPatch: {
          intencion: salida.intencion_nueva,
          comandoIa: null,
          confianza: "media",
        },
        debug: { trace, decisionFinal: salida },
      };
    }
  } catch (e) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[dialogo_hilo_registro] cadena IA / JSON omitido:", e.message);
    }
    trace.push({
      etapa: "error_general",
      ok: false,
      error: String(e?.message || e),
    });
  }
  return null;
}

module.exports = {
  evaluarHiloAntesDeRegistroOGasto,
  llamarCadenaDialogoHilo,
  empaquetarContextoVerificable,
};
