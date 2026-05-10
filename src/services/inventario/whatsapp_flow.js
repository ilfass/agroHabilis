"use strict";

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
  permiteIntentarLlmTrasFalloHeuristica,
  inventarioLlmHabilitado,
} = require("./nl_llm");

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

/**
 * Inventario WhatsApp — confirmaciones y NL heurístico.
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
      return {
        manejado: true,
        respuesta: `✅ *Listo, guardado en inventario.*\n_${resumenMovimientoParaHumano(
          ok,
          await obtenerNombreLote(usuarioId, ok.lote_id),
          await obtenerNombreCampana(usuarioId, ok.campana_id)
        )}_`,
      };
    }
    await rechazarMovimientoPorId(pendiente.id, usuarioId);
    return { manejado: true, respuesta: "Dale, *no guardé nada*. Escribí de nuevo cuando quieras." };
  }

  let intentLite = parseIntentInventario(texto);
  let intentForced = null;
  if (forzarCapaUsuarioLlm && capaGemini?.capa === "inventario") {
    const modo = capaGemini.inventario_modo === "consulta" ? "consulta" : "registro";
    intentLite = { clase: modo };
    intentForced = { clase: modo };
  }

  /* Sin señal heurística: si INVENTARIO_NL_LLM está activo, que Gemini decida si es registro. */
  let borradorPrefetchDesdeLlm = null;
  let intentInventarioInferidoSoloLlm = false;
  if (!intentLite && inventarioLlmHabilitado()) {
    const lotesPrefetch = await listarLotesUsuario(usuarioId);
    const campPrefetch = await listarCampanasUsuario(usuarioId);
    borradorPrefetchDesdeLlm = await borradorRegistroDesdeLlm(texto, {
      lotes: lotesPrefetch,
      campanas: campPrefetch,
      forzarCapaUsuario: false,
    });
    if (borradorPrefetchDesdeLlm) {
      intentLite = { clase: "registro" };
      intentInventarioInferidoSoloLlm = true;
    }
  }

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
      borrador._via_llm ? "_Interpretado con modelo de lenguaje; revisá antes de confirmar._\n" : "",
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
