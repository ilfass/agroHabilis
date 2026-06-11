const axios = require("axios");
const { query } = require("../../config/database");
const {
  generarRespuestaConsulta,
  generarConPromptLibre,
  generarConGroundingGoogleSearch,
  getGroundingMaxChars,
} = require("../gemini");
const { parseCultivo } = require("../analisis_venta");
const { normalizarWhatsapp, actualizarUsuario, obtenerPerfil } = require("../../models/usuario");
const { renderTemplate } = require("../../templates");
const { rankRowsByPriority } = require("../../utils/source_scoring");
const {
  textoParaClasificacionSaludo,
  esPreguntaAyudaComandosOMenu,
  esFrasePuenteConsulta,
} = require("../whatsapp_intents");
const {
  obtenerDolarFresco,
  ordenarItemsTipoCambio,
  formatearItemTipoCambioTexto,
  configPlan,
  tieneFuentePrecios,
  clasificarTipoFuentePrecio,
} = require("../../templates/base");
const { obtenerClima } = require("../../scrapers/clima");
const { listarAlertas, configurarAlerta } = require("../alertas");
const { registrarGasto, registrarVenta, obtenerResumenFinanciero } = require("../gastos");
const { calcularEstructuraMercado } = require("../market_structure");
const { obtenerDisponiblePoliticaResumenUnCultivo } = require("../disponible_politica_resumen");
const { obtenerContextoPlanPorWhatsapp, puedeUsarAlertas } = require("../planes");
const {
  detectarCultivoEnTexto: detectarCultivoEnTextoMod,
  patronSqlCultivo: patronSqlCultivoMod,
  detectarCultivoConsulta: detectarCultivoConsultaMod,
  detectarMercadoConsulta: detectarMercadoConsultaMod,
  preguntaNombreProductoNoCubiertaporPerfilUnico: preguntaNombreProductoNoCubiertaporPerfilUnicoMod,
  esAfirmacionBreve,
  esPreguntaPorQueBreve,
  esDespedidaOEfectoAbiertoSinContenido,
  esDespedidaSimpleNoOperativa,
  esReclamoFaltaDatosConversacional,
  esPedidoOcioNoOperativo,
  esPedidoEstadoCieloConversacional,
  esConsultaClima,
  esConsultaPoliticaAlertas,
  preguntaRequierePipelineConsultaIA,
  detectarTemaGeneral,
  esConsultaIrrelevanteParaIA: esConsultaIrrelevanteParaIAMod,
  timeoutConsultaTemplateMs: timeoutConsultaTemplateMsMod,
  esConsultaEstructuraMercadoFeedlot: esConsultaEstructuraMercadoFeedlotMod,
  esConsultaInterpretativaIA: esConsultaInterpretativaIAMod,
  CHATBOT_CORE_POLICY: CHATBOT_CORE_POLICY_MOD,
  debeDerivarAFlujoIaBdPorPolitica: debeDerivarAFlujoIaBdPorPoliticaMod,
  esComentarioSeguimientoMercado: esComentarioSeguimientoMercadoMod,
  esPedidoAnalisisContextual: esPedidoAnalisisContextualMod,
  esPreguntaDudaBreveSobreContexto: esPreguntaDudaBreveSobreContextoMod,
  esPreguntaBloquesPlantillaPlan: esPreguntaBloquesPlantillaPlanMod,
  esPreguntaConfirmacionAlerta: esPreguntaConfirmacionAlertaMod,
  esSolicitudAlertaDirecta: esSolicitudAlertaDirectaMod,
  esTurnoCortoSeguimientoTemporal: esTurnoCortoSeguimientoTemporalMod,
  clasificarExpansionHiloConversacional: clasificarExpansionHiloConversacionalMod,
  pareceConsultaAutosuficienteNueva: pareceConsultaAutosuficienteNuevaMod,
  esConsultaCoberturaMaiz: esConsultaCoberturaMaizMod,
  esConsultaEstructuraMercado: esConsultaEstructuraMercadoMod,
  esReclamoConsistenciaMercado: esReclamoConsistenciaMercadoMod,
  parseDeclaracionHectareas: parseDeclaracionHectareasMod,
  timeoutPromise: timeoutPromiseMod,
  detectarNivelUsuarioConsulta: detectarNivelUsuarioConsultaMod,
  botUltimaRespuestaFueMetaFecha: botUltimaRespuestaFueMetaFechaMod,
  esFlujoOnboarding: esFlujoOnboardingMod,
  esSeguimientoCalendarioTrasMetaFecha: esSeguimientoCalendarioTrasMetaFechaMod,
  offsetSeguimientoCalendarioPedido: offsetSeguimientoCalendarioPedidoMod,
  ultimaPreguntaFueMetaFecha: ultimaPreguntaFueMetaFechaMod,
} = require("./rutas");
const {
  responderBloquesPlantillaPlan: responderBloquesPlantillaPlanMod,
  responderAyudaRegistrarGasto: responderAyudaRegistrarGastoMod,
  responderAyudaRegistrarVenta: responderAyudaRegistrarVentaMod,
  responderAyudaSoloComandos: responderAyudaSoloComandosMod,
  responderAyudaUsoGenerica: responderAyudaUsoGenericaMod,
  responderDespedidaRapida,
  responderMensajeRuido: responderMensajeRuidoMod,
  responderMetaFechaHoyArgentina: responderMetaFechaHoyArgentinaMod,
  responderMetaHoraAhoraArgentina: responderMetaHoraAhoraArgentinaMod,
  responderReclamoFaltaDatosConversacional,
  responderPoliticaAlertasDeterministica: responderPoliticaAlertasDeterministicaModular,
  responderSaludoPlantillaRapida: responderSaludoPlantillaRapidaMod,
  responderSeguimientoMetaFechaArgentina: responderSeguimientoMetaFechaArgentinaMod,
} = require("./respuestas_rapidas");
const {
  adaptarRespuestaPorNivel: adaptarRespuestaPorNivelMod,
  embellecerRespuestaWhatsApp: embellecerRespuestaWhatsAppMod,
  compactarRespuestaSimple: compactarRespuestaSimpleMod,
  humanizarComandoConIA: humanizarComandoConIAMod,
  humanizarComandoLocal: humanizarComandoLocalMod,
  limpiarSalidaSaludoIA: limpiarSalidaSaludoIAMod,
  lineaDatoTrazable: lineaDatoTrazableMod,
  limpiarMarcadoresRespuestaPrecio,
  humanizarRespuestaPrecioLocal,
  humanizarRespuestaPrecioConIA: humanizarRespuestaPrecioConIAModular,
} = require("./humanizacion");
const { ejecutarComandoYHumanizar: ejecutarComandoYHumanizarMod } = require("./ejecutar_comando_whatsapp");
const {
  formatearFechaEs: formatearFechaEsMod,
  cultivosParaConsultaPrecios: cultivosParaConsultaPreciosMod,
  resumirValores: resumirValoresMod,
  construirSeriePromedioPorFecha: construirSeriePromedioPorFechaMod,
  tonoMercadoDesdeSerie: tonoMercadoDesdeSerieMod,
  calcularDispersionPct: calcularDispersionPctMod,
  nombreCultivoBonito: nombreCultivoBonitoMod,
  armarLineasPlazasTecnico: armarLineasPlazasTecnicoMod,
  armarTopMercadosPapa: armarTopMercadosPapaMod,
  armarSerieTxtPapa: armarSerieTxtPapaMod,
  armarTopSegmentosPapaHort: armarTopSegmentosPapaHortMod,
  extraerSetLower: extraerSetLowerMod,
  extraerSetTrim: extraerSetTrimMod,
  extraerVolumenSetNoSd: extraerVolumenSetNoSdMod,
  calidadReferenciaPapa: calidadReferenciaPapaMod,
  tieneOperacionReal: tieneOperacionRealMod,
  seleccionarBasePreciosPriorizada: seleccionarBasePreciosPriorizadaMod,
  construirBloquesRespuestaCultivoGeneral: construirBloquesRespuestaCultivoGeneralMod,
  esConsultaInsumos: esConsultaInsumosMod,
  esConsultaDolar: esConsultaDolarMod,
  etiquetaTipoCambio: etiquetaTipoCambioMod,
  responderDolarActual: responderDolarActualMod,
  responderInsumos: responderInsumosMod,
  formatearMoneda: formatearMonedaMod,
  formatEmojiCultivo: formatEmojiCultivoMod,
  clasificarFilasPrecio: clasificarFilasPrecioMod,
  derivarTipoPriorizado: derivarTipoPriorizadoMod,
  tipoCambioEsFresco: tipoCambioEsFrescoMod,
} = require("./precios");
const {
  responderPrecioPorMercado: responderPrecioPorMercadoMod,
  responderDivisionPorPuerto: responderDivisionPorPuertoMod,
} = require("./precios_mercado");
const {
  parseMesAnioPosicion: parseMesAnioPosicionMod,
  resolverSpotRosarioComparable: resolverSpotRosarioComparableMod,
  resolverFuturosCultivo: resolverFuturosCultivoMod,
} = require("./mercado_spot_futuros");
const { responderDatosCultivo: responderDatosCultivoMod } = require("./datos_cultivo");
const { responderCoberturaMaiz: responderCoberturaMaizMod } = require("./cobertura_maiz");
const {
  responderEstructuraMercado: responderEstructuraMercadoMod,
  extraerPosicionesSolicitadas: extraerPosicionesSolicitadasMod,
  parseFechaConsulta: parseFechaConsultaMod,
  obtenerTcImplicitoDia: obtenerTcImplicitoDiaMod,
  obtenerDisponibleRosario: obtenerDisponibleRosarioMod,
  obtenerFuturoCercano: obtenerFuturoCercanoMod,
  construirBloqueEstructuraCultivo: construirBloqueEstructuraCultivoMod,
  obtenerLecturaNovilloFeedlot: obtenerLecturaNovilloFeedlotMod,
  construirPosturaGranoUnaLinea: construirPosturaGranoUnaLineaMod,
  responderEstructuraMercadoYFeedlot: responderEstructuraMercadoYFeedlotMod,
} = require("./estructura");
const {
  MARCO_REFERENCIA_HACIENDA,
  esConsultaHaciendaVenta: esConsultaHaciendaVentaMod,
  detectarCategoriaHacienda: detectarCategoriaHaciendaMod,
  responderHaciendaSimple: responderHaciendaSimpleMod,
} = require("./hacienda");
const {
  consultaPideDisponibleYMatba: consultaPideDisponibleYMatbaMod,
  tokenPosicionPorMes: tokenPosicionPorMesMod,
  obtenerFuturoMatbaReferencia: obtenerFuturoMatbaReferenciaMod,
  detectarActivosRelacion: detectarActivosRelacionMod,
  esConsultaRelacionIntercambio: esConsultaRelacionIntercambioMod,
  obtenerPrecioActivoRelacion: obtenerPrecioActivoRelacionMod,
  responderRelacionIntercambio: responderRelacionIntercambioMod,
  humanizarRelacionConIA: humanizarRelacionConIAMod,
} = require("./relacion");
const {
  construirFallbackDecisionUniversal: construirFallbackDecisionUniversalMod,
  construirRespuestaFallback: construirRespuestaFallbackMod,
  fallbackConsultaTimeoutConCultivo: fallbackConsultaTimeoutConCultivoMod,
  sanitizarPlaceholders: sanitizarPlaceholdersMod,
  tieneBloqueComplementoWeb: tieneBloqueComplementoWebMod,
  esRespuestaSecaSinDatos: esRespuestaSecaSinDatosMod,
  esRespuestaNoConfiable: esRespuestaNoConfiableMod,
  requiereRecuperacionDatosBd: requiereRecuperacionDatosBdMod,
  esConsultaPrecioEstricto: esConsultaPrecioEstrictoMod,
  respuestaPrecioEscasa: respuestaPrecioEscasaMod,
  cumpleMinimosRespuestaPrecio: cumpleMinimosRespuestaPrecioMod,
  evaluarRespuestaIASinContexto: evaluarRespuestaIASinContextoMod,
  respuestaMercadoDesfasadaVersusPregunta: respuestaMercadoDesfasadaVersusPreguntaMod,
  preguntaQuedoSinCoberturaClave: preguntaQuedoSinCoberturaClaveMod,
} = require("./fallbacks");
const {
  manejarComandoBot,
  obtenerEstadoBot,
} = require("./bot_control");
const {
  construirHistorialNaturalParaPlantilla,
  construirPreguntaConHiloInterpretado,
  obtenerUltimaInteraccion,
  obtenerUltimasInteracciones,
  extraerZonaTexto: extraerZonaTextoMod,
  armarContextoDatos: armarContextoDatosMod,
  construirContextoRelacionadoTemaLibre: construirContextoRelacionadoTemaLibreMod,
  construirFallbackSeguroDesdeContexto: construirFallbackSeguroDesdeContextoMod,
  construirRespuestaInteligenteGeneral: construirRespuestaInteligenteGeneralMod,
  extraerTemaDesdePregunta: extraerTemaDesdePreguntaMod,
  detectarTemaConversacion: detectarTemaConversacionMod,
  completarPerfilDesdeConsulta: completarPerfilDesdeConsultaMod,
  normSeguimientoCalendario,
} = require("./contexto");
const { logConsulta } = require("./logging");
const { createConsultaDatosSnapshot } = require("./consulta_datos_snapshot");
const {
  tieneCompraTipoCambio,
  tieneFuenteTipoCambio,
  obtenerUltimosPreciosPorCultivos,
  obtenerUltimoTipoCambio,
  obtenerPromedio30DiasCultivo,
  obtenerTendencia7DiasCultivo,
  obtenerAlertasActivasUsuario,
  obtenerFuturosParaCultivos,
  geocodificarZona,
  completarGeolocalizacionSiFalta,
  obtenerClimaZona,
  obtenerClimaFresco,
} = createConsultaDatosSnapshot({
  queryFn: query,
  axiosHttp: axios,
  ordenarItemsTipoCambioFn: ordenarItemsTipoCambio,
  actualizarUsuarioFn: actualizarUsuario,
  logConsultaFn: logConsulta,
  obtenerClimaFn: obtenerClima,
  extraerZonaTextoFn: extraerZonaTextoMod,
});
const { createConsultaRouteEvents } = require("./consulta_route_events");
const {
  ensureConsultaRouteEventsTable,
  registrarEventoRuta,
  logConsultaRoute,
} = createConsultaRouteEvents({
  queryFn: query,
  normalizarWhatsappFn: normalizarWhatsapp,
  logConsultaFn: logConsulta,
});
const {
  responderNoAgroConGrounding: responderNoAgroConGroundingMod,
  responderConsultaLibreIA: responderConsultaLibreIAMod,
  generarSaludoIAControlado: generarSaludoIAControladoMod,
  enriquecerConGroundingAgroSiHaceFalta: enriquecerConGroundingAgroSiHaceFaltaMod,
} = require("./ia_grounding");
const normalizarTextoComando = (texto = "") =>
  String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

const normMin = (texto = "") => {
  let str = String(texto);
  const idx = str.indexOf("\n\n---");
  if (idx !== -1) {
    str = str.slice(0, idx);
  } else {
    const idx2 = str.indexOf("\n---");
    if (idx2 !== -1) {
      str = str.slice(0, idx2);
    }
  }
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
};

const { TZ_AR, fechaISOArgentina, formatearFechaRelativaArgentina, fechaCivilArgentinaDesdeValor } = require("../../utils/fecha_ar");
const { formatearFuentesGroundingWhatsApp } = require("../../utils/urls_legibles");

const formatearFechaEs = (v) => formatearFechaEsMod(v, { tz: TZ_AR });

const toISODateParam = (v) => {
  if (!v) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const CULTIVOS_ALIAS = [
  { key: "soja", patrones: ["soja"] },
  { key: "maiz", patrones: ["maiz"] },
  { key: "trigo", patrones: ["trigo"] },
  { key: "girasol", patrones: ["girasol"] },
  { key: "sorgo", patrones: ["sorgo"] },
  { key: "cebada", patrones: ["cebada"] },
  { key: "papa", patrones: ["papa", "patata", "spunta", "kennebec", "innovator"] },
  /** Economías regionales: no inferir desde el único grano del perfil si la pregunta lo nombra. */
  { key: "yerba_mate", patrones: ["yerba mate", "yerbamate", "yerba"] },
];

const detectarCultivoEnTexto = detectarCultivoEnTextoMod;
const patronSqlCultivo = patronSqlCultivoMod;

/** Perfil + cultivos mencionados en la pregunta (evita `precios.items` vacío si el perfil no incluye el cultivo consultado). */
const cultivosParaConsultaPrecios = (cultivosRows = [], pregunta = "") =>
  cultivosParaConsultaPreciosMod(cultivosRows, pregunta, {
    normMinFn: normMin,
    cultivosAlias: CULTIVOS_ALIAS,
  });

const parseDeclaracionHectareas = (texto = "") =>
  parseDeclaracionHectareasMod(texto, { parseCultivoFn: parseCultivo });

const esComentarioSeguimientoMercado = (texto = "") =>
  esComentarioSeguimientoMercadoMod(texto, { normMinFn: normMin });

const esPreguntaBloquesPlantillaPlan = (texto = "") =>
  esPreguntaBloquesPlantillaPlanMod(texto, { normMinFn: normMin });

const responderBloquesPlantillaPlan = (usuario = {}) =>
  responderBloquesPlantillaPlanMod(usuario, { configPlanFn: configPlan });

const responderMetaFechaHoyArgentina = () => responderMetaFechaHoyArgentinaMod();

const responderMetaHoraAhoraArgentina = () =>
  responderMetaHoraAhoraArgentinaMod({ fechaISOArgentinaFn: fechaISOArgentina });

const responderMensajeRuido = () => responderMensajeRuidoMod();

const ultimaPreguntaFueMetaFecha = (prevQ = "") =>
  ultimaPreguntaFueMetaFechaMod(prevQ, { normSeguimientoCalendarioFn: normSeguimientoCalendario });

const botUltimaRespuestaFueMetaFecha = (prevBot = "") =>
  botUltimaRespuestaFueMetaFechaMod(prevBot);

const offsetSeguimientoCalendarioPedido = (pregunta = "") =>
  offsetSeguimientoCalendarioPedidoMod(pregunta, { normSeguimientoCalendarioFn: normSeguimientoCalendario });

const esSeguimientoCalendarioTrasMetaFecha = (pregunta, ultima) =>
  esSeguimientoCalendarioTrasMetaFechaMod(pregunta, ultima, {
    normSeguimientoCalendarioFn: normSeguimientoCalendario,
  });

const responderSeguimientoMetaFechaArgentina = (offset) =>
  responderSeguimientoMetaFechaArgentinaMod(offset, {
    formatearFechaRelativaArgentinaFn: formatearFechaRelativaArgentina,
    responderMetaFechaHoyArgentinaFn: responderMetaFechaHoyArgentina,
  });

const esTurnoCortoSeguimientoTemporal = (pregunta = "") =>
  esTurnoCortoSeguimientoTemporalMod(pregunta, { normSeguimientoCalendarioFn: normSeguimientoCalendario });

const esPreguntaDudaBreveSobreContexto = (pregunta = "") =>
  esPreguntaDudaBreveSobreContextoMod(pregunta, { normSeguimientoCalendarioFn: normSeguimientoCalendario });

const pareceConsultaAutosuficienteNueva = (pregunta = "", cultivosLista = []) =>
  pareceConsultaAutosuficienteNuevaMod(pregunta, cultivosLista, {
    normMinFn: normMin,
    detectarCultivoConsultaFn: detectarCultivoConsulta,
  });

/**
 * ¿Inyectamos historial en la “pregunta plantilla”?
 * Vale para cualquier tema (precio, clima, hacienda…) si el turno nuevo es muy corto o de duda/seguimiento.
 */
const clasificarExpansionHiloConversacional = (pregunta = "", cultivosLista = [], ultimasHistCount = 0) =>
  clasificarExpansionHiloConversacionalMod(pregunta, cultivosLista, ultimasHistCount, {
    normSeguimientoCalendarioFn: normSeguimientoCalendario,
    pareceConsultaAutosuficienteNuevaFn: pareceConsultaAutosuficienteNueva,
    esDespedidaOEfectoAbiertoSinContenidoFn: esDespedidaOEfectoAbiertoSinContenido,
    esAfirmacionBreveFn: esAfirmacionBreve,
    esSaludoSocialCortoFn: esSaludoSocialCorto,
    textoParaClasificacionSaludoFn: textoParaClasificacionSaludo,
    esSaludoSimpleFn: esSaludoSimple,
    esPreguntaAyudaComandosOMenuFn: esPreguntaAyudaComandosOMenu,
    esTurnoCortoSeguimientoTemporalFn: esTurnoCortoSeguimientoTemporal,
    esPreguntaDudaBreveSobreContextoFn: esPreguntaDudaBreveSobreContexto,
  });

const responderAyudaRegistrarVenta = () => responderAyudaRegistrarVentaMod();

const responderAyudaRegistrarGasto = () => responderAyudaRegistrarGastoMod();

const responderAyudaUsoGenerica = () => responderAyudaUsoGenericaMod();

const responderAyudaSoloComandos = () => responderAyudaSoloComandosMod();

const esFlujoOnboarding = (texto = "", usuario = null) =>
  esFlujoOnboardingMod(texto, usuario, { normMinFn: normMin });

const limpiarSalidaSaludoIA = limpiarSalidaSaludoIAMod;

/** Saludo / apertura sin segunda llamada a IA (solo heurística de intención ya resolvió). */
const responderSaludoPlantillaRapida = (usuario, pregunta = "") =>
  responderSaludoPlantillaRapidaMod(usuario, pregunta, { esFrasePuenteConsultaFn: esFrasePuenteConsulta });

const responderNoAgroConGrounding = (args) =>
  responderNoAgroConGroundingMod(args, {
    getGroundingMaxCharsFn: getGroundingMaxChars,
    generarConGroundingGoogleSearchFn: generarConGroundingGoogleSearch,
    formatearFuentesGroundingWhatsAppFn: formatearFuentesGroundingWhatsApp,
    generarConPromptLibreFn: generarConPromptLibre,
    logConsultaFn: logConsulta,
  });

const responderConsultaLibreIA = (args) =>
  responderConsultaLibreIAMod(args, { generarConPromptLibreFn: generarConPromptLibre });

const generarSaludoIAControlado = (args) =>
  generarSaludoIAControladoMod(args, {
    generarConPromptLibreFn: generarConPromptLibre,
    limpiarSalidaSaludoIAFn: limpiarSalidaSaludoIA,
  });

const esConsultaDolar = esConsultaDolarMod;

const tipoCambioEsFresco = async () =>
  tipoCambioEsFrescoMod({
    queryFn: query,
    toISODateParamFn: toISODateParam,
    fechaISOArgentinaFn: fechaISOArgentina,
  });

const extraerZonaTexto = extraerZonaTextoMod;

const humanizarComandoLocal = humanizarComandoLocalMod;

const humanizarComandoConIA = async ({ usuario, comando, datosTexto }) =>
  humanizarComandoConIAMod(
    { usuario, comando, datosTexto },
    { generarConPromptLibreFn: generarConPromptLibre, humanizarComandoLocalFn: humanizarComandoLocal }
  );

const humanizarRespuestaPrecioConIA = async ({ pregunta = "", textoBase = "", usuario = null } = {}) =>
  humanizarRespuestaPrecioConIAModular({
    pregunta,
    textoBase,
    usuario,
    generarConPromptLibre,
    sanitizarPlaceholders,
  });

const ejecutarComandoYHumanizar = async (args) =>
  ejecutarComandoYHumanizarMod(args, {
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
  });

const responderDolarActual = async () =>
  responderDolarActualMod({
    queryFn: query,
    toISODateParamFn: toISODateParam,
    tieneCompraTipoCambioFn: tieneCompraTipoCambio,
    tieneFuenteTipoCambioFn: tieneFuenteTipoCambio,
    ordenarItemsTipoCambioFn: ordenarItemsTipoCambio,
    formatearItemTipoCambioTextoFn: formatearItemTipoCambioTexto,
    etiquetaTipoCambioFn: etiquetaTipoCambio,
  });

const responderClimaPuntual = async ({ usuario, texto = "", periodo = null }) => {
  const zonaTexto = extraerZonaTexto(texto);
  const zonaLabel = zonaTexto || [usuario?.partido, usuario?.provincia].filter(Boolean).join(", ") || "tu zona";
  const clima = await obtenerClimaFresco({ usuario, texto });
  const ordenados = Array.isArray(clima)
    ? [...clima].sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || "")))
    : [];
  if (!ordenados.length) return `No tengo clima actualizado para ${zonaLabel} en este momento.`;

  let p = periodo;
  if (!p) {
    const t = normMin(texto);
    if (/(fin\s*de\s*semana|finde)/.test(t)) {
      p = "fin_de_semana";
    } else if (/(semana|extendido|pronostico\s*extendido|7\s*dias)/.test(t)) {
      p = "semana";
    } else if (/(pasado\s*manana|pasado\s*ma)/.test(t)) {
      p = "pasado_manana";
    } else if (/\b(manana|mañana)\b/.test(t)) {
      p = "manana";
    } else {
      p = "hoy";
    }
  }

  if (p === "fin_de_semana") {
    const finDeSemanaDays = ordenados.filter(item => {
      const date = new Date(item.fecha + "T12:00:00");
      const day = date.getDay();
      return day === 0 || day === 6; // 0 = Domingo, 6 = Sábado
    });
    if (finDeSemanaDays.length > 0) {
      const lineas = finDeSemanaDays.map(day => {
        const fechaTxt = toISODateParam(day.fecha) || "s/d";
        const heladaTxt = day.helada ? "sí hubo riesgo de helada" : "no se detecta riesgo de helada";
        const dayName = new Date(day.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long" });
        const dayNameCapitalized = dayName.charAt(0).toUpperCase() + dayName.slice(1);
        return `• ${dayNameCapitalized} (${fechaTxt}): ${day.descripcion || "Condiciones variables"} · ${day.temp_min}°/${day.temp_max}° · lluvia ${Number(day.precipitacion || 0).toFixed(1)} mm · Helada: ${heladaTxt}.`;
      });
      return [`🌤️ Clima en ${zonaLabel} (Fin de semana):`, ...lineas].join("\n");
    }
  }

  if (p === "semana" || p === "todos") {
    const lineas = ordenados.map(day => {
      const fechaTxt = toISODateParam(day.fecha) || "s/d";
      const heladaTxt = day.helada ? "sí hubo riesgo de helada" : "no se detecta riesgo de helada";
      const dayName = new Date(day.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long" });
      const dayNameCapitalized = dayName.charAt(0).toUpperCase() + dayName.slice(1);
      return `• ${dayNameCapitalized} (${fechaTxt}): ${day.descripcion || "Condiciones variables"} · ${day.temp_min}°/${day.temp_max}° · lluvia ${Number(day.precipitacion || 0).toFixed(1)} mm · Helada: ${heladaTxt}.`;
    });
    return [`🌤️ Pronóstico extendido en ${zonaLabel} (7 días):`, ...lineas].join("\n");
  }

  let offset = 0;
  if (p === "pasado_manana") offset = 2;
  else if (p === "manana") offset = 1;

  const hoy = ordenados[offset] || ordenados[0] || null;
  if (!hoy) return `No tengo clima actualizado para ${zonaLabel} en este momento.`;
  const fechaTxt = toISODateParam(hoy.fecha) || "s/d";
  const etiquetaDia =
    offset === 0 ? `hoy · ${fechaTxt}` : offset === 1 ? `mañana · ${fechaTxt}` : `pasado mañana · ${fechaTxt}`;
  const heladaTxt = hoy.helada ? "sí hubo riesgo de helada" : "no se detecta riesgo de helada";
  return [
    `🌤️ Clima en ${zonaLabel} (${etiquetaDia}):`,
    `${hoy.descripcion || "Condiciones variables"} · ${hoy.temp_min}°/${hoy.temp_max}° · lluvia ${Number(hoy.precipitacion || 0).toFixed(1)} mm`,
    `Helada: ${heladaTxt}.`,
  ].join("\n");
};

const esPedidoAnalisisContextual = (texto = "") =>
  esPedidoAnalisisContextualMod(texto, { normMinFn: normMin });

const esSolicitudAlertaDirecta = (texto = "") =>
  esSolicitudAlertaDirectaMod(texto, { normMinFn: normMin });

const esPreguntaConfirmacionAlerta = (texto = "") =>
  esPreguntaConfirmacionAlertaMod(texto, { normMinFn: normMin });

const emojiCultivoResumen = (cultivo = "") => formatEmojiCultivoMod(cultivo, { normMinFn: normMin });


const esConsultaInsumos = (texto = "") => esConsultaInsumosMod(texto, { normMinFn: normMin });

const armarContextoDatos = (params = {}) =>
  armarContextoDatosMod({
    ...params,
    marcoReferenciaHacienda: MARCO_REFERENCIA_HACIENDA,
  });

const formatearMoneda = formatearMonedaMod;

const etiquetaTipoCambio = (tipo = "") => etiquetaTipoCambioMod(tipo, { normMinFn: normMin });

const timeoutPromise = timeoutPromiseMod;

const esConsultaIrrelevanteParaIA = (texto = "") =>
  esConsultaIrrelevanteParaIAMod(texto, { normMinFn: normMin });

const timeoutConsultaTemplateMs = (textoPregunta = "") =>
  timeoutConsultaTemplateMsMod(textoPregunta, { esConsultaIrrelevanteParaIAFn: esConsultaIrrelevanteParaIA });

const sanitizarPlaceholders = sanitizarPlaceholdersMod;

const compactarRespuestaSimple = (texto = "", maxLineas = 8) =>
  compactarRespuestaSimpleMod(texto, maxLineas, { normMinFn: normMin });

const detectarNivelUsuarioConsulta = (texto = "") =>
  detectarNivelUsuarioConsultaMod(texto, { normMinFn: normMin });

const adaptarRespuestaPorNivel = adaptarRespuestaPorNivelMod;

const lineaDatoTrazable = lineaDatoTrazableMod;

const embellecerRespuestaWhatsApp = embellecerRespuestaWhatsAppMod;

const construirRespuestaFallback = ({ usuario, precios, tipoCambio, clima }) =>
  construirRespuestaFallbackMod(
    { usuario, precios, tipoCambio, clima },
    {
      formatearMonedaFn: formatearMoneda,
      formatearFechaEsFn: formatearFechaEs,
      ordenarItemsTipoCambioFn: ordenarItemsTipoCambio,
      formatearItemTipoCambioTextoFn: formatearItemTipoCambioTexto,
    }
  );

const construirFallbackDecisionUniversal = ({
  nivel = "INTERMEDIO",
  tema = "mercado",
  detalleFalta = "No tengo el dato puntual actualizado ahora.",
  contexto = "mercado estable",
  accion = "si tenés que decidir hoy, avanzá en forma parcial y revisamos cuando actualice.",
  fechaRef = null,
} = {}) => {
  const bloques = construirFallbackDecisionUniversalMod({
    nivel,
    tema,
    detalleFalta,
    contexto,
    accion,
    fechaRef,
  });
  return adaptarRespuestaPorNivel(nivel, bloques);
};

const responderInsumos = async ({ pregunta = "", usuario = null, nivel = "INTERMEDIO" } = {}) =>
  responderInsumosMod(
    { pregunta, usuario, nivel },
    {
      queryFn: query,
      normMinFn: normMin,
      construirFallbackDecisionUniversalFn: construirFallbackDecisionUniversal,
      formatearMonedaFn: formatearMoneda,
      formatearFechaEsFn: formatearFechaEs,
      adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
    }
  );

const tieneBloqueComplementoWeb = tieneBloqueComplementoWebMod;

const esRespuestaSecaSinDatos = esRespuestaSecaSinDatosMod;

const esRespuestaNoConfiable = esRespuestaNoConfiableMod;

/** Pregunta pide yerba/tabaco pero la respuesta habla sólo de granos (típico fallback erróneo de perfil o timeout). */
const respuestaMercadoDesfasadaVersusPregunta = (pregunta = "", texto = "") =>
  respuestaMercadoDesfasadaVersusPreguntaMod(pregunta, texto, { normMinFn: normMin });

const preguntaQuedoSinCoberturaClave = (pregunta = "", texto = "") =>
  preguntaQuedoSinCoberturaClaveMod(pregunta, texto, { normMinFn: normMin });

/** Recuperar desde BD cuando la plantilla/IA devolvió "sin datos" pero aún no hay bloque web (decoradores ━ solos no cuentan). */
const requiereRecuperacionDatosBd = requiereRecuperacionDatosBdMod;

const esConsultaPrecioEstricto = esConsultaPrecioEstrictoMod;

const respuestaPrecioEscasa = respuestaPrecioEscasaMod;

const cumpleMinimosRespuestaPrecio = cumpleMinimosRespuestaPrecioMod;

const enriquecerConGroundingAgroSiHaceFalta = (args) => {
  let esPreguntaMetaConversacionalFn = null;
  try {
    esPreguntaMetaConversacionalFn = require("../clasificador").esPreguntaMetaConversacional;
  } catch (_e) {
    esPreguntaMetaConversacionalFn = null;
  }
  return enriquecerConGroundingAgroSiHaceFaltaMod(args, {
    tieneBloqueComplementoWebFn: tieneBloqueComplementoWeb,
    respuestaMercadoDesfasadaVersusPreguntaFn: respuestaMercadoDesfasadaVersusPregunta,
    preguntaQuedoSinCoberturaClaveFn: preguntaQuedoSinCoberturaClave,
    esRespuestaSecaSinDatosFn: esRespuestaSecaSinDatos,
    esRespuestaNoConfiableFn: esRespuestaNoConfiable,
    respuestaPrecioEscasaFn: respuestaPrecioEscasa,
    preguntaRequierePipelineConsultaIAFn: preguntaRequierePipelineConsultaIA,
    generarConGroundingGoogleSearchFn: generarConGroundingGoogleSearch,
    sanitizarPlaceholdersFn: sanitizarPlaceholders,
    getGroundingMaxCharsFn: getGroundingMaxChars,
    formatearFuentesGroundingWhatsAppFn: formatearFuentesGroundingWhatsApp,
    esPreguntaMetaConversacionalFn,
  });
};

/**
 * Mercado/hortícola/clima/FX: debe ir por `renderTemplate("consulta")` (IA + grounding), no por atajos
 * `construirFallbackDecisionUniversal` / tema libre legacy.
 */

const extraerTemaDesdePregunta = (texto = "") => extraerTemaDesdePreguntaMod(texto, { normMinFn: normMin });

const detectarTemaConversacion = ({
  ultimaPregunta = "",
  ultimaRespuesta = "",
  cultivosPerfil = [],
} = {}) =>
  detectarTemaConversacionMod({
    ultimaPregunta,
    ultimaRespuesta,
    cultivosPerfil,
    detectarCultivoConsultaFn: detectarCultivoConsulta,
    detectarCultivoEnTextoFn: detectarCultivoEnTexto,
    detectarTemaGeneralFn: detectarTemaGeneral,
  });

const construirContextoRelacionadoTemaLibre = async ({
  tema = "",
  nivel = "INTERMEDIO",
  temaConversacion = null,
  ultimaPregunta = "",
} = {}) =>
  construirContextoRelacionadoTemaLibreMod(
    { tema, nivel, temaConversacion, ultimaPregunta },
    {
      normMinFn: normMin,
      queryFn: query,
      toISODateParamFn: toISODateParam,
      formatearFechaEsFn: formatearFechaEs,
      formatearMonedaFn: formatearMoneda,
      adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
    }
  );

const construirFallbackSeguroDesdeContexto = ({
  pregunta,
  cultivoDetectado = null,
  precios,
  tipoCambio,
  clima,
  nivel = "INTERMEDIO",
}) =>
  construirFallbackSeguroDesdeContextoMod(
    { pregunta, cultivoDetectado, precios, tipoCambio, clima, nivel },
    {
      detectarTemaGeneralFn: detectarTemaGeneral,
      formatearFechaEsFn: formatearFechaEs,
      toISODateParamFn: toISODateParam,
      construirFallbackDecisionUniversalFn: construirFallbackDecisionUniversalMod,
      adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
    }
  );

const construirRespuestaInteligenteGeneral = async ({
  pregunta,
  usuario,
  precios,
  tipoCambio,
  clima,
  nivel = "INTERMEDIO",
}) =>
  construirRespuestaInteligenteGeneralMod(
    { pregunta, usuario, precios, tipoCambio, clima, nivel },
    {
      generarRespuestaConsultaFn: generarRespuestaConsulta,
      esRespuestaSecaSinDatosFn: esRespuestaSecaSinDatos,
      construirFallbackDecisionUniversalFn: construirFallbackDecisionUniversalMod,
      adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
      logConsultaFn: logConsulta,
      fechaISOArgentinaFn: fechaISOArgentina,
    }
  );

const completarPerfilDesdeConsulta = async (usuario, contexto = {}) =>
  completarPerfilDesdeConsultaMod(usuario, contexto, {
    queryFn: query,
    normalizarTextoComandoFn: normalizarTextoComando,
  });

const preguntaNombreProductoNoCubiertaporPerfilUnico = (texto = "") =>
  preguntaNombreProductoNoCubiertaporPerfilUnicoMod(texto, { normMinFn: normMin });

const detectarCultivoConsulta = (texto = "", cultivos = []) =>
  detectarCultivoConsultaMod(texto, cultivos, {
    parseCultivoFn: (v) => parseCultivo(v || ""),
    preguntaNoCubiertaFn: preguntaNombreProductoNoCubiertaporPerfilUnico,
  });

const detectarMercadoConsulta = (texto = "") =>
  detectarMercadoConsultaMod(texto, { normMinFn: normMin });

const resumirValores = (values = []) => resumirValoresMod(values);

const construirSeriePromedioPorFecha = (rows = []) =>
  construirSeriePromedioPorFechaMod(rows, { toISODateParamFn: toISODateParam });

const tonoMercadoDesdeSerie = (serie = []) => tonoMercadoDesdeSerieMod(serie);

const calcularDispersionPct = ({ min = null, max = null, prom = null } = {}) =>
  calcularDispersionPctMod({ min, max, prom });

const responderDatosCultivo = (cultivo, nivel = "INTERMEDIO") =>
  responderDatosCultivoMod(cultivo, nivel, {
    patronSqlCultivoFn: patronSqlCultivo,
    obtenerDisponiblePoliticaResumenUnCultivoFn: obtenerDisponiblePoliticaResumenUnCultivo,
    fechaCivilArgentinaDesdeValorFn: fechaCivilArgentinaDesdeValor,
    queryFn: query,
    construirFallbackDecisionUniversalFn: construirFallbackDecisionUniversal,
    tieneFuentePreciosFn: tieneFuentePrecios,
    normMinFn: normMin,
    resumirValoresFn: resumirValores,
    armarTopSegmentosPapaHortFn: armarTopSegmentosPapaHortMod,
    extraerSetLowerFn: extraerSetLowerMod,
    extraerVolumenSetNoSdFn: extraerVolumenSetNoSdMod,
    extraerSetTrimFn: extraerSetTrimMod,
    formatearFechaEsFn: formatearFechaEs,
    formatearMonedaFn: formatearMoneda,
    toISODateParamFn: toISODateParam,
    construirSeriePromedioPorFechaFn: construirSeriePromedioPorFecha,
    tonoMercadoDesdeSerieFn: tonoMercadoDesdeSerie,
    calcularDispersionPctFn: calcularDispersionPct,
    armarTopMercadosPapaFn: armarTopMercadosPapaMod,
    armarSerieTxtPapaFn: armarSerieTxtPapaMod,
    calidadReferenciaPapaFn: calidadReferenciaPapaMod,
    lineaDatoTrazableFn: lineaDatoTrazable,
    adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
    rankRowsByPriorityFn: rankRowsByPriority,
    seleccionarBasePreciosPriorizadaFn: seleccionarBasePreciosPriorizadaMod,
    clasificarTipoFuentePrecioFn: clasificarTipoFuentePrecio,
    armarLineasPlazasTecnicoFn: armarLineasPlazasTecnicoMod,
    emojiCultivoResumenFn: emojiCultivoResumen,
    nombreCultivoBonitoFn: nombreCultivoBonitoMod,
    construirBloquesRespuestaCultivoGeneralFn: construirBloquesRespuestaCultivoGeneralMod,
  });

/**
 * Tras timeout de plantilla consulta: si hay cultivo detectable, respuesta desde BD/snapshot
 * (hortícolas, papa, etc.) en lugar del listado genérico que suele quedar vacío en `precios.items`.
 */
const fallbackConsultaTimeoutConCultivo = async ({ usuario, textoPregunta, cultivos, nivelUsuario }) =>
  fallbackConsultaTimeoutConCultivoMod(
    { usuario, textoPregunta, cultivos, nivelUsuario },
    {
      detectarCultivoConsultaFn: detectarCultivoConsulta,
      responderDatosCultivoFn: responderDatosCultivo,
    }
  );

const esConsultaEstructuraMercadoFeedlot = (texto = "") =>
  esConsultaEstructuraMercadoFeedlotMod(texto, { normMinFn: normMin });

/**
 * Preguntas abiertas/estratégicas: requieren interpretación de IA (con datos de BD como base),
 * no sólo bloque numérico rígido.
 */
const esConsultaInterpretativaIA = (texto = "") =>
  esConsultaInterpretativaIAMod(texto, { normMinFn: normMin });

/**
 * Política central del bot:
 * - Priorizar datos de BD cuando existan.
 * - Si la consulta requiere interpretación/decisión y faltan patas de datos,
 *   evitar respuestas rígidas y derivar a flujo IA+BD (puede repreguntar/grounding).
 */
const CHATBOT_CORE_POLICY = CHATBOT_CORE_POLICY_MOD;

const debeDerivarAFlujoIaBdPorPolitica = (pregunta = "") =>
  debeDerivarAFlujoIaBdPorPoliticaMod(pregunta, { esConsultaInterpretativaIAFn: esConsultaInterpretativaIA });

const obtenerTcImplicitoDia = (fechaISO = null) =>
  obtenerTcImplicitoDiaMod(fechaISO, { queryFn: query, toISODateParamFn: toISODateParam });

/** Misma fila de spot que el resumen diario (evita saltos 315k vs 432k entre mensajes). */
const obtenerDisponibleRosario = (cultivo = "") =>
  obtenerDisponibleRosarioMod(cultivo, {
    obtenerDisponiblePoliticaResumenUnCultivoFn: obtenerDisponiblePoliticaResumenUnCultivo,
  });

const obtenerFuturoCercano = (cultivo = "") =>
  obtenerFuturoCercanoMod(cultivo, { queryFn: query, toISODateParamFn: toISODateParam });

const construirBloqueEstructuraCultivo = (params) =>
  construirBloqueEstructuraCultivoMod(params, {
    formatearMonedaFn: formatearMoneda,
    toISODateParamFn: toISODateParam,
    etiquetaTipoCambioFn: etiquetaTipoCambio,
  });

const obtenerLecturaNovilloFeedlot = () =>
  obtenerLecturaNovilloFeedlotMod({
    queryFn: query,
    toISODateParamFn: toISODateParam,
    formatearMonedaFn: formatearMoneda,
  });

const construirPosturaGranoUnaLinea = (params) =>
  construirPosturaGranoUnaLineaMod(params, { etiquetaTipoCambioFn: etiquetaTipoCambio });

const responderEstructuraMercadoYFeedlot = (params) =>
  responderEstructuraMercadoYFeedlotMod(params, {
    normMinFn: normMin,
    adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
    queryFn: query,
    toISODateParamFn: toISODateParam,
    formatearMonedaFn: formatearMoneda,
    etiquetaTipoCambioFn: etiquetaTipoCambio,
    obtenerDisponiblePoliticaResumenUnCultivoFn: obtenerDisponiblePoliticaResumenUnCultivo,
  });

const parseFechaConsulta = (texto = "") => parseFechaConsultaMod(texto, { normMinFn: normMin });

const responderPrecioPorMercado = (args) =>
  responderPrecioPorMercadoMod(args, {
    queryFn: query,
    toISODateParamFn: toISODateParam,
    formatearMonedaFn: formatearMoneda,
    normMinFn: normMin,
    construirFallbackDecisionUniversalFn: construirFallbackDecisionUniversal,
    adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
    lineaDatoTrazableFn: lineaDatoTrazable,
    rankRowsByPriorityFn: rankRowsByPriority,
  });

const responderDivisionPorPuerto = (args) =>
  responderDivisionPorPuertoMod(args, {
    queryFn: query,
    toISODateParamFn: toISODateParam,
    formatearMonedaFn: formatearMoneda,
    normMinFn: normMin,
    construirFallbackDecisionUniversalFn: construirFallbackDecisionUniversal,
    adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
  });

const esConsultaCoberturaMaiz = (texto = "") => esConsultaCoberturaMaizMod(texto, { normMinFn: normMin });

const esConsultaEstructuraMercado = (texto = "") => esConsultaEstructuraMercadoMod(texto, { normMinFn: normMin });

const esReclamoConsistenciaMercado = (texto = "") => esReclamoConsistenciaMercadoMod(texto, { normMinFn: normMin });

const resolverSpotRosarioComparable = (cultivo = "") =>
  resolverSpotRosarioComparableMod(cultivo, {
    queryFn: query,
    toISODateParamFn: toISODateParam,
  });

const resolverFuturosCultivo = (cultivo = "", mesesSolicitados = []) =>
  resolverFuturosCultivoMod(cultivo, mesesSolicitados, {
    queryFn: query,
    toISODateParamFn: toISODateParam,
    normMinFn: normMin,
  });

const responderEstructuraMercado = async ({ pregunta = "", cultivoHint = null }) =>
  responderEstructuraMercadoMod({
    pregunta,
    cultivoHint,
    detectarCultivoEnTextoFn: detectarCultivoEnTexto,
    extraerPosicionesSolicitadasFn: extraerPosicionesSolicitadas,
    calcularEstructuraMercadoFn: calcularEstructuraMercado,
  });

const parseMesAnioPosicion = (posicion = "") =>
  parseMesAnioPosicionMod(posicion, { normMinFn: normMin });

const extraerPosicionesSolicitadas = (texto = "") =>
  extraerPosicionesSolicitadasMod(texto, { normMinFn: normMin });

const esModoTecnicoOn = (texto = "") => {
  const t = normMin(texto);
  return /\bmodo tecnico on\b|\btecnico on\b|\bmodo tecnico\b/.test(t);
};

const responderCoberturaMaiz = (args) =>
  responderCoberturaMaizMod(args, {
    queryFn: query,
    toISODateParamFn: toISODateParam,
    formatearMonedaFn: formatearMoneda,
    extraerPosicionesSolicitadasFn: extraerPosicionesSolicitadas,
    parseMesAnioPosicionFn: parseMesAnioPosicion,
    normMinFn: normMin,
  });

const esConsultaVenta = (texto = "") => {
  const t = normalizarTextoComando(texto).toLowerCase();
  if (t.startsWith("analizar ")) return true;
  return [
    "vendo",
    "vender",
    "conviene",
    "espero",
    "precio",
    "margen",
    "ganancia",
    "resultado",
  ].some((k) => t.includes(k));
};

const extraerComparacionConFactor = (texto = "") => {
  const t = String(texto || "").toLowerCase().replace(",", ".");
  const match = t.match(
    /(\d+(?:\.\d+)?)\s*usd?\s*\+\s*(\d+(?:\.\d+)?)\s*o\s*(\d+(?:\.\d+)?)\s*usd?\s*\+\s*(\d+(?:\.\d+)?)(?:.*?factor\s*(?:de)?\s*(\d+(?:\.\d+)?))?/i
  );
  if (!match) return null;
  const usdA = Number(match[1]);
  const plusA = Number(match[2]);
  const usdB = Number(match[3]);
  const plusB = Number(match[4]);
  const factorRaw = Number(match[5]);
  const factor = Number.isFinite(factorRaw) && factorRaw > 0 ? factorRaw : 1;
  if (![usdA, plusA, usdB, plusB].every((n) => Number.isFinite(n))) return null;
  return { usdA, plusA, usdB, plusB, factor };
};

const responderComparacionConFactor = (texto = "") => {
  const data = extraerComparacionConFactor(texto);
  if (!data) return null;
  const netoA = data.usdA + data.plusA / data.factor;
  const netoB = data.usdB + data.plusB / data.factor;
  const etiquetaA = `${data.usdA} USD + ${data.plusA}`;
  const etiquetaB = `${data.usdB} USD + ${data.plusB}`;
  const diff = Math.abs(netoA - netoB);
  const equivalentes = diff < 0.05;
  const mejor = netoA >= netoB ? etiquetaA : etiquetaB;
  const valorRef = ((netoA + netoB) / 2).toFixed(2);
  const recomendacionIncertidumbre = equivalentes
    ? `Si no sabés cómo va a dar la calidad, conviene *${etiquetaA}* (más base, menos variabilidad).`
    : `Si hay incertidumbre de calidad, conviene *${mejor}* por menor exposición relativa al premio.`;
  const recomendacionConfianza = equivalentes
    ? `Si estás confiado en el análisis, podés jugar *${etiquetaB}* (más premio, más variable).`
    : `Si estás muy confiado en el análisis, podés evaluar la opción alternativa para capturar premio.`;
  return [
    "📐 *Análisis de ofertas (girasol entregado)*",
    "",
    "Haciendo los números:",
    `- Opción A (${etiquetaA}): *${netoA.toFixed(2)} USD/t* (factor ${data.factor})`,
    `- Opción B (${etiquetaB}): *${netoB.toFixed(2)} USD/t* (factor ${data.factor})`,
    equivalentes
      ? `👉 Con factor *${data.factor}*, las dos opciones te dan prácticamente lo mismo: *~${valorRef} USD/t*.`
      : `👉 Con factor *${data.factor}*, la mejor oferta es *${mejor}* por ~*${diff.toFixed(2)} USD/t*.`,
    "",
    "👉 La diferencia está en el riesgo:",
    `- *${etiquetaA}* → más seguro (más base).`,
    `- *${etiquetaB}* → más variable (depende más del análisis).`,
    "",
    `👉 ${recomendacionIncertidumbre}`,
    `👉 ${recomendacionConfianza}`,
    "",
    "Si querés, te lo recalculo con otro factor o con castigos de calidad distintos.",
  ].join("\n");
};

const esConsultaHaciendaVenta = (texto = "") => esConsultaHaciendaVentaMod(texto, { normMinFn: normMin });

const detectarActivosRelacion = (texto = "") => detectarActivosRelacionMod(texto, { normMinFn: normMin });

const esConsultaRelacionIntercambio = (texto = "") =>
  esConsultaRelacionIntercambioMod(texto, { normMinFn: normMin });

const obtenerPrecioActivoRelacion = (activo) =>
  obtenerPrecioActivoRelacionMod(activo, {
    obtenerDisponiblePoliticaResumenUnCultivoFn: obtenerDisponiblePoliticaResumenUnCultivo,
    obtenerTcImplicitoDiaFn: obtenerTcImplicitoDia,
    toISODateParamFn: toISODateParam,
    queryFn: query,
  });

const consultaPideDisponibleYMatba = (texto = "") =>
  consultaPideDisponibleYMatbaMod(texto, { normMinFn: normMin });

const tokenPosicionPorMes = (texto = "") => tokenPosicionPorMesMod(texto, { normMinFn: normMin });

const obtenerFuturoMatbaReferencia = async ({ cultivo = "", posicionLike = "" } = {}) =>
  obtenerFuturoMatbaReferenciaMod({
    cultivo,
    posicionLike,
    queryFn: query,
    normMinFn: normMin,
    toISODateParamFn: toISODateParam,
  });

const responderRelacionIntercambio = async ({ texto = "", nivel = "INTERMEDIO", modoOrientativo = false } = {}) =>
  responderRelacionIntercambioMod(
    { texto, nivel, modoOrientativo },
    {
      normMinFn: normMin,
      consultaPideDisponibleYMatbaFn: consultaPideDisponibleYMatba,
      tokenPosicionPorMesFn: tokenPosicionPorMes,
      obtenerFuturoMatbaReferenciaFn: obtenerFuturoMatbaReferencia,
      obtenerPrecioActivoRelacionFn: obtenerPrecioActivoRelacion,
      formatearMonedaFn: formatearMoneda,
      adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
    }
  );

const humanizarRelacionConIA = async ({ pregunta = "", textoBase = "" } = {}) =>
  humanizarRelacionConIAMod({ pregunta, textoBase }, { generarConPromptLibreFn: generarConPromptLibre, sanitizarPlaceholdersFn: sanitizarPlaceholders });

const detectarCategoriaHacienda = (texto = "") => detectarCategoriaHaciendaMod(texto, { normMinFn: normMin });

const responderHaciendaSimple = async (texto = "", nivel = "INTERMEDIO") =>
  responderHaciendaSimpleMod(
    { texto, nivel },
    {
      detectarCategoriaHaciendaFn: detectarCategoriaHacienda,
      queryFn: query,
      toISODateParamFn: toISODateParam,
      construirFallbackDecisionUniversalFn: construirFallbackDecisionUniversal,
      formatearMonedaFn: formatearMoneda,
      adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
      lineaDatoTrazableFn: lineaDatoTrazable,
    }
  );

const evaluarRespuestaIASinContexto = evaluarRespuestaIASinContextoMod;

/** Superficie compartida para rutas del router (ex-`procesarConsulta`). */
module.exports = {
  axios,
  query,
  normMin,
  toISODateParam,
  renderTemplate,
  generarConPromptLibre,
  obtenerPerfil,
  completarGeolocalizacionSiFalta,
  normalizarWhatsapp,
  parseCultivo,
  obtenerDolarFresco,
  obtenerUltimosPreciosPorCultivos,
  obtenerUltimoTipoCambio,
  obtenerClimaZona,
  obtenerClimaFresco,
  extraerZonaTexto,
  detectarCultivoConsulta,
  detectarCultivoEnTexto,
  detectarMercadoConsulta,
  detectarNivelUsuarioConsulta,
  parseFechaConsulta,
  responderDatosCultivo,
  humanizarRespuestaPrecioConIA,
  limpiarMarcadoresRespuestaPrecio,
  enriquecerConGroundingAgroSiHaceFalta,
  responderClimaPuntual,
  responderNoAgroConGrounding,
  responderConsultaLibreIA,
  generarSaludoIAControlado,
  ejecutarComandoYHumanizar,
  compactarRespuestaSimple,
  sanitizarPlaceholders,
  responderSaludoPlantillaRapida,
  armarContextoDatos,
  configurarAlerta,
  listarAlertas,
  obtenerResumenFinanciero,
  registrarGasto,
  registrarVenta,
  obtenerContextoPlanPorWhatsapp,
  puedeUsarAlertas,
  responderHaciendaSimple,
  esConsultaHaciendaVenta,
  esConsultaDolar,
  esConsultaInsumos,
  responderInsumos,
  responderDolarActual,
  tipoCambioEsFresco,
  construirFallbackDecisionUniversal,
  evaluarRespuestaIASinContexto,
  extraerTemaDesdePregunta,
  logConsultaRoute,
  construirRespuestaInteligenteGeneral,
};
