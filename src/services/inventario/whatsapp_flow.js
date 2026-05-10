"use strict";

const {
  obtenerPendiente,
  crearRegistroPendiente,
  confirmarMovimientoPorId,
  rechazarMovimientoPorId,
  listarSaldos,
  listarLotesUsuario,
  listarCampanasUsuario,
  resolverLotePorNombre,
  resolverCampanaPorNombre,
  resumenMovimientoParaHumano,
} = require("./core");
const { construirBorradorRegistro, construirBorradorConsulta, parseIntentInventario } = require("./nl_heuristica");
const { borradorRegistroDesdeLlm, permiteIntentarLlmTrasFalloHeuristica } = require("./nl_llm");

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

/**
 * Inventario WhatsApp — confirmaciones y NL heurístico.
 * @returns {{ manejado: boolean, respuesta?: string }}
 */
async function manejarInventarioWhatsapp({ texto = "", usuarioId, numeroWhatsapp }) {
  if (!usuarioId) return { manejado: false };

  const pendiente = await obtenerPendiente(usuarioId);
  const tr = String(texto || "").trim();

  if (pendiente && (esAfirmacion(tr) || esNegacion(tr))) {
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

  const intentLite = parseIntentInventario(texto);
  if (!intentLite) return { manejado: false };

  if (intentLite.clase === "consulta") {
    const bd = construirBorradorConsulta(texto);
    if (!bd) return { manejado: false };
    const txt = await responderConsultaInventario(usuarioId, bd, numeroWhatsapp);
    return { manejado: true, respuesta: txt };
  }

  let borrador = construirBorradorRegistro(texto);
  if (
    !borrador &&
    intentLite.clase === "registro" &&
    permiteIntentarLlmTrasFalloHeuristica(texto)
  ) {
    const lotes = await listarLotesUsuario(usuarioId);
    const campanas = await listarCampanasUsuario(usuarioId);
    borrador = await borradorRegistroDesdeLlm(texto, { lotes, campanas });
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

  let loteId = null;
  if (borrador.lote_nombre_fragmento) {
    const lt = await resolverLotePorNombre(usuarioId, borrador.lote_nombre_fragmento);
    if (lt?.id) loteId = lt.id;
    else {
      const nombres = await listadoNombresLotes(usuarioId);
      return {
        manejado: true,
        respuesta: `Mencionaste un lote y no coincide con tus parcelas cargadas *«${borrador.lote_nombre_fragmento}»*.${nombres ? `\n\nYa tenés:\n${nombres}\n\n` : "\n\n"}Creá ese lote en *Mi Panel* → Inventario → *Nuevo lote*, o cargá sin ubicación usando la web.`,
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
  return {
    manejado: true,
    respuesta: [
      "📥 *¿Guardo así en inventario?*",
      "",
      String(cuerpo),
      "",
      !borrador.lote_nombre_fragmento
        ? "⚠️ Sin *lote* en la frase → queda a nivel *establecimiento*. Para asignar un campo cargá antes el *lote* desde Mi Panel (web).\n"
        : "",
      borrador._via_llm ? "_Interpretado con modelo de lenguaje; revisá antes de confirmar._\n" : "",
      "Respondé *SI* para confirmar o *NO* para cancelar.",
    ].join("\n"),
  };
}

module.exports = {
  manejarInventarioWhatsapp,
  formatearSaldosWhatsapp,
};
