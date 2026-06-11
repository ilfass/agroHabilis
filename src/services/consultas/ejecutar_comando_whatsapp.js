"use strict";

const { textoInvitacionResumen } = require("../resumen_interactivo");
const { PLAN_PRICES_CACHE } = require("../planes");

const ejecutarComandoYHumanizar = async (
  { comando, parametros = {}, usuario, numeroWhatsapp, textoOriginal = "" } = {},
  deps = {}
) => {
  const {
    normalizarWhatsappFn: normalizarWhatsapp,
    renderTemplateFn: renderTemplate,
    listarAlertasFn: listarAlertas,
    humanizarComandoConIAFn: humanizarComandoConIA,
    obtenerResumenFinancieroFn: obtenerResumenFinanciero,
    registrarGastoFn: registrarGasto,
    registrarVentaFn: registrarVenta,
    obtenerContextoPlanPorWhatsappFn: obtenerContextoPlanPorWhatsapp,
    puedeUsarAlertasFn: puedeUsarAlertas,
    configurarAlertaFn: configurarAlerta,
    parseCultivoFn: parseCultivo,
    detectarCultivoEnTextoFn: detectarCultivoEnTexto,
  } = deps;
  const whatsapp = normalizarWhatsapp(numeroWhatsapp);
  const cmd = String(comando || "").toUpperCase();
  const requiereUsuario = [
    "MI_RESUMEN",
    "MIS_ALERTAS",
    "MI_MARGEN",
    "REGISTRAR_GASTO",
    "REGISTRAR_VENTA",
    "CREAR_ALERTA",
    "ANALIZAR_CULTIVO",
  ].includes(cmd);
  if (requiereUsuario && !usuario?.id) {
    return "Para eso primero necesito tu perfil activo. Decime tu nombre y zona y lo habilitamos enseguida.";
  }
  if (cmd === "MI_RESUMEN") {
    // No marcar invitación ni estado acá: solo WhatsApp/iniciarResumen debe hacerlo tras envío real;
    // si no, el cron omite al usuario sin haberle mandado el mensaje.
    return (
      String(textoInvitacionResumen(usuario?.nombre) || "").trim() ||
      "No pude iniciar tu resumen en este momento."
    );
  }
  if (cmd === "MIS_ALERTAS") {
    const textoAlertas = await listarAlertas(whatsapp);
    if (/No ten[eé]s alertas activas/i.test(textoAlertas)) {
      return "No tenés alertas activas. ¿Querés crear una?";
    }
    return humanizarComandoConIA({ usuario, comando: "MIS_ALERTAS", datosTexto: textoAlertas });
  }
  if (cmd === "MI_MARGEN") {
    const resumen = await obtenerResumenFinanciero(usuario?.id);
    const sinDatos =
      !resumen ||
      (!Array.isArray(resumen?.porPerfil) || !resumen.porPerfil.length) ||
      resumen.porPerfil.every((p) => Number(p.gastos || 0) === 0 && Number(p.ventas || 0) === 0);
    if (sinDatos) {
      return 'Todavía no tenés gastos/ventas cargados este mes. Si querés, empezamos ahora: escribí "gasté X en Y" o "vendí X de Y".';
    }
    const porPerfil = (resumen?.porPerfil || [])
      .map(
        (p) =>
          `${p.perfil}: gastos $${Number(p.gastos || 0).toLocaleString("es-AR")} · ventas $${Number(
            p.ventas || 0
          ).toLocaleString("es-AR")} · margen $${Number(p.margen || 0).toLocaleString("es-AR")}`
      )
      .join("\n");
    const desglose = (resumen?.desgloseCategorias || [])
      .slice(0, 4)
      .map((d) => `${d.categoria}: $${Number(d.total || 0).toLocaleString("es-AR")}`)
      .join(" | ");
    const baseMargen = [
      "📊 Resumen financiero del mes:",
      porPerfil || "- Sin perfiles con movimientos.",
      desglose ? `Desglose gastos: ${desglose}` : "Desglose gastos: sin categorías cargadas.",
    ].join("\n");
    return humanizarComandoConIA({
      usuario,
      comando: "MI_MARGEN",
      datosTexto: baseMargen,
    });
  }
  if (cmd === "REGISTRAR_GASTO") {
    const base = await registrarGasto(usuario, textoOriginal);
    return humanizarComandoConIA({
      usuario,
      comando: "REGISTRAR_GASTO",
      datosTexto: `${base}\nConfirmá de forma natural y hacé 1 pregunta de seguimiento para completar registro (ej: hectáreas).`,
    });
  }
  if (cmd === "REGISTRAR_VENTA") {
    const base = await registrarVenta(usuario, textoOriginal);
    return humanizarComandoConIA({
      usuario,
      comando: "REGISTRAR_VENTA",
      datosTexto: `${base}\nConfirmá de forma natural y preguntá un siguiente dato útil.`,
    });
  }
  if (cmd === "CREAR_ALERTA") {
    const cultivo = String(parametros?.cultivo || "").trim();
    const valor = Number(parametros?.valor);
    const payload = cultivo && Number.isFinite(valor) ? `avisame cuando ${cultivo} supere ${valor}` : textoOriginal;
    const base = await configurarAlerta(whatsapp, payload);
    return `${base}\nTe confirmo que la alerta quedó cargada.`;
  }
  if (cmd === "ANALIZAR_CULTIVO") {
    const cultivo = parseCultivo(parametros?.cultivo || detectarCultivoEnTexto(textoOriginal) || "");
    if (!cultivo) {
      return "Decime qué cultivo querés analizar (ej: soja, maíz o trigo) y lo veo ahora.";
    }
    const analisisTpl = await renderTemplate("analisis_venta", usuario, cultivo);
    return humanizarComandoConIA({ usuario, comando: "ANALIZAR_CULTIVO", datosTexto: analisisTpl?.mensaje || "" });
  }
  if (cmd === "PLANES") {
    const pBasico = `$${Number(PLAN_PRICES_CACHE.basico || 22000).toLocaleString("es-AR")}`;
    const pPro = `$${Number(PLAN_PRICES_CACHE.pro || 29000).toLocaleString("es-AR")}`;
    const pProMax = `$${Number(PLAN_PRICES_CACHE.pro_max || 50000).toLocaleString("es-AR")}`;
    return `Planes disponibles: GRATIS $0/mes, BASICO ${pBasico}/mes, PRO ${pPro}/mes y PRO MAX ${pProMax}/mes. ¿Querés que te recomiende uno según tu uso?`;
  }
  return null;
};

module.exports = { ejecutarComandoYHumanizar };
