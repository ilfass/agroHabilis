"use strict";

/**
 * # TurnController — controlador centralizado del turno
 *
 * **Estado actual: ESQUELETO / WORK-IN-PROGRESS, NO ENCHUFADO.**
 *
 * Hoy `src/config/whatsapp.js > procesarMensajeEntranteWhatsapp` tiene ~900
 * líneas de `if/else/return` que dispatchan a cada flujo y comando. El objetivo
 * de este módulo es ser el único lugar donde se decide *qué hacer con un
 * mensaje*, en una **cadena de prioridades explícita**.
 *
 * Cuando se migre, `whatsapp.js > procesarMensajeEntranteWhatsapp` debería
 * quedar reducido a:
 *
 * ```js
 * const ctx = await TurnController.buildContext({ msg, planCtx, ... });
 * const out = await TurnController.run(ctx);
 * if (out?.respuesta) await msg.reply(out.respuesta);
 * ```
 *
 * Para el plan de migración, ver `docs/operacion/turn-controller-propuesta.md`.
 *
 * ## Cadena de decisión (orden estricto, primero gana)
 *
 *  1. `cmd_bot_control`       — `PAUSAR BOT`, `ACTIVAR BOT`, `ESTADO BOT`.
 *  2. `onboarding`            — el productor está siendo dado de alta.
 *  3. `resumen_interactivo`   — está en flujo de resumen guiado (con escape
 *                                 por intent fuerte, ya implementado en P0#1).
 *  4. `inventario_pendiente`  — hay borrador esperando SI/NO (incluye cola
 *                                 multi-lote).
 *  5. `cmd_cambio_plan`       — QUIERO PLAN { GRATIS | BASICO | PRO }, o email
 *                                 solo línea cuando el flujo lo pide.
 *  6. `cmd_perfil_directo`    — MI NOMBRE / MI EMAIL / MI ZONA / MIS CULTIVOS
 *                                 / MI GANADO / VER MI PERFIL / MI PERFIL MIXTO.
 *  7. `cmd_borrar_cuenta`     — BORRAR MIS DATOS + confirmación.
 *  8. `cmd_completar_perfil`  — COMPLETAR PERFIL y su flujo paso a paso.
 *  9. `cmd_admin`             — ESTADO, USUARIOS, FUENTES, RESET ONBOARDING.
 * 10. `cmd_alertas`           — ALERTA / AVISAME / MIS ALERTAS / CANCELAR ALERTA.
 * 11. `cmd_finanzas`          — GASTÉ / COMPRÉ / VENDÍ / MIS GASTOS / MIS VENTAS
 *                                 / MI MARGEN.
 * 12. `cmd_resumen`           — MI RESUMEN (inicia el resumen interactivo).
 * 13. `cmd_flete`             — FLETE X A Y.
 * 14. `strict_suggestion`     — parece comando pero no encajó → sugerir VER COMANDOS.
 * 15. `bot_pausado`           — chat con bot pausado: solo PAUSAR/ACTIVAR.
 * 16. `cupo_excedido`         — cupo mensual agotado en plan Gratis.
 * 17. `pipeline_agente`       — clasificador → refuerzos → gates → scout →
 *                                 OAV → router. (Lo que ya hace
 *                                 `agent/pipeline/consulta_whatsapp.js`.)
 *
 * ## Reglas transversales (cross-cutting)
 *
 * - **Cualquier handler de prioridad ≤ 4** puede pedir "ceder turno": el
 *   resumen interactivo ya lo hace (P0#1) cuando detecta intent fuerte.
 *   Generalizamos esa señal con `cederTurno: true`.
 * - **Onboarding tiene prioridad absoluta** salvo para admin.
 * - **Cmd de control de bot** se evalúa siempre, incluso si bot está pausado.
 * - **Captura de interacciones** (in/out) debe pasar por un wrapper común
 *   (`msg.reply` envuelto) que se setea en `buildContext`.
 *
 * ## Beneficios esperados
 *
 *  - Un solo punto para auditar el orden de decisiones.
 *  - Tests unitarios por handler (mockeando dependencias).
 *  - Trazabilidad: cada turno reporta qué handler lo manejó (`turnTrace`).
 *  - Menos riesgo de "este `return` se le adelanta a este otro".
 *
 * ## Lo que NO cambia
 *
 *  - La lógica de cada flujo individual (onboarding, inventario, plan, etc.)
 *    se mueve TAL CUAL desde whatsapp.js. Esto es refactor de *orquestación*,
 *    no de reglas de negocio.
 */

/**
 * @typedef {Object} TurnContext
 * @property {string} jid                Identificador WhatsApp del chat (msg.from).
 * @property {string} numeroNormalizado  whatsapp normalizado a digit-only.
 * @property {string} consulta           Texto del mensaje del usuario.
 * @property {string} comandoUpper       `consulta` normalizado con NFD y uppercase.
 * @property {string} comandoAlias       Resolución de alias (whatsapp_intents).
 * @property {Object|null} planCtx       Plan + usuario actual (obtenerContextoPlanPorWhatsapp).
 * @property {Object} replyContexto      Mutable: { intencionTipo } para humanizar salida.
 * @property {Function} reply            `msg.reply` envuelto (con humanización + captura).
 * @property {Function} replySinIA       reply sin humanización (para datos críticos).
 * @property {Function} send             client.sendMessage(jid, texto) sin formateo extra.
 * @property {Function} emitCaptura      Registra captura de salida (in/out audit log).
 * @property {boolean} esAdmin           Si el JID está en WHATSAPP_ADMIN_NUMBERS.
 * @property {Object} flags              { asyncCola, ... } leídos de env.
 */

/**
 * @typedef {Object} TurnHandlerResult
 * @property {boolean} manejado          Si este handler resolvió el turno.
 * @property {string} [respuesta]        Texto a responder (si aplica).
 * @property {boolean} [cederTurno]      Si el handler decidió ceder turno al siguiente.
 * @property {string} [route]            Etiqueta para logRoute.
 * @property {Object} [extraLog]         Datos para el log de ruta.
 */

/**
 * Firma común de un handler.
 * @typedef {(ctx: TurnContext) => Promise<TurnHandlerResult>} TurnHandler
 */

/**
 * Registro ordenado de handlers. Cada uno se llama en orden hasta que uno
 * devuelva `manejado: true` y `cederTurno != true`.
 *
 * MIGRACIÓN: por ahora cada `fn` es `null`. A medida que migremos un flujo
 * desde `whatsapp.js`, se llena con la función real y se va sacando código
 * de `whatsapp.js`. Ver propuesta en docs/operacion/turn-controller-propuesta.md.
 *
 * @type {{ id: string, fn: TurnHandler | null, descripcion: string }[]}
 */
const REGISTRO_HANDLERS = [
  { id: "cmd_bot_control", fn: null, descripcion: "PAUSAR/ACTIVAR/ESTADO BOT" },
  { id: "onboarding", fn: null, descripcion: "Productor en alta inicial" },
  { id: "resumen_interactivo", fn: null, descripcion: "Flujo guiado resumen (P0#1)" },
  { id: "inventario_pendiente", fn: null, descripcion: "Borrador esperando SI/NO" },
  { id: "cmd_cambio_plan", fn: null, descripcion: "QUIERO PLAN { gratis | basico | pro }" },
  { id: "cmd_perfil_directo", fn: null, descripcion: "MI NOMBRE/EMAIL/ZONA/CULTIVOS/GANADO" },
  { id: "cmd_borrar_cuenta", fn: null, descripcion: "BORRAR MIS DATOS + confirmación" },
  { id: "cmd_completar_perfil", fn: null, descripcion: "COMPLETAR PERFIL paso a paso" },
  { id: "cmd_admin", fn: null, descripcion: "ESTADO/USUARIOS/FUENTES/RESET ONBOARDING" },
  { id: "cmd_alertas", fn: null, descripcion: "ALERTA/AVISAME/MIS ALERTAS/CANCELAR" },
  { id: "cmd_finanzas", fn: null, descripcion: "GASTÉ/COMPRÉ/VENDÍ/MIS GASTOS/VENTAS/MARGEN" },
  { id: "cmd_resumen", fn: null, descripcion: "MI RESUMEN (inicia interactivo)" },
  { id: "cmd_flete", fn: null, descripcion: "FLETE X A Y" },
  { id: "strict_suggestion", fn: null, descripcion: "Sugerir VER COMANDOS si parece cmd" },
  { id: "bot_pausado", fn: null, descripcion: "Chat con bot pausado" },
  { id: "cupo_excedido", fn: null, descripcion: "Cupo mensual agotado plan gratis" },
  { id: "pipeline_agente", fn: null, descripcion: "Clasificador → router (agent pipeline)" },
];

/**
 * Ejecuta el turno: itera handlers en orden, devuelve el primero que maneja.
 *
 * Aún NO usado en producción. Cuando se enchufe en `whatsapp.js`, se hará
 * detrás de un feature flag (`AGENT_TURN_CONTROLLER=1`) para A/B test.
 *
 * @param {TurnContext} ctx
 * @returns {Promise<TurnHandlerResult & { turnTrace: { id: string, ms: number }[] }>}
 */
async function ejecutarTurno(ctx) {
  const trace = [];
  for (const h of REGISTRO_HANDLERS) {
    if (typeof h.fn !== "function") continue;
    const t0 = Date.now();
    let r;
    try {
      r = await h.fn(ctx);
    } catch (e) {
      r = { manejado: false, _error: String(e?.message || e) };
    }
    trace.push({ id: h.id, ms: Date.now() - t0, _error: r?._error });
    if (r?.manejado && !r?.cederTurno) {
      return { ...r, turnTrace: trace };
    }
  }
  return { manejado: false, turnTrace: trace };
}

/**
 * Registra (o reemplaza) un handler. Útil para tests y para que cada flujo
 * se "auto-registre" desde su módulo en vez de centralizar imports.
 *
 * @param {string} id
 * @param {TurnHandler} fn
 */
function registrarHandler(id, fn) {
  const entry = REGISTRO_HANDLERS.find((h) => h.id === id);
  if (!entry) throw new Error(`TurnController: handler desconocido "${id}"`);
  if (typeof fn !== "function") throw new Error(`TurnController: handler "${id}" requiere función`);
  entry.fn = fn;
}

/**
 * Devuelve el listado de handlers (orden + descripción) para diagnóstico.
 */
function listarHandlers() {
  return REGISTRO_HANDLERS.map((h, i) => ({
    orden: i + 1,
    id: h.id,
    descripcion: h.descripcion,
    enchufado: typeof h.fn === "function",
  }));
}

/**
 * Lee el flag global del controlador. Aceptamos varias formas para tolerancia
 * a typos al setearlo en el VPS:
 *   AGENT_TURN_CONTROLLER=1 | true | on | yes
 */
function turnControllerActivo() {
  const v = String(process.env.AGENT_TURN_CONTROLLER ?? "").trim().toLowerCase();
  return ["1", "true", "on", "yes"].includes(v);
}

/**
 * Whitelist explícita: solo se ejecutan los handlers indicados (coma-separados).
 * Si está vacía, se ejecutan TODOS los enchufados.
 *
 * Ej: `AGENT_TURN_CONTROLLER_HANDLERS=cmd_flete,cmd_resumen`
 */
function handlersHabilitados() {
  const raw = String(process.env.AGENT_TURN_CONTROLLER_HANDLERS || "").trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Punto de entrada principal del controlador (lo que `whatsapp.js` debería
 * llamar). Combina:
 *   1) chequeo de flag global,
 *   2) whitelist por handler,
 *   3) ejecución ordenada con `ejecutarTurno`.
 *
 * Devuelve `{ manejado: false, ... }` si el flag está apagado o si ningún
 * handler resolvió el turno. **Cuando devuelve `manejado: false`, el caller
 * debe seguir con el código viejo (fallback)** — eso garantiza que la
 * migración sea reversible: con flag OFF, comportamiento idéntico al
 * actual.
 *
 * @param {TurnContext} ctx
 * @returns {Promise<TurnHandlerResult & { turnTrace: any[], skipMotivo?: string }>}
 */
async function run(ctx) {
  if (!turnControllerActivo()) {
    return { manejado: false, turnTrace: [], skipMotivo: "flag_off" };
  }
  const whitelist = handlersHabilitados();
  if (whitelist && whitelist.size === 0) {
    return { manejado: false, turnTrace: [], skipMotivo: "whitelist_vacia" };
  }
  /** Filtramos el registro respetando el orden original. */
  const previo = REGISTRO_HANDLERS.map((h) => h);
  if (whitelist) {
    /** Mutación local: clonamos para no tocar el array module-level. */
    const filtrado = previo.map((h) =>
      whitelist.has(h.id) ? h : { ...h, fn: null }
    );
    return ejecutarTurnoSobre(filtrado, ctx);
  }
  return ejecutarTurno(ctx);
}

/**
 * Variante de `ejecutarTurno` que opera sobre un array filtrado.
 * @param {{ id: string, fn: TurnHandler | null }[]} handlers
 * @param {TurnContext} ctx
 */
async function ejecutarTurnoSobre(handlers, ctx) {
  const trace = [];
  for (const h of handlers) {
    if (typeof h.fn !== "function") continue;
    const t0 = Date.now();
    let r;
    try {
      r = await h.fn(ctx);
    } catch (e) {
      r = { manejado: false, _error: String(e?.message || e) };
    }
    trace.push({ id: h.id, ms: Date.now() - t0, _error: r?._error });
    if (r?.manejado && !r?.cederTurno) {
      return { ...r, turnTrace: trace };
    }
  }
  return { manejado: false, turnTrace: trace };
}

module.exports = {
  ejecutarTurno,
  registrarHandler,
  listarHandlers,
  turnControllerActivo,
  handlersHabilitados,
  run,
  REGISTRO_HANDLERS,
};
