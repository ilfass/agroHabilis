"use strict";

const responderDespedidaRapida = (usuario) => {
  const nombre = String(usuario?.nombre || "").trim().split(" ")[0] || "";
  const base = nombre ? `¡Hasta mañana, *${nombre}*! 👋` : "¡Hasta mañana! 👋";
  return `${base}\nCuando quieras, seguimos con precios, clima o mercado.`;
};

const responderReclamoFaltaDatosConversacional = () =>
  [
    "Tenés razón en marcarlo 👍",
    "Cuando no tengo dato validado en base, te lo digo de frente y te traigo alternativa web para no dejarte sin respuesta.",
    "Si querés, lo busco ahora mismo con fuentes externas y te paso fecha + fuente.",
  ].join("\n");

const responderPoliticaAlertasDeterministica = async ({
  numeroWhatsapp,
  obtenerContextoPlanPorWhatsapp,
  puedeUsarAlertas,
} = {}) => {
  const planCtx = await obtenerContextoPlanPorWhatsapp(numeroWhatsapp);
  const planTxt = String(planCtx?.planEfectivo || "gratis").toUpperCase();
  const habilitado = puedeUsarAlertas(planCtx.planEfectivo);
  return [
    "🔔 *Cómo funcionan las alertas hoy*",
    "━━━━━━━━━━━━━━━━━━━━",
    "- Fuente: se disparan sobre la referencia configurada en tu alerta (disponible o futuro/MATBA cuando esté disponible en base).",
    "- Criterio temporal: hoy se evalúan por actualización/cierre de datos (no por tick intradiario en tiempo real).",
    "- Si falta una fuente puntual en ese corte, te lo informo explícito antes de confirmar señal.",
    "",
    habilitado
      ? `Tu plan actual (${planTxt}) permite alertas. Si querés, te dejo una cargada ahora.`
      : "En Plan Gratis no se activan alertas de precio. Para habilitarlas: *QUIERO PLAN BASICO*.",
  ].join("\n");
};

const responderBloquesPlantillaPlan = (usuario = {}, { configPlanFn } = {}) => {
  const configPlan = typeof configPlanFn === "function" ? configPlanFn : () => ({});
  const cfg = configPlan(usuario);
  const planLbl = String(cfg.plan || "gratis").toUpperCase();
  const n = Number(cfg.bloques) || 7;
  return [
    `📦 Los *${n} bloques activos* del pie son del *plan ${planLbl}*: un *tope de secciones* que puede usar la plantilla en un solo mensaje de WhatsApp (clima, precios si aplica, tipo de cambio, etc.).`,
    "",
    "*No* es una taxonomía fija de rubros MAGyP ni “siete cultivos” ni nodos SIO: para eso preguntá por el dato concreto (ej. disponible Rosario, clima en tu zona, dólar).",
    "",
    `Tu plan: *${planLbl}* · hasta *${n} bloques* por mensaje · ${cfg.precio}.`,
    "",
    "Más cobertura por mensaje: *Plan BÁSICO* (9 bloques) o *Plan PRO* (13). Escribí *VER COMANDOS* para upgrades.",
  ].join("\n");
};

const responderMetaFechaHoyArgentina = () => {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `Hoy es *${fmt.format(d)}* (Argentina).`;
};

const responderMetaHoraAhoraArgentina = ({ fechaISOArgentinaFn } = {}) => {
  const fechaISOArgentina = typeof fechaISOArgentinaFn === "function" ? fechaISOArgentinaFn : () => "";
  const d = new Date();
  const hora = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
  const fechaIso = fechaISOArgentina();
  return `⌚ Son las *${hora}* del *${fechaIso}* (Argentina).`;
};

const responderMensajeRuido = () =>
  [
    "No llegué a entender ese mensaje.",
    "Si querés, escribime en una línea qué necesitás (ej: *precio maíz Rosario hoy* o *¿qué hora es?*).",
  ].join("\n");

const responderAyudaRegistrarVenta = () =>
  [
    "Para *anotar una venta* en AgroHabilis escribí el monto y el producto en una sola línea, por ejemplo:",
    "• *Vendí 120 tn de soja a 420 USD*",
    "• *Venta maíz 800000 ars 40 hectáreas*",
    "",
    "Si querés ver lo cargado: *MIS VENTAS*.",
    "Para margen vs gastos: *MI MARGEN*.",
  ].join("\n");

const responderAyudaRegistrarGasto = () =>
  [
    "Para *registrar un gasto* escribí el monto y el concepto, por ejemplo:",
    "• *Gasté 2 millones en glifosato*",
    "• *Compré 500000 de semillas*",
    "",
    "Para ver cargados: *MIS GASTOS* · resumen: *MI MARGEN*.",
  ].join("\n");

const responderAyudaUsoGenerica = () =>
  [
    "Decime qué querés hacer y te guío en una línea:",
    "• *VER COMANDOS* — lista completa",
    "• *MI RESUMEN* — corte del día",
    "• *MIS VENTAS* / *MIS GASTOS* — lo que cargaste",
  ].join("\n");

const responderAyudaSoloComandos = () =>
  [
    "Para ver *todas* las acciones del bot (precios, resumen, alertas, perfil, planes, ventas/gastos):",
    "Escribí tal cual en una línea: *VER COMANDOS*",
    "",
    "Ahí tenés la lista con los textos exactos que el asistente entiende.",
  ].join("\n");

const responderSeguimientoMetaFechaArgentina = (
  offset,
  { formatearFechaRelativaArgentinaFn, responderMetaFechaHoyArgentinaFn } = {}
) => {
  const formatearFechaRelativaArgentina =
    typeof formatearFechaRelativaArgentinaFn === "function" ? formatearFechaRelativaArgentinaFn : () => "";
  const responderMetaFechaHoyArgentina =
    typeof responderMetaFechaHoyArgentinaFn === "function" ? responderMetaFechaHoyArgentinaFn : () => "";
  const txt = formatearFechaRelativaArgentina(offset);
  const label = offset === 1 ? "Mañana" : offset === 2 ? "Pasado mañana" : "Ese día";
  if (!txt) return responderMetaFechaHoyArgentina();
  return `${label} es *${txt}* (Argentina).`;
};

const responderSaludoPlantillaRapida = (usuario, pregunta = "", { esFrasePuenteConsultaFn } = {}) => {
  const esFrasePuenteConsulta =
    typeof esFrasePuenteConsultaFn === "function" ? esFrasePuenteConsultaFn : () => false;
  const nombre = String(usuario?.nombre || "").trim().split(" ")[0] || "";
  const zona = [usuario?.partido, usuario?.provincia].filter(Boolean).join(", ") || "tu zona";
  const hola = nombre ? `¡Hola, *${nombre}*! 👋` : "¡Hola! 👋";
  if (esFrasePuenteConsulta(String(pregunta || ""))) {
    return `${hola}\nDale, *contame en una línea* qué necesitás: precio de un cultivo, clima, dólar o análisis de venta (${zona}).`;
  }
  return `${hola}\nEstoy para *precios*, *clima*, *dólar* y *mercado* en ${zona}.\nEscribime en una línea qué querés ver.`;
};

module.exports = {
  responderAyudaRegistrarGasto,
  responderAyudaRegistrarVenta,
  responderAyudaSoloComandos,
  responderAyudaUsoGenerica,
  responderBloquesPlantillaPlan,
  responderDespedidaRapida,
  responderMensajeRuido,
  responderMetaFechaHoyArgentina,
  responderMetaHoraAhoraArgentina,
  responderSaludoPlantillaRapida,
  responderSeguimientoMetaFechaArgentina,
  responderReclamoFaltaDatosConversacional,
  responderPoliticaAlertasDeterministica,
};
