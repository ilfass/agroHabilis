const axios = require("axios");
const { query } = require("../../config/database");
const {
  generarRespuestaConsulta,
  generarConPromptLibre,
  generarConGroundingGoogleSearch,
  getGroundingMaxChars,
} = require("../gemini");
const { guardarConsulta } = require("../../models/consulta");
const { parseCultivo } = require("../analisis_venta");
const { guiarCalculoCosto } = require("../calculadora_costos");
const {
  normalizarWhatsapp,
  buscarPorWhatsapp,
  actualizarUsuario,
  obtenerPerfil,
} = require("../../models/usuario");
const { renderTemplate } = require("../../templates");
const { rankRowsByPriority } = require("../../utils/source_scoring");
const {
  detectarIntencionIA,
  inferirComandoNatural,
  resolverComandoAlias,
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

const normMin = (texto = "") =>
  String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

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
  { key: "papa", patrones: ["papa", "patata"] },
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

const responderClimaPuntual = async ({ usuario, texto = "" }) => {
  const zonaTexto = extraerZonaTexto(texto);
  const zonaLabel = zonaTexto || [usuario?.partido, usuario?.provincia].filter(Boolean).join(", ") || "tu zona";
  const clima = await obtenerClimaFresco({ usuario, texto });
  const ordenados = Array.isArray(clima)
    ? [...clima].sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || "")))
    : [];
  const t = normMin(texto);
  let offset = 0;
  if (/(pasado\s*manana|pasado\s*ma)/.test(t)) offset = 2;
  else if (/\b(manana|mañana)\b/.test(t)) offset = 1;
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

const enriquecerConGroundingAgroSiHaceFalta = (args) =>
  enriquecerConGroundingAgroSiHaceFaltaMod(args, {
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
  });

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

const procesarConsulta = async (numeroWhatsapp, pregunta, opciones = {}) => {
  const textoPregunta = String(pregunta || "").trim();
  if (!textoPregunta) {
    return "No recibí la consulta. Escribime tu pregunta y te respondo con datos actualizados.";
  }

  if (esDespedidaSimpleNoOperativa(textoPregunta)) {
    const perfilDespedida = await obtenerPerfil(numeroWhatsapp);
    const outDespedida = responderDespedidaRapida(perfilDespedida);
    await guardarConsulta({
      usuarioId: perfilDespedida?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: outDespedida,
      tokensUsados: null,
      iaSinContexto: false,
    });
    return outDespedida;
  }

  /** Pregunta por comandos/menú: no pasar por plantilla consulta ni mercado. */
  if (esPreguntaAyudaComandosOMenu(textoParaClasificacionSaludo(textoPregunta)) || esPreguntaAyudaComandosOMenu(textoPregunta)) {
    logConsultaRoute(numeroWhatsapp, "AYUDA_COMANDOS_TEMPRANO", {});
    const perfilCmd = await obtenerPerfil(numeroWhatsapp);
    const outCmd = responderAyudaSoloComandos();
    await guardarConsulta({
      usuarioId: perfilCmd?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: outCmd,
      tokensUsados: null,
      iaSinContexto: false,
    });
    return outCmd;
  }

  const perfilInicial = await obtenerPerfil(numeroWhatsapp);
  const usuario = await completarGeolocalizacionSiFalta(perfilInicial);

  if (esPedidoOcioNoOperativo(textoPregunta)) {
    const outOcio =
      "No puedo reproducir música desde acá 🎵, pero si querés te paso una recomendación rápida.\nY cuando quieras volvemos a precios, clima o mercado.";
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: outOcio,
      tokensUsados: null,
      iaSinContexto: false,
    });
    return outOcio;
  }

  if (esPedidoEstadoCieloConversacional(textoPregunta)) {
    const baseClima = await responderClimaPuntual({ usuario, texto: textoPregunta });
    const outClima = await enriquecerConGroundingAgroSiHaceFalta({
      pregunta: `clima ${textoPregunta}`,
      textoBase: baseClima,
    });
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: outClima,
      tokensUsados: null,
      iaSinContexto: false,
    });
    return outClima;
  }

  if (esReclamoFaltaDatosConversacional(textoPregunta)) {
    const ultima = await obtenerUltimaInteraccion({
      usuarioId: usuario?.id || null,
      whatsapp: numeroWhatsapp,
    });
    const base = responderReclamoFaltaDatosConversacional();
    const out = await enriquecerConGroundingAgroSiHaceFalta({
      pregunta: String(ultima?.pregunta || textoPregunta),
      textoBase: base,
    });
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: out,
      tokensUsados: null,
      iaSinContexto: false,
    });
    return out;
  }

  try {
    const ultimaSeg = await obtenerUltimaInteraccion({ usuarioId: usuario?.id, whatsapp: numeroWhatsapp });
    if (ultimaSeg && esSeguimientoCalendarioTrasMetaFecha(textoPregunta, ultimaSeg)) {
      const off = offsetSeguimientoCalendarioPedido(textoPregunta);
      if (off != null) {
        const outSeg = responderSeguimientoMetaFechaArgentina(off);
        await guardarConsulta({
          usuarioId: usuario?.id || null,
          whatsapp: normalizarWhatsapp(numeroWhatsapp),
          pregunta: textoPregunta,
          respuesta: outSeg,
          tokensUsados: null,
          iaSinContexto: false,
        });
        logConsultaRoute(numeroWhatsapp, "META_FECHA_SEGUIMIENTO", { offset: off });
        return outSeg;
      }
    }
  } catch (_e) {
    /* continuar con el flujo normal */
  }

  const cultivos = usuario?.cultivos || [];
  const cultivoDetectado = detectarCultivoConsulta(textoPregunta, cultivos);
  const nivelUsuario = detectarNivelUsuarioConsulta(textoPregunta);
  const mercadoDetectado = detectarMercadoConsulta(textoPregunta);
  const fechaConsulta = parseFechaConsulta(textoPregunta);
  let cultivoContextual = cultivoDetectado;
  let preguntaExpandida = textoPregunta;
  const declaracionHectareas = parseDeclaracionHectareas(textoPregunta);
  const onboardingMode = esFlujoOnboarding(textoPregunta, usuario);
  const forzarRespuestaIA = !onboardingMode || esReclamoConsistenciaMercado(textoPregunta);
  const comandoAlias = resolverComandoAlias(
    textoPregunta
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase()
  );

  // Comandos de plan explícitos: ruta dura y respuesta determinística.
  if (["QUIERO PLAN GRATIS", "QUIERO PLAN BASICO", "QUIERO PLAN PRO"].includes(comandoAlias)) {
    if (!usuario?.id) {
      return "Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.";
    }
    const { actualizarPlanPorWhatsapp } = require("../planes");
    const objetivo = comandoAlias.endsWith("PRO")
      ? "pro"
      : comandoAlias.endsWith("BASICO")
      ? "basico"
      : "gratis";
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
        logConsulta({
          level: "error",
          whatsapp: numeroWhatsapp,
          route: "mercado_pago_crear_suscripcion",
          message: `Error creando suscripción MP: ${error.message}`,
        });
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
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: outPlan,
      tokensUsados: null,
      iaSinContexto: false,
    });
    return outPlan;
  }

  if (esPreguntaBloquesPlantillaPlan(textoPregunta)) {
    logConsultaRoute(numeroWhatsapp, "PLAN_BLOQUES_PLANTILLA", {});
    const outPlanes = responderBloquesPlantillaPlan(usuario);
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: outPlanes,
      tokensUsados: null,
      iaSinContexto: false,
    });
    return outPlanes;
  }

  if (usuario?.id) {
    try {
      const { manejarInventarioWhatsapp } = require("../inventario/whatsapp_flow");
      const inv = await manejarInventarioWhatsapp({
        texto: textoPregunta,
        usuarioId: usuario.id,
        numeroWhatsapp,
      });
      if (inv?.manejado && inv.respuesta != null) {
        logConsultaRoute(numeroWhatsapp, "INVENTARIO_WA", {});
        await guardarConsulta({
          usuarioId: usuario.id,
          whatsapp: normalizarWhatsapp(numeroWhatsapp),
          pregunta: textoPregunta,
          respuesta: inv.respuesta,
          tokensUsados: null,
          iaSinContexto: false,
        });
        return inv.respuesta;
      }
    } catch (errInventario) {
      logConsulta({
        level: "error",
        whatsapp: numeroWhatsapp,
        route: "inventario_wa",
        message: errInventario?.message || String(errInventario),
      });
    }
  }

  if (onboardingMode && declaracionHectareas) {
    if (!usuario?.id) {
      return `Para guardar ${declaracionHectareas.hectareas} ha de ${declaracionHectareas.cultivo} primero necesito tu perfil activo. Escribime "Hola" y te guío en el onboarding.`;
    }
    const cultivoPerfil = (cultivos || []).find(
      (c) => parseCultivo(c.cultivo) === parseCultivo(declaracionHectareas.cultivo)
    );
    if (!cultivoPerfil) {
      const actuales = (cultivos || []).map((c) => c.cultivo).filter(Boolean);
      const actualesTxt = actuales.length ? ` Hoy tengo cargado: ${actuales.join(", ")}.` : "";
      return `No tengo ${declaracionHectareas.cultivo} en tu perfil.${actualesTxt} Si querés lo agregamos con COMPLETAR PERFIL.`;
    }
    await query(
      `
        UPDATE usuario_cultivos
        SET hectareas = $3
        WHERE usuario_id = $1
          AND LOWER(cultivo) = LOWER($2)
      `,
      [usuario.id, declaracionHectareas.cultivo, declaracionHectareas.hectareas]
    );
    const textoMercado = await responderDatosCultivo(declaracionHectareas.cultivo, nivelUsuario);
    const salida = [
      `Perfecto, guardé ${declaracionHectareas.hectareas} ha para ${declaracionHectareas.cultivo}.`,
      "---------------------",
      textoMercado,
      "",
      `Si querés, ahora sí te hago el análisis completo: "¿Me conviene vender ${declaracionHectareas.cultivo} esta semana?"`,
    ].join("\n");
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: salida,
      tokensUsados: null,
    });
    return salida;
  }

  // Paridad / carry / cobertura: usar ruta numérica sólo en consultas cerradas.
  // Las consultas estratégicas/interpretativas pasan al pipeline IA+BD (template consulta),
  // respetando la política central del bot.
  if (esConsultaEstructuraMercadoFeedlot(textoPregunta) && !debeDerivarAFlujoIaBdPorPolitica(textoPregunta)) {
    logConsultaRoute(numeroWhatsapp, "STRUCTURE_MARKET", {
      modo: "directo",
      cultivo: cultivoContextual || detectarCultivoEnTexto(textoPregunta) || null,
    });
    const estructura = await responderEstructuraMercadoYFeedlot({
      texto: textoPregunta,
      nivel: nivelUsuario,
    });
    if (estructura) {
      const estructuraFinal = await enriquecerConGroundingAgroSiHaceFalta({
        pregunta: textoPregunta,
        textoBase: estructura,
      });
      await registrarEventoRuta({
        whatsapp: numeroWhatsapp,
        route: "STRUCTURE_MARKET",
        estado: "ok",
        cultivo: cultivoContextual || detectarCultivoEnTexto(textoPregunta) || "multi",
        faltantes: "",
        inconsistente: false,
      });
      await guardarConsulta({
        usuarioId: usuario?.id || null,
        whatsapp: normalizarWhatsapp(numeroWhatsapp),
        pregunta: textoPregunta,
        respuesta: estructuraFinal,
        tokensUsados: null,
      });
      return estructuraFinal;
    }
  }

  if (esReclamoConsistenciaMercado(textoPregunta)) {
    const ultima = await obtenerUltimaInteraccion({
      usuarioId: usuario?.id || null,
      whatsapp: numeroWhatsapp,
    });
    const contextoPrevio = `${ultima?.pregunta || ""} ${ultima?.respuesta || ""}`;
    if (esConsultaEstructuraMercado(contextoPrevio)) {
      logConsultaRoute(numeroWhatsapp, "STRUCTURE_FOLLOWUP", {
        cultivo: cultivoContextual || detectarCultivoEnTexto(contextoPrevio) || null,
        ultimaPregunta: String(ultima?.pregunta || "").slice(0, 90),
      });
      const estructura = await responderEstructuraMercado({
        pregunta: `${ultima?.pregunta || ""} ${textoPregunta}`.trim(),
        cultivoHint: cultivoContextual || detectarCultivoEnTexto(contextoPrevio) || null,
      });
      if (estructura) {
        const estructuraFinal = await enriquecerConGroundingAgroSiHaceFalta({
          pregunta: textoPregunta,
          textoBase: estructura.texto,
        });
        await registrarEventoRuta({
          whatsapp: numeroWhatsapp,
          route: "STRUCTURE_FOLLOWUP",
          estado: estructura.estado,
          cultivo: estructura.cultivo,
          faltantes: (estructura.faltantes || []).join(", "),
          inconsistente: estructura.inconsistente,
        });
        await guardarConsulta({
          usuarioId: usuario?.id || null,
          whatsapp: normalizarWhatsapp(numeroWhatsapp),
          pregunta: textoPregunta,
          respuesta: estructuraFinal,
          tokensUsados: null,
        });
        return estructuraFinal;
      }
    }
  }

  if (esSolicitudAlertaDirecta(textoPregunta)) {
    const planCtx = await obtenerContextoPlanPorWhatsapp(numeroWhatsapp);
    if (!puedeUsarAlertas(planCtx.planEfectivo)) {
      const msgPlan =
        "Entiendo: querés una alerta de precio y es una acción operativa.\n" +
        "En *Plan Gratis* no puedo activarla.\n" +
        "Si querés, la habilitamos al pasar a *Plan Básico* y te la dejo cargada enseguida.\n" +
        "Escribí: *QUIERO PLAN BASICO*.";
      await guardarConsulta({
        usuarioId: usuario?.id || null,
        whatsapp: normalizarWhatsapp(numeroWhatsapp),
        pregunta: textoPregunta,
        respuesta: msgPlan,
        tokensUsados: null,
      });
      return msgPlan;
    }
    const base = await configurarAlerta(numeroWhatsapp, textoPregunta);
    const confirmacion = `${base}\nTe confirmo que quedó cargada. Si querés, también te configuro otra para ternero.`;
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: confirmacion,
      tokensUsados: null,
    });
    return confirmacion;
  }

  if (esPreguntaConfirmacionAlerta(textoPregunta)) {
    const ultima = await obtenerUltimaInteraccion({
      usuarioId: usuario?.id || null,
      whatsapp: numeroWhatsapp,
    });
    const ultimaPregunta = normMin(ultima?.pregunta || "");
    const ultimaRespuesta = normMin(ultima?.respuesta || "");
    const veniaDeFlujoAlerta =
      esSolicitudAlertaDirecta(ultima?.pregunta || "") ||
      /alerta|avisame|av[ií]same|precio/.test(ultimaPregunta);
    if (veniaDeFlujoAlerta) {
      const planCtx = await obtenerContextoPlanPorWhatsapp(numeroWhatsapp);
      let textoConfirmacion;
      if (/alerta creada|quedo cargada|qued[oó] cargada|#\d+/.test(ultimaRespuesta)) {
        textoConfirmacion =
          "Sí, te confirmo que la alerta quedó cargada ✅. Cuando se cumpla el umbral te aviso por este chat.";
      } else if (!puedeUsarAlertas(planCtx.planEfectivo)) {
        textoConfirmacion =
          "No quedó cargada todavía. En Plan Gratis no puedo activar alertas de precio.\n" +
          "Si querés, la activo al instante cuando pases a Plan Básico: escribí *QUIERO PLAN BASICO*.";
      } else {
        textoConfirmacion =
          "Todavía no quedó confirmada. Si querés, decime de nuevo el formato exacto y la cargo ahora (ej: 'avisame cuando novillo supere 4800').";
      }
      await guardarConsulta({
        usuarioId: usuario?.id || null,
        whatsapp: normalizarWhatsapp(numeroWhatsapp),
        pregunta: textoPregunta,
        respuesta: textoConfirmacion,
        tokensUsados: null,
      });
      return textoConfirmacion;
    }
  }

  if (esConsultaPoliticaAlertas(textoPregunta)) {
    const outPoliticaAlertas = await responderPoliticaAlertasDeterministicaModular({
      numeroWhatsapp,
      obtenerContextoPlanPorWhatsapp,
      puedeUsarAlertas,
    });
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: outPoliticaAlertas,
      tokensUsados: null,
    });
    return outPoliticaAlertas;
  }

  const intencionIA =
    opciones && Object.prototype.hasOwnProperty.call(opciones, "intencionPrecalculada")
      ? opciones.intencionPrecalculada
      : await detectarIntencionIA(textoPregunta);
  const comandoHeur = inferirComandoNatural(textoPregunta);
  const mapaHeurAComando = {
    "MI RESUMEN": "MI_RESUMEN",
    "MIS ALERTAS": "MIS_ALERTAS",
    "MI MARGEN": "MI_MARGEN",
    "__ALERTA__": "CREAR_ALERTA",
    "__GASTO__": "REGISTRAR_GASTO",
    "__VENTA__": "REGISTRAR_VENTA",
    "MI PLAN": "PLANES",
  };
  const prioridadIntencionIA = ["saludo", "meta_fecha", "meta_hora", "mensaje_ruido", "ayuda_uso", "tipo_cambio", "no_agro"].includes(
    intencionIA?.tipo
  );
  const intencion = prioridadIntencionIA
    ? intencionIA
    : intencionIA?.tipo === "comando"
    ? intencionIA
    : mapaHeurAComando[comandoHeur]
    ? { tipo: "comando", comando: mapaHeurAComando[comandoHeur], parametros: {} }
    : intencionIA;

  if (intencion?.tipo === "meta_fecha") {
    const out = responderMetaFechaHoyArgentina();
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: out,
      tokensUsados: null,
      iaSinContexto: false,
    });
    return out;
  }

  if (intencion?.tipo === "meta_hora") {
    const out = responderMetaHoraAhoraArgentina();
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: out,
      tokensUsados: null,
      iaSinContexto: false,
    });
    return out;
  }

  if (intencion?.tipo === "mensaje_ruido") {
    const out = responderMensajeRuido();
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: out,
      tokensUsados: null,
      iaSinContexto: false,
    });
    return out;
  }

  if (intencion?.tipo === "ayuda_uso") {
    const rec = String(intencion.parametros?.recurso || "otro").toLowerCase();
    let out = responderAyudaUsoGenerica();
    if (rec === "venta") out = responderAyudaRegistrarVenta();
    else if (rec === "gasto") out = responderAyudaRegistrarGasto();
    else if (rec === "comandos") {
      out = responderAyudaSoloComandos();
    }
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: out,
      tokensUsados: null,
      iaSinContexto: false,
    });
    return out;
  }

  if (intencion?.tipo === "tipo_cambio") {
    logConsultaRoute(numeroWhatsapp, "TIPO_CAMBIO_RAPIDO", {});
    try {
      const fresco = await tipoCambioEsFresco();
      if (!fresco) await obtenerDolarFresco();
    } catch (_e) {
      // si falla fuente en vivo, seguimos con lo disponible en DB
    }
    const textoDolar = await responderDolarActual();
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: textoDolar,
      tokensUsados: null,
      iaSinContexto: false,
    });
    return textoDolar;
  }

  if (esConsultaRelacionIntercambio(textoPregunta)) {
    logConsultaRoute(numeroWhatsapp, "RELACION_INTERCAMBIO", {});
    const relacionTxt = await responderRelacionIntercambio({
      texto: textoPregunta,
      nivel: nivelUsuario,
      modoOrientativo: false,
    });
    if (relacionTxt) {
      const noMezclaCierres = /__NO_MEZCLA_CIERRES__/.test(relacionTxt);
      const relacionBase = String(relacionTxt || "").replace(/__NO_MEZCLA_CIERRES__/g, "").trim();
      if (noMezclaCierres) {
        await guardarConsulta({
          usuarioId: usuario?.id || null,
          whatsapp: normalizarWhatsapp(numeroWhatsapp),
          pregunta: textoPregunta,
          respuesta: relacionBase,
          tokensUsados: null,
        });
        return relacionBase;
      }
      const relacionHuman = await humanizarRelacionConIA({ pregunta: textoPregunta, textoBase: relacionTxt });
      const out = await enriquecerConGroundingAgroSiHaceFalta({
        pregunta: textoPregunta,
        textoBase: relacionHuman,
      });
      await guardarConsulta({
        usuarioId: usuario?.id || null,
        whatsapp: normalizarWhatsapp(numeroWhatsapp),
        pregunta: textoPregunta,
        respuesta: out,
        tokensUsados: null,
      });
      return out;
    }
  }

  if (intencion?.tipo === "no_agro") {
    logConsultaRoute(numeroWhatsapp, "NO_AGRO_GROUNDING", {});
    const outNoAgro = await responderNoAgroConGrounding({ usuario, pregunta: textoPregunta });
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: outNoAgro,
      tokensUsados: null,
      iaSinContexto: false,
      iaProvider: null,
      iaProviderTrace: [{ stage: "no_agro", value: "grounding_o_prompt_libre" }],
    });
    return outNoAgro;
  }

  if (intencion?.tipo === "saludo") {
    const preguntaSaludo = textoParaClasificacionSaludo(textoPregunta);
    const bienvenida = intencion?.parametros?.saludo_heuristica
      ? responderSaludoPlantillaRapida(usuario, preguntaSaludo)
      : await generarSaludoIAControlado({
          usuario,
          pregunta: preguntaSaludo,
        });
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: bienvenida,
      tokensUsados: null,
      iaSinContexto: false,
    });
    return bienvenida;
  }

  if (intencion?.tipo === "comando" && intencion?.comando) {
    const salidaComando = await ejecutarComandoYHumanizar({
      comando: intencion.comando,
      parametros: intencion.parametros || {},
      usuario,
      numeroWhatsapp,
      textoOriginal: textoPregunta,
    });
    if (salidaComando) {
      const salidaComandoFinal =
        nivelUsuario === "SIMPLE"
          ? compactarRespuestaSimple(sanitizarPlaceholders(salidaComando), 8)
          : sanitizarPlaceholders(salidaComando);
      await guardarConsulta({
        usuarioId: usuario?.id || null,
        whatsapp: normalizarWhatsapp(numeroWhatsapp),
        pregunta: textoPregunta,
        respuesta: salidaComandoFinal,
        tokensUsados: null,
      });
      return salidaComandoFinal;
    }
  }

  if (
    intencion?.tipo === "consulta_libre" &&
    !esAfirmacionBreve(textoPregunta) &&
    !preguntaRequierePipelineConsultaIA(textoPregunta)
  ) {
    logConsultaRoute(numeroWhatsapp, "CONSULTA_LIBRE_IA", {});
    const outBase = await responderConsultaLibreIA({ usuario, pregunta: textoPregunta });
    const out = await enriquecerConGroundingAgroSiHaceFalta({
      pregunta: textoPregunta,
      textoBase: limpiarMarcadoresRespuestaPrecio(outBase),
    });
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: out,
      tokensUsados: null,
      iaSinContexto: false,
      iaProvider: "prompt_libre_consulta",
      iaProviderTrace: [{ stage: "consulta_libre", value: "generarConPromptLibre" }],
    });
    return out;
  }

  if (!forzarRespuestaIA && esConsultaDolar(textoPregunta)) {
    try {
      const fresco = await tipoCambioEsFresco();
      if (!fresco) await obtenerDolarFresco();
    } catch (_e) {
      // si falla fuente en vivo, seguimos con lo disponible en DB
    }
    const textoDolar = await responderDolarActual();
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: textoDolar,
      tokensUsados: null,
    });
    return textoDolar;
  }

  // Clima: siempre por plantilla `consulta` (IA + grounding si aplica). La ruta corta responderClimaPuntual
  // omitía grounding y compactar/contexto; además esFlujoOnboarding(!usuario.id) forzaba esa ruta a menudo.

  if (!cultivoContextual && esPedidoAnalisisContextual(textoPregunta)) {
    const ultima = await obtenerUltimaInteraccion({
      usuarioId: usuario?.id || null,
      whatsapp: numeroWhatsapp,
    });
    if (ultima?.pregunta) preguntaExpandida = `${ultima.pregunta} ${textoPregunta}`;
    const cultivoPrevio = detectarCultivoConsulta(ultima?.pregunta || "", cultivos);
    if (cultivoPrevio) cultivoContextual = cultivoPrevio;
  }

  if (!forzarRespuestaIA && esAfirmacionBreve(textoPregunta)) {
    const ultima = await obtenerUltimaInteraccion({
      usuarioId: usuario?.id || null,
      whatsapp: numeroWhatsapp,
    });
    const ultimaPreguntaTxt = String(ultima?.pregunta || "");
    const ultimaRespuestaTxt = String(ultima?.respuesta || "");
    const confirmaCalculoNeto =
      /quer[eé]s que calculemos el neto exacto/i.test(ultimaRespuestaTxt) ||
      /neto tandil|descontando flete|fletes_referencia/i.test(ultimaRespuestaTxt);
    if (confirmaCalculoNeto) {
      const cultivoPrevioNeto =
        detectarCultivoConsulta(ultimaPreguntaTxt, cultivos) ||
        detectarCultivoEnTexto(ultimaRespuestaTxt) ||
        detectarCultivoEnTexto(ultimaPreguntaTxt) ||
        "maiz";
      const preguntaNeto = `Calculá el neto exacto de ${cultivoPrevioNeto} para Tandil descontando flete y comisiones. Mostrá supuestos y resultado final por tonelada.`;
      const outTpl = await renderTemplate("consulta", usuario, preguntaNeto);
      const outNeto = sanitizarPlaceholders(String(outTpl?.mensaje || "").trim());
      await guardarConsulta({
        usuarioId: usuario?.id || null,
        whatsapp: normalizarWhatsapp(numeroWhatsapp),
        pregunta: textoPregunta,
        respuesta: outNeto,
        tokensUsados: null,
        iaProvider: outTpl?.meta?.iaProvider || null,
        iaProviderTrace: [
          ...(Array.isArray(outTpl?.meta?.iaProviderTrace) ? outTpl.meta.iaProviderTrace : []),
          { stage: "pipeline", value: "afirmacion_breve_neto_exacto" },
        ],
      });
      return outNeto;
    }
    if (esConsultaRelacionIntercambio(ultima?.pregunta || "")) {
      const relacionTxt = await responderRelacionIntercambio({
        texto: ultima?.pregunta || textoPregunta,
        nivel: nivelUsuario,
        modoOrientativo: true,
      });
      if (relacionTxt) {
        const relacionHuman = await humanizarRelacionConIA({
          pregunta: ultima?.pregunta || textoPregunta,
          textoBase: relacionTxt,
        });
        const out = [
          relacionHuman,
          "",
          "Si querés, ahora te la comparo contra promedio histórico (30/90 días) y te marco señal de mejora/deterioro.",
        ].join("\n");
        await guardarConsulta({
          usuarioId: usuario?.id || null,
          whatsapp: normalizarWhatsapp(numeroWhatsapp),
          pregunta: textoPregunta,
          respuesta: out,
          tokensUsados: null,
        });
        return out;
      }
    }
    if (
      /\brelaci[oó]n\b|\bintercambio\b|\bratio\b/i.test(String(ultima?.pregunta || "")) &&
      /patas completas|orientativa|sin dato puntual en base/i.test(String(ultima?.respuesta || ""))
    ) {
      const relacionTxt = await responderRelacionIntercambio({
        texto: ultima?.pregunta || textoPregunta,
        nivel: nivelUsuario,
        modoOrientativo: true,
      });
      if (relacionTxt) {
        const out = await enriquecerConGroundingAgroSiHaceFalta({
          pregunta: ultima?.pregunta || textoPregunta,
          textoBase: relacionTxt,
        });
        await guardarConsulta({
          usuarioId: usuario?.id || null,
          whatsapp: normalizarWhatsapp(numeroWhatsapp),
          pregunta: textoPregunta,
          respuesta: out,
          tokensUsados: null,
        });
        return out;
      }
    }
    const cultivoPrevio = detectarCultivoConsulta(ultima?.pregunta || "", cultivos);
    if (cultivoPrevio) {
      return responderDatosCultivo(cultivoPrevio, nivelUsuario);
    }
    const cultivosPerfil = cultivos.map((c) => c.cultivo).filter(Boolean);
    const sugeridos = cultivosPerfil.length
      ? cultivosPerfil.slice(0, 3).join(", ")
      : "soja, maíz, trigo";
    return `Perfecto. Decime puntualmente qué querés ver y te respondo con datos:\n- "Precio de ${sugeridos.split(",")[0]} hoy"\n- "¿Me conviene vender ${sugeridos.split(",")[0]} esta semana?"\n- "Clima de mi zona 7 días"`;
  }

  if (!forzarRespuestaIA && esPreguntaPorQueBreve(textoPregunta)) {
    const ultima = await obtenerUltimaInteraccion({
      usuarioId: usuario?.id || null,
      whatsapp: numeroWhatsapp,
    });
    const cultivoPrevio = detectarCultivoConsulta(ultima?.pregunta || "", cultivos);
    if (cultivoPrevio) {
      return `Te explico sobre *${cultivoPrevio}*: hoy tengo precio, pero no una causa causal validada en base (oferta/demanda/logística) para afirmar un motivo puntual.\nSi querés, te comparo contra promedio 30 días y tendencia para inferir contexto.`;
    }
    return "Te puedo responder el porqué si me decís el dato puntual (precio, dólar, clima o insumos) y te lo analizo con lo que hay en base.";
  }

  if (!forzarRespuestaIA && esComentarioSeguimientoMercado(textoPregunta)) {
    const ultima = await obtenerUltimaInteraccion({
      usuarioId: usuario?.id || null,
      whatsapp: numeroWhatsapp,
    });
    const cultivoPrevio = detectarCultivoConsulta(ultima?.pregunta || "", cultivos);
    if (cultivoPrevio) {
      const base = await responderDatosCultivo(cultivoPrevio, nivelUsuario);
      return `Sí, puede ser. Lo miro sobre *${cultivoPrevio}* con el último corte:\n${base}`;
    }
  }

  // Prioridad alta: consultas comerciales tipo "X+Y o A+B" van siempre por análisis numérico.
  const comparativaRapida = !forzarRespuestaIA ? responderComparacionConFactor(preguntaExpandida) : null;
  if (!forzarRespuestaIA && comparativaRapida) {
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: comparativaRapida,
      tokensUsados: null,
    });
    return comparativaRapida;
  }

  const consultaDatosCultivo =
    ["datos", "precio", "cotizacion", "cotización", "valor", "mercado"].some((k) =>
      normMin(textoPregunta).includes(k)
    ) && Boolean(cultivoContextual);
  if (!forzarRespuestaIA && consultaDatosCultivo) {
    const nivelPrecio = nivelUsuario === "SIMPLE" ? "INTERMEDIO" : nivelUsuario;
    const basePrecio = await responderDatosCultivo(cultivoContextual, nivelPrecio);
    const human = await humanizarRespuestaPrecioConIA({
      pregunta: textoPregunta,
      textoBase: basePrecio,
      usuario,
    });
    const humanLimpio = limpiarMarcadoresRespuestaPrecio(human);
    const out = await enriquecerConGroundingAgroSiHaceFalta({
      pregunta: textoPregunta,
      textoBase: humanLimpio,
    });
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: out,
      tokensUsados: null,
    });
    return out;
  }

  const tNorm = normMin(textoPregunta);
  if (!forzarRespuestaIA && /divid|separ|desglos/.test(tNorm) && /puerto|plaza|mercado/.test(tNorm)) {
    const txt = await responderDivisionPorPuerto({ usuario, fechaISO: fechaConsulta, nivel: nivelUsuario });
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: txt,
      tokensUsados: null,
    });
    return txt;
  }

  if (!forzarRespuestaIA && cultivoContextual && (mercadoDetectado || fechaConsulta)) {
    if (esConsultaCoberturaMaiz(textoPregunta)) {
      const cobertura = await responderCoberturaMaiz({
        pregunta: textoPregunta,
        tecnico: esModoTecnicoOn(textoPregunta),
      });
      if (cobertura) {
        await guardarConsulta({
          usuarioId: usuario?.id || null,
          whatsapp: normalizarWhatsapp(numeroWhatsapp),
          pregunta: textoPregunta,
          respuesta: cobertura,
          tokensUsados: null,
        });
        return cobertura;
      }
    }
    const txt = await responderPrecioPorMercado({
      cultivo: cultivoContextual,
      mercadoHint: mercadoDetectado,
      fechaISO: fechaConsulta,
      nivel: nivelUsuario === "SIMPLE" ? "INTERMEDIO" : nivelUsuario,
    });
    const human = await humanizarRespuestaPrecioConIA({
      pregunta: textoPregunta,
      textoBase: txt,
      usuario,
    });
    const humanLimpio = limpiarMarcadoresRespuestaPrecio(human);
    const out = await enriquecerConGroundingAgroSiHaceFalta({
      pregunta: textoPregunta,
      textoBase: humanLimpio,
    });
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: out,
      tokensUsados: null,
    });
    return out;
  }

  if (!forzarRespuestaIA && esConsultaInsumos(textoPregunta)) {
    const textoInsumos = await responderInsumos({ pregunta: textoPregunta, usuario, nivel: nivelUsuario });
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: textoInsumos,
      tokensUsados: null,
    });
    return textoInsumos;
  }

  if (!forzarRespuestaIA && esConsultaHaciendaVenta(textoPregunta)) {
    const textoHacienda = await responderHaciendaSimple(textoPregunta, nivelUsuario);
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: textoHacienda,
      tokensUsados: null,
    });
    return textoHacienda;
  }

  const flujoCosto = !forzarRespuestaIA ? await guiarCalculoCosto(numeroWhatsapp, textoPregunta) : null;
  if (!forzarRespuestaIA && flujoCosto?.enFlujo) {
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: flujoCosto.respuesta,
      tokensUsados: null,
    });
    return flujoCosto.respuesta;
  }

  // Consulta de decisión ambigua: responder útil sin inventar y sin exigir comando.
  const esDecisionGeneral = /(conviene|vender|esperar)/.test(tNorm);
  if (
    !forzarRespuestaIA &&
    esDecisionGeneral &&
    !cultivoContextual &&
    !esConsultaHaciendaVenta(textoPregunta) &&
    !preguntaRequierePipelineConsultaIA(textoPregunta)
  ) {
    const textoDecision = construirFallbackDecisionUniversal({
      nivel: nivelUsuario,
      tema: "decisión comercial",
      detalleFalta: "No tengo el producto puntual para calcularte una recomendación exacta.",
      contexto: "mercado con variación normal y sin señal única para cerrar todo",
      accion: "si decidís esta semana, avanzá parcial (20-30%) y completamos cuando me digas producto/zona.",
    });
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: textoDecision,
      tokensUsados: null,
    });
    return textoDecision;
  }

  // Producto no mapeado (ej: "y los limones?"): fallback seguro, sin inventar.
  const temaLibre = extraerTemaDesdePregunta(textoPregunta);
  if (
    !forzarRespuestaIA &&
    temaLibre &&
    !cultivoContextual &&
    !esConsultaInsumos(textoPregunta) &&
    !esConsultaHaciendaVenta(textoPregunta) &&
    !preguntaRequierePipelineConsultaIA(textoPregunta)
  ) {
    const ultima = await obtenerUltimaInteraccion({
      usuarioId: usuario?.id || null,
      whatsapp: numeroWhatsapp,
    });
    const temaConversacion = detectarTemaConversacion({
      ultimaPregunta: ultima?.pregunta || "",
      ultimaRespuesta: ultima?.respuesta || "",
      cultivosPerfil: (cultivos || []).map((c) => c.cultivo).filter(Boolean),
    });
    const fallbackBase = construirFallbackDecisionUniversal({
      nivel: nivelUsuario,
      tema: temaLibre,
      detalleFalta: `No tengo dato puntual validado de ${temaLibre} en este corte.`,
      contexto: temaConversacion
        ? `referencia específica no disponible en fuentes activas ahora; uso contexto previo de ${temaConversacion}`
        : "referencia específica no disponible en fuentes activas ahora",
      accion: "si necesitás decidir hoy, usá una referencia alternativa y confirmamos cuando entre dato validado.",
    });
    const contextoRelacionado = await construirContextoRelacionadoTemaLibre({
      tema: temaLibre,
      nivel: nivelUsuario,
      temaConversacion,
      ultimaPregunta: ultima?.pregunta || "",
    });
    const textoTema = `${fallbackBase}\n\n${contextoRelacionado}`;
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: textoTema,
      tokensUsados: null,
    });
    return textoTema;
  }

  if (!forzarRespuestaIA && usuario?.id && (esConsultaVenta(textoPregunta) || esPedidoAnalisisContextual(textoPregunta))) {
    if (esConsultaHaciendaVenta(textoPregunta)) {
      const textoHacienda = await responderHaciendaSimple(textoPregunta, nivelUsuario);
      await guardarConsulta({
        usuarioId: usuario?.id || null,
        whatsapp: normalizarWhatsapp(numeroWhatsapp),
        pregunta: textoPregunta,
        respuesta: textoHacienda,
        tokensUsados: null,
      });
      return textoHacienda;
    }
    const cultivoAnalisis = cultivoContextual || detectarCultivoConsulta(textoPregunta, cultivos);
    if (!cultivoAnalisis) {
      const textoDecision = construirFallbackDecisionUniversal({
        nivel: nivelUsuario,
        tema: "decisión comercial",
        detalleFalta: "No me diste el producto puntual para calcularte margen exacto.",
        contexto: "mercado con variaciones normales y sin señal única para fijar todo",
        accion: "si la decisión es esta semana, avanzá en forma parcial y te ayudo a cerrar el análisis cuando me digas el producto.",
      });
      await guardarConsulta({
        usuarioId: usuario?.id || null,
        whatsapp: normalizarWhatsapp(numeroWhatsapp),
        pregunta: textoPregunta,
        respuesta: textoDecision,
        tokensUsados: null,
      });
      return textoDecision;
    }
    const cultivoPerfil = cultivos.find(
      (c) => parseCultivo(c.cultivo) === parseCultivo(cultivoAnalisis)
    );
    if (!cultivoPerfil) {
      const actuales = cultivos.map((c) => c.cultivo).filter(Boolean);
      const actualesTxt = actuales.length ? ` Hoy tengo cargado: ${actuales.join(", ")}.` : "";
      return `No tengo ${cultivoAnalisis} en tu perfil.${actualesTxt} Si querés lo agregamos con COMPLETAR PERFIL.`;
    }
    if (!Number.isFinite(Number(cultivoPerfil.hectareas)) || Number(cultivoPerfil.hectareas) <= 0) {
      return `Para analizar ${cultivoAnalisis} necesito tus hectáreas. Respondeme: "${cultivoAnalisis} <hectareas> ha".`;
    }
    const analisisTpl = await renderTemplate("analisis_venta", usuario, cultivoAnalisis);
    const analisis = analisisTpl.mensaje;
    await guardarConsulta({
      usuarioId: usuario.id,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: analisis,
      tokensUsados: null,
    });
    return analisis;
  }

  let texto;
  let tokensUsados = null;
  let iaSinContexto = null;
  let iaProvider = null;
  let iaProviderTrace = null;
  let respuestaPipeline = "base_datos + contexto_ia";
  let textoPreguntaPlantilla = textoPregunta;
  try {
    const ultimasHist = await obtenerUltimasInteracciones({
      usuarioId: usuario?.id,
      whatsapp: numeroWhatsapp,
      limite: 5,
    });
    const modoHilo = clasificarExpansionHiloConversacional(textoPregunta, cultivos, ultimasHist.length);
    if (modoHilo) {
      textoPreguntaPlantilla = construirPreguntaConHiloInterpretado(textoPregunta, ultimasHist, modoHilo);
      logConsultaRoute(numeroWhatsapp, "HILO_CONVERSACION_EXPANDIDO", { modo: modoHilo });
    }
  } catch (_e) {
    /* seguir con textoPregunta */
  }
  try {
    const out = await Promise.race([
      renderTemplate("consulta", usuario, textoPreguntaPlantilla),
      timeoutPromise(timeoutConsultaTemplateMs(textoPreguntaPlantilla), "consulta_template"),
    ]);
    texto = out.mensaje;
    iaProvider = out?.meta?.iaProvider || null;
    iaProviderTrace = out?.meta?.iaProviderTrace || null;
    respuestaPipeline = out?.meta?.respuestaPipeline || respuestaPipeline;
    if (typeof out?.meta?.tokensUsados === "number" && Number.isFinite(out.meta.tokensUsados)) {
      tokensUsados = out.meta.tokensUsados;
    }
    if (requiereRecuperacionDatosBd(texto)) {
      const precios = await obtenerUltimosPreciosPorCultivos(
        cultivosParaConsultaPrecios(cultivos, textoPregunta)
      );
      const tipoCambio = await obtenerUltimoTipoCambio();
      const clima = usuario ? await obtenerClimaZona(usuario) : [];
      const cultivoFallback = detectarCultivoConsulta(textoPregunta, cultivos) || detectarCultivoEnTexto(textoPregunta);
      const nivelPrecioFallback = nivelUsuario === "SIMPLE" ? "INTERMEDIO" : nivelUsuario;
      texto = cultivoFallback
        ? await responderDatosCultivo(cultivoFallback, nivelPrecioFallback)
        : construirFallbackSeguroDesdeContexto({
            pregunta: textoPregunta,
            cultivoDetectado: cultivoFallback,
            precios,
            tipoCambio,
            clima,
            nivel: nivelUsuario,
          });
    }
    if (/src\/|get_[a-z_]+|comando para obtener/i.test(texto)) {
      const precios = await obtenerUltimosPreciosPorCultivos(
        cultivosParaConsultaPrecios(cultivos, textoPregunta)
      );
      const tipoCambio = await obtenerUltimoTipoCambio();
      const clima = usuario ? await obtenerClimaZona(usuario) : [];
      texto = construirFallbackSeguroDesdeContexto({
        pregunta: textoPregunta,
        cultivoDetectado: detectarCultivoConsulta(textoPregunta, cultivos),
        precios,
        tipoCambio,
        clima,
        nivel: nivelUsuario,
      });
    }
    iaSinContexto = evaluarRespuestaIASinContexto(texto);
  } catch (error) {
    logConsulta({
      level: "error",
      whatsapp: numeroWhatsapp,
      route: "template_consulta_fallback",
      message: `Falló template consulta, usando fallback: ${error.message}`,
    });
    const precios = await obtenerUltimosPreciosPorCultivos(
      cultivosParaConsultaPrecios(cultivos, textoPregunta)
    );
    const tipoCambio = await obtenerUltimoTipoCambio();
    const clima = usuario ? await obtenerClimaZona(usuario) : [];
    const porCultivo = await fallbackConsultaTimeoutConCultivo({
      usuario,
      textoPregunta,
      cultivos,
      nivelUsuario,
    });
    if (porCultivo) {
      texto = porCultivo;
      respuestaPipeline = "base_datos + fallback_timeout_cultivo";
    } else {
      texto = construirRespuestaFallback({ usuario, precios, tipoCambio, clima });
      respuestaPipeline = "base_datos + fallback_servicio";
    }
    iaProvider = null;
    iaProviderTrace = null;
  }

  const preguntaSuave = await completarPerfilDesdeConsulta(usuario, {
    pregunta: textoPregunta,
  });
  if (preguntaSuave) {
    texto = `${texto}\n\n${preguntaSuave}`;
  }
  texto = await enriquecerConGroundingAgroSiHaceFalta({
    pregunta: textoPregunta,
    textoBase: texto,
  });

  // Guardarraíl final: ninguna respuesta de precio sale sin mínimos operativos.
  if (esConsultaPrecioEstricto(textoPregunta) && !cumpleMinimosRespuestaPrecio(texto)) {
    const cultivoMinimo =
      detectarCultivoConsulta(textoPregunta, cultivos) || detectarCultivoEnTexto(textoPregunta);
    if (cultivoMinimo) {
      const nivelPrecioFinal = nivelUsuario === "SIMPLE" ? "INTERMEDIO" : nivelUsuario;
      const recompuesta = await responderDatosCultivo(cultivoMinimo, nivelPrecioFinal);
      texto = await enriquecerConGroundingAgroSiHaceFalta({
        pregunta: textoPregunta,
        textoBase: recompuesta,
      });
    } else {
      texto = await enriquecerConGroundingAgroSiHaceFalta({
        pregunta: textoPregunta,
        textoBase: `${texto}\n\n⚠️ Validando precio/fuente/fecha con complemento web para asegurar consistencia.`,
      });
    }
  }

  texto = sanitizarPlaceholders(texto);
  if (nivelUsuario === "SIMPLE" && !esConsultaPrecioEstricto(textoPregunta)) {
    texto = compactarRespuestaSimple(texto, 8);
  }

  await guardarConsulta({
    usuarioId: usuario?.id || null,
    whatsapp: normalizarWhatsapp(numeroWhatsapp),
    pregunta: textoPregunta,
    respuesta: texto,
    tokensUsados,
    iaSinContexto,
    iaProvider,
    iaProviderTrace: [
      ...(Array.isArray(iaProviderTrace) ? iaProviderTrace : []),
      { stage: "pipeline", value: respuestaPipeline },
    ],
  });

  return texto;
};

module.exports = {
  manejarComandoBot,
  obtenerEstadoBot,
  procesarConsulta,
};
