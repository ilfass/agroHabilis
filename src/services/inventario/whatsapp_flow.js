"use strict";

/**
 * # WhatsApp inventory flow — rol en la arquitectura de agente
 *
 * Esta capa es la **state-machine mínima** alrededor de operaciones que
 * **requieren confirmación humana explícita** (`SI` / `NO`). NO es un
 * sustituto del LLM: convive con él.
 *
 * ¿Por qué no dejar al LLM hacerlo todo libremente?
 *
 *  - El productor manda «4 novillos en lote 9» a las 23:50 y queda dormido.
 *    Si lo guardamos sin pedir SÍ, no hay vuelta atrás.
 *  - Multi-lote: «Lote 2b 60 vaq, Lote 4 100 vaq, Lote 6 106 vacas»
 *    requiere preguntar lote por lote (no se confirma en bloque ciegamente).
 *  - Confirmaciones sobreviven entre turnos en `conversacion_estado` para
 *    que el productor pueda contestar `SI` 5 minutos después sin perder
 *    el contexto.
 *
 * El LLM trabaja en dos lugares dentro de este flow:
 *
 *   1) `borradorRegistroDesdeLlm` y `interpretarInventarioAgenteWhatsApp`
 *      en `nl_llm.js`: interpretan mensajes libres ("puse algunos animales
 *      en el norte") cuando la heurística no llega.
 *
 *   2) `agent/ia/tool_loop_scout` (corre ANTES de esta capa, en el pipeline):
 *      decide si el mensaje es inventario o no consultando lotes/saldos.
 *
 * Esta capa solo:
 *   a) Detecta intent inventario (registro / consulta / multi-lote / ambiguo).
 *   b) Crea borrador pendiente que pide confirmación.
 *   c) Procesa SI/NO y maneja la cola multi-lote.
 *
 * Cada rama está documentada en su sitio.
 */

const {
  obtenerPendiente,
  crearRegistroPendiente,
  confirmarMovimientoPorId,
  rechazarMovimientoPorId,
  listarSaldos,
  listarLotesUsuario,
  crearLoteUsuario,
  listarCampanasUsuario,
  resolverLotePorNombre,
  resolverCampanaPorNombre,
  resumenMovimientoParaHumano,
} = require("./core");
const {
  construirBorradorRegistro,
  construirBorradorConsulta,
  parseIntentInventario,
  extraerHectareasDesdeTexto,
} = require("./nl_heuristica");
const {
  borradorRegistroDesdeLlm,
  interpretarInventarioAgenteWhatsApp,
  permiteIntentarLlmTrasFalloHeuristica,
  inventarioLlmHabilitado,
} = require("./nl_llm");
const conversacionEstadoService = require("../conversacion_estado");

/**
 * Cola de bloques pendientes cuando el usuario manda varios «Lote N» en un solo mensaje.
 * Se persiste en `conversacion_estado` para sobrevivir entre confirmación y confirmación.
 */
const FLUJO_COLA_MULTI_LOTE = "inventario_cola_lotes";
const HORAS_EXPIRACION_COLA_MULTI_LOTE = 2;

const normTxt = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const esAfirmacion = (t = "") => {
  const n = normTxt(t);
  return /^(si|s[ií]|ok|dale|sip|correcto|confirmo|guarda|guard[aá])\b/i.test(String(t || "").trim()) || ["SI"].includes(String(t || "").trim().toUpperCase());
};

const esNegacion = (t = "") => {
  const raw = String(t || "").trim();
  const u = raw.toUpperCase();
  const n = normTxt(t);
  return /^(no|nop|cancelar|cancelemos|me equivoque|me equivoqu[eé])\b/i.test(raw) || u === "NO";
};

async function obtenerNombreLote(usuarioId, loteId) {
  if (!loteId) return "";
  const r = await listarLotesUsuario(usuarioId);
  const row = r.find((x) => Number(x.id) === Number(loteId));
  return row?.nombre || "";
}

async function obtenerNombreCampana(usuarioId, campanaId) {
  if (!campanaId) return "";
  const r = await listarCampanasUsuario(usuarioId);
  const row = r.find((x) => Number(x.id) === Number(campanaId));
  return row?.nombre || "";
}

async function listadoNombresCampanas(usuarioId) {
  const r = await listarCampanasUsuario(usuarioId);
  if (!r.length) return null;
  return r.map((c) => `• ${c.nombre}${c.fecha_inicio ? ` (${c.fecha_inicio})` : ""}`).join("\n");
}

function formatearSaldosWhatsapp(rows) {
  if (!rows?.length)
    return "Todavía no tenés *inventario* cargado por lote. Podés dar de alta desde acá por WhatsApp o desde *Mi Panel* web.";
  const lineas = rows.map((r) => {
    const ln = r.lote_nombre ? ` · 📍 ${r.lote_nombre}` : " · establecimiento";
    const cn = r.campana_nombre ? ` · 🌾 ${r.campana_nombre}` : "";
    if (r.dominio === "ganado") return `• ${r.etiqueta || r.item_clave}: *${fmtNum(r.cantidad)}* cab${ln}${cn}`;
    if (r.dominio === "cultivo") return `• ${r.etiqueta || r.item_clave}: *${fmtNum(r.cantidad)}* ha${ln}${cn}`;
    if (r.dominio === "grano") return `• ${r.etiqueta || r.item_clave} (stock): *${fmtNum(r.cantidad)}* tn${ln}${cn}`;
    const un = r.unidad ? ` ${r.unidad}` : "";
    return `• ${r.etiqueta || r.item_clave}: *${fmtNum(r.cantidad)}*${un}${ln}${cn}`;
  });
  return [
    "📦 *Tu inventario (últimos valores cargados)*",
    ...lineas,
    "",
    "_Tip: «registrá 120 novillos en lote norte» · «80 ha maíz» · «450 tn soja stock» (granos en tn, distinto de superficie en ha)._",
  ].join("\n");
}

function fmtNum(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n ?? "");
  return x.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

/**
 * Construye un resumen ultra-corto (~1 línea) del contenido de un
 * fragmento "Lote X" para usar en la vista previa del multi-lote.
 *
 * Estrategia: extraer todas las cantidades "N <categoría>" o
 * "N <unidad>" del texto y unirlas con " + ". Si hay varias, suma
 * indica "carga compuesta". Si no se detecta nada, devuelve `null`
 * y el caller muestra el fragmento como "_carga detectada_".
 *
 * Ejemplos:
 *  "Lote 4. 100 vaquillonas"               → "100 vaquillonas"
 *  "Lote 7. 46 vacas y 50 vacas Oyhamburu" → "46 vacas + 50 vacas"
 *  "Lote 2b. Invernada de tres titulares. 60 vaquillonas de Fernández
 *   64 macho y hembra de Oyhamburu 45 macho y hembra de Agro La Elisa"
 *                                          → "60 vaquillonas + 64 + 45 (3 grupos)"
 */
function resumirFragmentoMultiLote(fragmento = "") {
  const texto = String(fragmento || "");
  if (!texto.trim()) return null;
  /** Match liberal de "<num> <categoría/unidad>" — solo descriptivo. */
  const re = /(\d+(?:[.,]\d+)?)\s+(novillos?|vacas?|vaquillonas?|terneros?|toros?|cabezas?|cabs?\.?|cabras?|chivos?|ovejas?|corderos?|caballos?|yeguas?|cerdos?|chanchos?|lechones?|machos?|hembras?|hect[áa]reas?|h[aá]s?|kg|tn|toneladas?|lts?\.?|litros?)/gi;
  const matches = [];
  let m;
  while ((m = re.exec(texto)) !== null) {
    matches.push({ num: m[1], cat: m[2].toLowerCase() });
  }
  if (matches.length === 0) return null;
  if (matches.length === 1) return `${matches[0].num} ${matches[0].cat}`;
  /** Si hay varios grupos, dejamos el primero completo + abreviado. */
  const primero = `${matches[0].num} ${matches[0].cat}`;
  const otros = matches.slice(1, 4).map((x) => x.num).join(" + ");
  const sufijo = matches.length > 4 ? "…" : "";
  return `${primero} + ${otros}${sufijo} _(${matches.length} grupos)_`;
}

function payloadMovimiento(row) {
  return typeof row?.payload === "object" && row.payload ? row.payload : JSON.parse(row?.payload || "{}");
}

async function crearPendienteAutocrearLote({ usuarioId, loteNombre, borrador }) {
  await crearRegistroPendiente({
    usuarioId,
    dominio: "ganado",
    payload: {
      modo: "autocrear_lote_y_continuar",
      lote_nombre: loteNombre,
      borrador,
    },
    loteId: null,
    campanaId: null,
    efecto: "replace",
    fechaReferencia: borrador.fecha_referencia,
    textoNl: borrador.texto_original || `autocrear lote ${loteNombre}`,
    canal: "whatsapp",
  });
}

function parseComandoCrearLote(texto = "") {
  const raw = String(texto || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const m = raw.match(
    /^(?:crear|crea|alta|agregar|agrega|nuevo)\s+(?:el\s+)?lote\s+["'`]?([^"'`]+?)["'`]?(?:\s+de\s+(\d+[.,]?\d*)\s*h[aá]s?)?$/i
  );
  if (!m?.[1]) return null;
  const nombre = String(m[1]).trim();
  if (!nombre || nombre.length < 1) return null;
  const haRaw = m[2] != null ? Number(String(m[2]).replace(",", ".")) : null;
  const hectareas = Number.isFinite(haRaw) && haRaw > 0 ? haRaw : null;
  return { nombre: nombre.slice(0, 80), hectareas };
}

async function responderConsultaInventario(usuarioId, borradorConsulta, numeroWhatsapp) {
  void numeroWhatsapp;
  let filtroId = undefined;
  if (borradorConsulta.lote_nombre) {
    const lote = await resolverLotePorNombre(usuarioId, borradorConsulta.lote_nombre);
    if (lote?.id != null) filtroId = lote.id;
    else return `No encuentro un *lote* que coincida con «${borradorConsulta.lote_nombre}».\nCrealo desde *Mi Panel* (Inventario) o decime cómo llamás cada campo. Tus lotes cargados son:\n${(await listadoNombresLotes(usuarioId)) || "(ninguno)"}`;
  }
  const saldos = await listarSaldos({ usuarioId, loteId: filtroId === undefined ? undefined : filtroId });
  let intro = "";
  if (borradorConsulta.lote_nombre && filtroId != null)
    intro = `📍 Filtro: *${(await obtenerNombreLote(usuarioId, filtroId)) || borradorConsulta.lote_nombre}*\n\n`;
  return intro + formatearSaldosWhatsapp(saldos);
}

async function listadoNombresLotes(usuarioId) {
  const r = await listarLotesUsuario(usuarioId);
  if (!r.length) return null;
  return r.map((l) => `• ${l.nombre}${l.hectareas != null ? ` (${l.hectareas} ha)` : ""}`).join("\n");
}

/** Tras interpretar registro de ganado: aclarar color vs categoría y primer ingreso (genérico, no un caso puntual). */
async function lineasAclaracionRegistroGanado(usuarioId, borrador) {
  if (!borrador || borrador.dominio !== "ganado") return "";
  const raw = String(borrador.texto_original || "");
  const bloques = [];
  if (
    /\b(blancas?|negras?|colorad[oa]s?|over[oa]s?|mestiz[oa]s?|pintad[oa]s?|rubias?)\b/i.test(raw) &&
    /\b(vacas?|novillos?|terneros?|vaquillonas?|toros?|cabezas?|cabs?\.?)\b/i.test(raw)
  ) {
    bloques.push(
      "_¿Lo que describís como color o pelaje (ej. *blancas*) lo tratamos como *categoría de hacienda* tal cual, o preferís aclarar raza/categoría comercial en otro mensaje?_"
    );
  }
  try {
    const saldos = await listarSaldos({ usuarioId, dominio: "ganado" });
    const total = (saldos || []).reduce((a, r) => a + (Number.isFinite(Number(r.cantidad)) ? Number(r.cantidad) : 0), 0);
    if (total <= 0) {
      bloques.push(
        "_No tenías *ganado* cargado en inventario todavía; si esto es tu primer ingreso en esta categoría, confirmá con *SI*._"
      );
    }
  } catch (_e) {
    /* */
  }
  return bloques.length ? `\n${bloques.join("\n\n")}\n` : "";
}

async function leerColaMultiLote(numeroWhatsapp) {
  if (!numeroWhatsapp) return null;
  const est = await conversacionEstadoService.obtenerEstado(numeroWhatsapp);
  if (!est || est.flujo !== FLUJO_COLA_MULTI_LOTE) return null;
  const ctx = typeof est.contexto === "object" && est.contexto ? est.contexto : {};
  const restantes = Array.isArray(ctx.restantes) ? ctx.restantes : [];
  const totalInicial = Number(ctx.total_inicial) || restantes.length + 1;
  return {
    restantes,
    totalInicial,
    indiceActual: Number(ctx.indice_actual) || 1,
    etapa: String(est.etapa || ""),
  };
}

async function escribirColaMultiLote(numeroWhatsapp, { restantes, totalInicial, indiceActual }) {
  if (!numeroWhatsapp) return;
  const tieneRestantes = Array.isArray(restantes) && restantes.length > 0;
  /**
   * Si NO quedan restantes pero la planilla tenía 2+ lotes, conservamos el estado
   * en `esperando_ultimo` para poder mostrar un mensaje de cierre cuando el
   * productor confirme el último ítem (memoria del remanente).
   */
  const etapa = tieneRestantes ? "esperando_confirmacion_actual" : "esperando_ultimo";
  await conversacionEstadoService.guardarEstado(
    numeroWhatsapp,
    FLUJO_COLA_MULTI_LOTE,
    etapa,
    { restantes: tieneRestantes ? restantes : [], total_inicial: totalInicial, indice_actual: indiceActual },
    HORAS_EXPIRACION_COLA_MULTI_LOTE
  );
}

async function descartarColaMultiLote(numeroWhatsapp) {
  if (!numeroWhatsapp) return;
  await conversacionEstadoService.limpiarEstado(numeroWhatsapp);
}

/**
 * Inventario WhatsApp — confirmaciones; con Gemini: agente unificado (intención + extracción + respuesta guía);
 * sin API: heurística y extracción estrecha como respaldo.
 * @returns {{ manejado: boolean, respuesta?: string }}
 */
async function manejarInventarioWhatsapp({ texto = "", usuarioId, numeroWhatsapp, opciones = {} }) {
  if (!usuarioId) return { manejado: false };

  const forzarCapaUsuarioLlm = Boolean(opciones.forzarCapaUsuarioLlm);
  const capaGemini = opciones.capaGemini || null;

  const pendiente = await obtenerPendiente(usuarioId);
  const tr = String(texto || "").trim();
  const cmdLote = parseComandoCrearLote(tr);

  if (cmdLote) {
    if (pendiente) {
      return {
        manejado: true,
        respuesta:
          "Tenés una confirmación pendiente de inventario.\n" +
          "Respondé *SI* o *NO* primero, y luego enviá de nuevo el comando para crear el lote.",
      };
    }
    const existente = await resolverLotePorNombre(usuarioId, cmdLote.nombre);
    if (existente?.id) {
      return {
        manejado: true,
        respuesta: `Ese lote ya existe: *${existente.nombre}*${existente.hectareas != null ? ` (${existente.hectareas} ha)` : ""}.`,
      };
    }
    const creado = await crearLoteUsuario({
      usuarioId,
      nombre: cmdLote.nombre,
      hectareas: cmdLote.hectareas,
    });
    return {
      manejado: true,
      respuesta:
        `✅ Lote creado por WhatsApp: *${creado.nombre}*${creado.hectareas != null ? ` (${creado.hectareas} ha)` : ""}.\n` +
        "Ahora ya podés registrar inventario en ese lote.",
    };
  }

  if (pendiente && !esAfirmacion(tr) && !esNegacion(tr)) {
    const pp = payloadMovimiento(pendiente);
    if (pp?.modo === "espera_hectareas_mixto") {
      const ha = extraerHectareasDesdeTexto(tr);
      if (!Number.isFinite(ha) || ha <= 0) {
        return {
          manejado: true,
          respuesta:
            "Para completar la siembra necesito las hectáreas.\n" +
            "Ejemplo: *80 ha* o *sembré 80 ha*.",
        };
      }
      const payloadCompuesto = {
        items_compuestos: [
          { dominio: "cultivo", efecto: "replace", payload: { cultivo: pp.cultivo, hectareas: ha } },
          { dominio: "insumo", efecto: pp.insumo_efecto === "delta" ? "delta" : "replace", payload: pp.insumo || {} },
        ],
      };
      await rechazarMovimientoPorId(pendiente.id, usuarioId);
      const movComp = await crearRegistroPendiente({
        usuarioId,
        dominio: "ganado",
        payload: payloadCompuesto,
        loteId: pendiente.lote_id || null,
        campanaId: pendiente.campana_id || null,
        efecto: "replace",
        fechaReferencia: pendiente.fecha_referencia,
        textoNl: pendiente.texto_nl || texto,
        canal: "whatsapp",
      });
      const ln2 = await obtenerNombreLote(usuarioId, movComp.lote_id);
      const cn2 = await obtenerNombreCampana(usuarioId, movComp.campana_id);
      const cuerpo2 = resumenMovimientoParaHumano(movComp, ln2, cn2);
      const acl2 = await lineasAclaracionRegistroGanado(usuarioId, {
        dominio: "ganado",
        texto_original: String(pendiente.texto_nl || texto || ""),
      });
      return {
        manejado: true,
        respuesta: ["📥 *¿Guardo así en inventario?*", "", String(cuerpo2), acl2, "", "Respondé *SI* para confirmar o *NO* para cancelar."]
          .filter((x) => String(x || "").trim() !== "")
          .join("\n"),
      };
    }
  }

  if (pendiente && (esAfirmacion(tr) || esNegacion(tr))) {
    const pp = payloadMovimiento(pendiente);
    if (pp?.modo === "autocrear_lote_y_continuar") {
      if (esNegacion(tr)) {
        await rechazarMovimientoPorId(pendiente.id, usuarioId);
        return { manejado: true, respuesta: "Perfecto, no creé el lote ni guardé el registro." };
      }
      const nombreNuevoLote = String(pp.lote_nombre || "").trim();
      const borrador = pp.borrador || null;
      if (!nombreNuevoLote || !borrador) {
        await rechazarMovimientoPorId(pendiente.id, usuarioId);
        return { manejado: true, respuesta: "No pude recuperar el borrador. Reenviá el mensaje de registro por favor." };
      }
      let lote = await resolverLotePorNombre(usuarioId, nombreNuevoLote);
      if (!lote?.id) lote = await crearLoteUsuario({ usuarioId, nombre: nombreNuevoLote });
      await rechazarMovimientoPorId(pendiente.id, usuarioId);
      const mov = await crearRegistroPendiente({
        usuarioId,
        dominio: borrador.dominio,
        payload: borrador.payload,
        loteId: lote.id,
        campanaId: borrador.campana_id ?? null,
        efecto: borrador.efecto === "delta" ? "delta" : "replace",
        fechaReferencia: borrador.fecha_referencia,
        textoNl: borrador.texto_original,
        canal: "whatsapp",
      });
      const ln = await obtenerNombreLote(usuarioId, lote.id);
      const cn = await obtenerNombreCampana(usuarioId, mov.campana_id);
      const cuerpo = resumenMovimientoParaHumano(mov, ln, cn);
      const aclLote = await lineasAclaracionRegistroGanado(usuarioId, borrador);
      return {
        manejado: true,
        respuesta: [
          `✅ Creé el lote *${lote.nombre}*.`,
          "",
          "📥 *¿Guardo así en inventario?*",
          "",
          String(cuerpo),
          aclLote,
          "",
          "Respondé *SI* para confirmar o *NO* para cancelar.",
        ]
          .filter((x) => String(x || "").trim() !== "")
          .join("\n"),
      };
    }
    if (esAfirmacion(tr)) {
      const ok = await confirmarMovimientoPorId(pendiente.id, usuarioId);
      if (!ok) return { manejado: true, respuesta: "El borrador caducó o ya no existe. Intentá cargar los datos de nuevo." };
      const resumenOk = `✅ *Listo, guardado en inventario.*\n_${resumenMovimientoParaHumano(
        ok,
        await obtenerNombreLote(usuarioId, ok.lote_id),
        await obtenerNombreCampana(usuarioId, ok.campana_id)
      )}_`;
      const cola = await leerColaMultiLote(numeroWhatsapp);
      if (cola && cola.etapa === "esperando_ultimo" && cola.restantes.length === 0) {
        /** Confirmación del **último** lote de la planilla: cerramos con mensaje de cierre. */
        await descartarColaMultiLote(numeroWhatsapp);
        const total = cola.totalInicial || 1;
        return {
          manejado: true,
          respuesta: `${resumenOk}\n\n🎉 *Terminé tu planilla.* Cargué *${total} lote(s)* en total.\n_Cuando quieras seguir, mandame los próximos._`,
        };
      }
      if (cola && cola.restantes.length > 0) {
        const siguiente = cola.restantes[0];
        const nuevosRestantes = cola.restantes.slice(1);
        const r = await manejarInventarioWhatsapp({
          texto: siguiente.fragmento,
          usuarioId,
          numeroWhatsapp,
          opciones: { ...opciones, _saltarMultiLote: true },
        });
        const indiceNuevo = (cola.indiceActual || 1) + 1;
        if (r?.manejado) {
          await escribirColaMultiLote(numeroWhatsapp, {
            restantes: nuevosRestantes,
            totalInicial: cola.totalInicial,
            indiceActual: indiceNuevo,
          });
          const colaTxt = nuevosRestantes.length
            ? `\n\n_Después seguimos con: ${nuevosRestantes.map((b) => `Lote ${b.lote_nombre}`).join(", ")}._`
            : "";
          return {
            manejado: true,
            respuesta: [
              resumenOk,
              "",
              `*Lote ${siguiente.lote_nombre}* (${indiceNuevo}/${cola.totalInicial}):`,
              "━━━━━━━━━━━━━━━━━",
              r.respuesta || "",
              colaTxt,
            ]
              .filter((x) => x !== undefined && x !== null)
              .join("\n"),
          };
        }
        await descartarColaMultiLote(numeroWhatsapp);
        return {
          manejado: true,
          respuesta:
            `${resumenOk}\n\n` +
            `⚠️ No pude interpretar el siguiente lote (Lote ${siguiente.lote_nombre}). Cancelé la cola; mandalos separados de a uno.`,
        };
      }
      return { manejado: true, respuesta: resumenOk };
    }
    await rechazarMovimientoPorId(pendiente.id, usuarioId);
    const cola = await leerColaMultiLote(numeroWhatsapp);
    if (cola && cola.etapa === "esperando_ultimo" && cola.restantes.length === 0) {
      await descartarColaMultiLote(numeroWhatsapp);
      const cargadosPrevios = Math.max(0, (cola.totalInicial || 1) - 1);
      return {
        manejado: true,
        respuesta:
          `Dale, *no guardé el último*. Quedaron cargados los *${cargadosPrevios} lote(s)* anteriores.\n` +
          "Cuando quieras volver a cargar el que cancelamos, mandámelo.",
      };
    }
    if (cola && cola.restantes.length > 0) {
      await descartarColaMultiLote(numeroWhatsapp);
      const lista = cola.restantes.map((b) => `Lote ${b.lote_nombre}`).join(", ");
      return {
        manejado: true,
        respuesta:
          "Dale, *no guardé nada* y cancelé la cola pendiente.\n" +
          `_Quedaban sin procesar: ${lista}._\n` +
          "Cuando quieras volver a cargarlos, mandámelos.",
      };
    }
    return { manejado: true, respuesta: "Dale, *no guardé nada*. Escribí de nuevo cuando quieras." };
  }

  let intentForced = null;
  if (forzarCapaUsuarioLlm && capaGemini?.capa === "inventario") {
    const modo = capaGemini.inventario_modo === "consulta" ? "consulta" : "registro";
    intentForced = { clase: modo };
  }
  const consultaInventarioForzada = intentForced?.clase === "consulta";

  let intentLite = null;
  let borradorPrefetchDesdeLlm = null;
  let intentInventarioInferidoSoloLlm = false;
  let intentoAgenteUnificado = false;

  const llmInventarioDisponible =
    inventarioLlmHabilitado() || (forzarCapaUsuarioLlm && Boolean(process.env.GEMINI_API_KEY?.trim()));

  let agenteInv = null;
  if (llmInventarioDisponible && !consultaInventarioForzada) {
    intentoAgenteUnificado = true;
    const lotesPrefetch = await listarLotesUsuario(usuarioId);
    const campPrefetch = await listarCampanasUsuario(usuarioId);
    agenteInv = await interpretarInventarioAgenteWhatsApp(texto, {
      lotes: lotesPrefetch,
      campanas: campPrefetch,
      forzarCapaUsuario: forzarCapaUsuarioLlm,
      modoForzado: intentForced?.clase === "registro" ? "registro" : null,
    });

    if (
      intentForced?.clase === "registro" &&
      agenteInv &&
      (agenteInv.accion === "no_inventario" || agenteInv.accion === "consulta")
    ) {
      agenteInv = null;
    }

    if (agenteInv) {
      if (agenteInv.accion === "no_inventario") return { manejado: false };
      if (agenteInv.accion === "conversacion") {
        return { manejado: true, respuesta: agenteInv.respuesta };
      }
      if (agenteInv.accion === "consulta") {
        const bd = {
          tipo: "consulta",
          lote_nombre: agenteInv.consulta_filtro_lote,
          texto_original: texto,
        };
        let cuerpo = await responderConsultaInventario(usuarioId, bd, numeroWhatsapp);
        if (agenteInv.mensaje_preludio) cuerpo = `${agenteInv.mensaje_preludio}\n\n${cuerpo}`;
        return { manejado: true, respuesta: cuerpo };
      }
      if (agenteInv.accion === "registro") {
        borradorPrefetchDesdeLlm = agenteInv.borrador;
        intentLite = { clase: "registro" };
        intentInventarioInferidoSoloLlm = true;
      }
    }
  }

  if (intentForced) {
    intentLite = intentForced;
    if (consultaInventarioForzada) {
      borradorPrefetchDesdeLlm = null;
      intentInventarioInferidoSoloLlm = false;
    }
  }

  if (!intentLite) intentLite = parseIntentInventario(texto);

  if (!intentLite) return { manejado: false };
  if (intentLite.clase === "ambiguo") {
    return {
      manejado: true,
      respuesta:
        "Detecté mezcla de *consulta* y *registro* en el mismo mensaje, y por seguridad no guardé nada.\n" +
        "Mandalo separado en dos mensajes:\n" +
        "• consulta: «¿qué hay en inventario del lote La Elisa?»\n" +
        "• registro: «registrá 20 lt de herbicida en lote La Elisa»",
    };
  }

  if (intentLite.clase === "multi_lote" && Array.isArray(intentLite.bloques) && intentLite.bloques.length >= 2 && !opciones?._saltarMultiLote) {
    const bloques = intentLite.bloques;
    const sinCarga = Array.isArray(intentLite.bloques_sin_carga) ? intentLite.bloques_sin_carga : [];
    const primero = bloques[0];
    const restantes = bloques.slice(1).map((b) => ({ lote_nombre: b.lote_nombre, fragmento: b.fragmento }));

    /**
     * Vista previa estilo Cursor: antes de procesar el primer lote,
     * mostramos el "plan de carga" completo para que el productor vea
     * de un vistazo TODO lo que vamos a registrar y qué se ignora. Si
     * algo no le cuadra, puede cancelar con NO desde el primer
     * borrador.
     */
    const previewProcesar = bloques
      .map((b, i) => {
        const resumen = resumirFragmentoMultiLote(b.fragmento);
        return `  ${i + 1}. *Lote ${b.lote_nombre}* — ${resumen || "_carga detectada_"}`;
      })
      .join("\n");
    const previewIgnorar = sinCarga.length
      ? sinCarga
          .slice(0, 12)
          .map((b) => `Lote ${b.lote_nombre}`)
          .join(", ") + (sinCarga.length > 12 ? "…" : "")
      : "";

    const r = await manejarInventarioWhatsapp({
      texto: primero.fragmento,
      usuarioId,
      numeroWhatsapp,
      opciones: { ...opciones, _saltarMultiLote: true },
    });

    if (!r?.manejado) {
      return {
        manejado: true,
        respuesta: [
          `📋 *Plan detectado* (${bloques.length} lotes con carga${sinCarga.length ? `, ${sinCarga.length} sin hacienda` : ""}):`,
          previewProcesar,
          previewIgnorar ? `\n⏭️ _Ignoro: ${previewIgnorar}._` : "",
          "",
          `⚠️ No pude interpretar el primer lote (*Lote ${primero.lote_nombre}*) porque parece tener varias cargas mezcladas.`,
          "Mandalos separados, uno por lote, con cantidad y categoría clara.",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    await escribirColaMultiLote(numeroWhatsapp, {
      restantes,
      totalInicial: bloques.length,
      indiceActual: 1,
    });

    const cabecera = [
      `📋 *Plan de carga* (${bloques.length} lotes con carga${sinCarga.length ? `, ${sinCarga.length} sin hacienda` : ""}):`,
      previewProcesar,
      previewIgnorar ? `\n⏭️ _Ignoro: ${previewIgnorar}._` : "",
      "",
      "Voy uno por uno. Confirmá con *SI* o cancelá con *NO* cada borrador.",
      "",
      `*Lote ${primero.lote_nombre}* (1/${bloques.length}):`,
      "━━━━━━━━━━━━━━━━━",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      manejado: true,
      respuesta: `${cabecera}\n${r.respuesta || ""}`,
    };
  }

  if (intentLite.clase === "consulta") {
    const bd = construirBorradorConsulta(texto, intentForced);
    if (!bd) return { manejado: false };
    const txt = await responderConsultaInventario(usuarioId, bd, numeroWhatsapp);
    return { manejado: true, respuesta: txt };
  }

  let borrador = borradorPrefetchDesdeLlm || construirBorradorRegistro(texto, intentForced);
  if (
    !borrador &&
    intentLite.clase === "registro" &&
    !intentInventarioInferidoSoloLlm &&
    (!intentoAgenteUnificado || agenteInv == null) &&
    (permiteIntentarLlmTrasFalloHeuristica(texto) || forzarCapaUsuarioLlm || inventarioLlmHabilitado())
  ) {
    const lotes = await listarLotesUsuario(usuarioId);
    const campanas = await listarCampanasUsuario(usuarioId);
    borrador = await borradorRegistroDesdeLlm(texto, {
      lotes,
      campanas,
      forzarCapaUsuario: forzarCapaUsuarioLlm,
    });
  }

  if (!borrador) {
    if (intentLite.clase === "registro") {
      return {
        manejado: true,
        respuesta:
          "No pude entender el *número*, el *tipo* (cab / ha / insumo kg o lt), o el *lote*.\n" +
          (permiteIntentarLlmTrasFalloHeuristica(texto) && !process.env.GEMINI_API_KEY
            ? "(Activá GEMINI_API_KEY para intentar interpretar frases más libres automáticamente.)\n"
            : "") +
          "Ejemplos:\n" +
          "• registrá 120 novillos en el lote Norte\n" +
          "• guardá 80 ha de soja en campo Sur\n" +
          "• cargá 500 kg de glifosato | gastamos 40 kg de urea\n" +
          "• guardá 120 tn de trigo como stock",
      };
    }
    return { manejado: false };
  }

  if (borrador.tipo === "registro_mixto_falta_hectareas") {
    let loteIdMixto = null;
    if (borrador.lote_nombre_fragmento) {
      const lt = await resolverLotePorNombre(usuarioId, borrador.lote_nombre_fragmento);
      if (lt?.id) loteIdMixto = lt.id;
      else {
        await crearPendienteAutocrearLote({
          usuarioId,
          loteNombre: borrador.lote_nombre_fragmento,
          borrador: {
            dominio: "ganado",
            efecto: "replace",
            payload: {
              modo: "espera_hectareas_mixto",
              cultivo: borrador.payload.cultivo,
              insumo: borrador.payload.insumo,
              insumo_efecto: borrador.payload.insumo_efecto || "replace",
            },
            campana_id: null,
            fecha_referencia: borrador.fecha_referencia,
            texto_original: borrador.texto_original,
          },
        });
        return {
          manejado: true,
          respuesta: `No encontré el lote *«${borrador.lote_nombre_fragmento}»*.\n¿Querés que lo cree ahora por WhatsApp y siga con la carga?\nRespondé *SI* para crear lote y continuar, o *NO* para cancelar.`,
        };
      }
    }
    let campanaIdMixto = null;
    if (borrador.campana_nombre_fragmento) {
      const cm = await resolverCampanaPorNombre(usuarioId, borrador.campana_nombre_fragmento);
      if (cm?.id) campanaIdMixto = cm.id;
      else {
        const lista = await listadoNombresCampanas(usuarioId);
        return {
          manejado: true,
          respuesta: `Mencionaste una *campaña* y no coincide con las cargadas *«${borrador.campana_nombre_fragmento}»*.${lista ? `\n\nTenés:\n${lista}\n\nCreá una en Mi Panel o corregí el nombre.` : "\n\nCreá primero una campaña en Mi Panel (Inventario)."}`,
        };
      }
    }
    await crearRegistroPendiente({
      usuarioId,
      dominio: "ganado",
      payload: {
        modo: "espera_hectareas_mixto",
        cultivo: borrador.payload.cultivo,
        insumo: borrador.payload.insumo,
        insumo_efecto: borrador.payload.insumo_efecto || "replace",
      },
      loteId: loteIdMixto,
      campanaId: campanaIdMixto,
      efecto: "replace",
      fechaReferencia: borrador.fecha_referencia,
      textoNl: borrador.texto_original,
      canal: "whatsapp",
    });
    return {
      manejado: true,
      respuesta:
        `Anotado: *${borrador.payload.insumo?.cantidad ?? borrador.payload.insumo?.delta ?? "?"} ${borrador.payload.insumo?.unidad || ""} de ${borrador.payload.insumo?.producto || "insumo"}* y siembra de *${borrador.payload.cultivo}*.\n` +
        "Para completar el registro, decime cuántas hectáreas sembraste (ej: *80 ha*).",
    };
  }

  let loteId = null;
  if (borrador.lote_nombre_fragmento) {
    const lt = await resolverLotePorNombre(usuarioId, borrador.lote_nombre_fragmento);
    if (lt?.id) loteId = lt.id;
    else {
      await crearPendienteAutocrearLote({
        usuarioId,
        loteNombre: borrador.lote_nombre_fragmento,
        borrador: {
          dominio: borrador.dominio,
          efecto: borrador.efecto,
          payload: borrador.payload,
          campana_id: null,
          fecha_referencia: borrador.fecha_referencia,
          texto_original: borrador.texto_original,
        },
      });
      return {
        manejado: true,
        respuesta: `No encontré el lote *«${borrador.lote_nombre_fragmento}»*.\n¿Querés que lo cree ahora por WhatsApp y siga con la carga?\nRespondé *SI* para crear lote y continuar, o *NO* para cancelar.`,
      };
    }
  }

  let campanaId = null;
  if (borrador.campana_nombre_fragmento) {
    const cm = await resolverCampanaPorNombre(usuarioId, borrador.campana_nombre_fragmento);
    if (cm?.id) campanaId = cm.id;
    else {
      const lista = await listadoNombresCampanas(usuarioId);
      return {
        manejado: true,
        respuesta: `Mencionaste una *campaña* y no coincide con las cargadas *«${borrador.campana_nombre_fragmento}»*.${lista ? `\n\nTenés:\n${lista}\n\nCreá una en Mi Panel o corregí el nombre.` : "\n\nCreá primero una campaña en Mi Panel (Inventario)."}`,
      };
    }
  }

  /* Sin lote: permitimos saldo establecimiento; avisamos. */
  const mov = await crearRegistroPendiente({
    usuarioId,
    dominio: borrador.dominio,
    payload: borrador.payload,
    loteId,
    campanaId,
    efecto: borrador.efecto === "delta" ? "delta" : "replace",
    fechaReferencia: borrador.fecha_referencia,
    textoNl: borrador.texto_original,
    canal: "whatsapp",
  });
  const ln = await obtenerNombreLote(usuarioId, loteId);
  const cn = await obtenerNombreCampana(usuarioId, campanaId);
  const cuerpo = resumenMovimientoParaHumano(mov, ln, cn);
  const aclGan = await lineasAclaracionRegistroGanado(usuarioId, borrador);
  return {
    manejado: true,
    respuesta: [
      "📥 *¿Guardo así en inventario?*",
      "",
      String(cuerpo),
      aclGan,
      "",
      !borrador.lote_nombre_fragmento
        ? "⚠️ Sin *lote* en la frase → queda a nivel *establecimiento*. Para asignar un campo cargá antes el *lote* desde Mi Panel (web).\n"
        : "",
      borrador._via_llm
        ? "_Interpretado con el asistente (IA); revisá los números antes de confirmar._\n"
        : "",
      "Respondé *SI* para confirmar o *NO* para cancelar.",
    ]
      .filter((x) => String(x || "").trim() !== "")
      .join("\n"),
  };
}

module.exports = {
  manejarInventarioWhatsapp,
  formatearSaldosWhatsapp,
};
