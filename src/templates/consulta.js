const {
  generarConPromptLibre,
  generarConGroundingGoogleSearch,
  getGroundingMaxChars,
} = require("../services/gemini");
const {
  obtenerPrecioFresco,
  obtenerUltimoPrecioCultivoDesdeBd,
  obtenerPrecioComplementarioFob,
  obtenerDolarFresco,
  obtenerClimaFresco,
  obtenerNoticiasFrescas,
  formatearPrecio,
  ordenarItemsTipoCambio,
  formatearItemTipoCambioTexto,
  clasificarTipoFuentePrecio,
  fuenteLegibleParaPrecio,
} = require("./base");
const { aplicarLayout } = require("./layouts");
const { obtenerSnapshotParaIA } = require("../services/snapshot");
const { query } = require("../config/database");
const {
  horasFeedbackBroadcastMasivo,
  sqlMasivoAdminRecienteOtroHistorial,
} = require("../utils/historial_broadcast_ventana");
const { buscarDatosAgroEnWeb } = require("../services/web_fallback");
const { esProbableConocimientoGeneralSinAgro } = require("../services/whatsapp_intents");
const { fechaISOArgentina } = require("../utils/fecha_ar");
const { formatearFuentesGroundingWhatsApp } = require("../utils/urls_legibles");
const { geocodificarZonaArgentina } = require("../utils/geocodificacion");
const { actualizarUsuario } = require("../models/usuario");
const { obtenerClima } = require("../scrapers/clima");

const normalizar = (t = "") =>
  String(t)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** Misma intención que `consultas.esConsultaClima` + ventanas temporales sin la palabra "clima". */
const esConsultaMeteoPorTexto = (pregunta = "") => {
  const t = normalizar(pregunta);
  if (
    /clima|lluvia|helada|viento|pronostico|\bel tiempo\b|humedad|temperatura/.test(t) ||
    /\bfri[oó]\b|frialdad|ola\s+de\s+fri[oó]|bajas\s+temperaturas|helar\b|heladas\b/.test(t) ||
    /fumigar|pulveriz|pulverizacion|aspersion|aplicacion\s+en\s+campo|rocio/.test(t)
  ) {
    return true;
  }
  if (
    /\b(proximos|próximos)\s+\d{1,2}\s*d[ií]as\b/.test(t) &&
    /\b(tiempo|lluvia|helada|viento|nublado|soleado|llov|templad|frio|fri[oó]|calor|precip|sequia|inundacion)\b/.test(t)
  )
    return true;
  if (/\b(pronostico|pron[oó]stico)\s+(extendido|semanal|para)\b/.test(t)) return true;
  if (/\bcomo\s+viene\s+el\s+tiempo\b|\bque\s+tiempo\s+hace\b|\btiempo\s+para\b/.test(t)) return true;
  return false;
};

/** Hortícolas / frutas / cítricos frecuentes (no están en tabla precios; disparan mercado + grounding). */
const RE_MERCADO_HORTI_O_FRUTA =
  /lim[oó]n|limones|naranja|mandarina|pomelo|toronja|tomate|durazno|duraznos|pera|peras|manzana|manzanas|uva|uvas|ar[aá]ndano|palta|paltas|aguacate|morron|morr[oó]n|pimiento|zanahoria|cebolla|ajo|berenjena|calabaza|zapallo|sand[ií]a|melon|mel[oó]n|kiwi|ciruela|ciruelas|higo|higos|\blima(s)?\b|horticol|fruta|verdura|c[ií]tric/;

const detectarTemas = (pregunta = "") => {
  const t = normalizar(pregunta);
  const temas = [];
  const pideMontoSinDecirPrecio =
    /(cu[aá]nto|cuanto)\b/.test(t) && /(vale|valen|cuesta|cuestan|cobra|cobran|sale|salen|pag[oó]|pagan)\b/.test(t);
  if (
    /(precio|cotizacion|cotización|mercado|soja|maiz|trigo|girasol|sorgo|cebada|papa|patata)/.test(t) ||
    RE_MERCADO_HORTI_O_FRUTA.test(t) ||
    pideMontoSinDecirPrecio
  ) {
    temas.push("precio");
  }
  if (/dolar|mep|blue|oficial|ccl/.test(t)) temas.push("dolar");
  if (esConsultaMeteoPorTexto(pregunta)) temas.push("clima");
  if (/vender|venta|margen|rentabilidad|conviene/.test(t)) temas.push("venta");
  return [...new Set(temas)];
};

const detectarCultivo = (pregunta = "") => {
  const t = normalizar(pregunta);
  if (t.includes("soja")) return "soja";
  if (t.includes("maiz")) return "maiz";
  if (t.includes("trigo")) return "trigo";
  if (t.includes("girasol")) return "girasol";
  if (t.includes("sorgo")) return "sorgo";
  if (t.includes("cebada")) return "cebada";
  if (t.includes("papa") || t.includes("patata")) return "papa";
  if (/lim[oó]n|limones/.test(t)) return "limon";
  if (t.includes("naranja")) return "naranja";
  if (t.includes("mandarina")) return "mandarina";
  if (t.includes("pomelo") || t.includes("toronja")) return "pomelo";
  if (t.includes("tomate")) return "tomate";
  if (t.includes("durazno")) return "durazno";
  if (/\b(pera|peras)\b/.test(t)) return "pera";
  if (/\b(manzana|manzanas)\b/.test(t)) return "manzana";
  if (/\b(uva|uvas)\b/.test(t)) return "uva";
  if (t.includes("palta") || t.includes("aguacate")) return "palta";
  if (t.includes("morron") || t.includes("pimiento")) return "morron";
  if (t.includes("zanahoria")) return "zanahoria";
  if (t.includes("cebolla")) return "cebolla";
  if (t.includes("berenjena")) return "berenjena";
  if (t.includes("calabaza") || t.includes("zapallo")) return "zapallo";
  if (t.includes("sandia") || t.includes("sandía")) return "sandia";
  if (t.includes("melon") || t.includes("melón")) return "melon";
  if (t.includes("kiwi")) return "kiwi";
  if (t.includes("ciruela")) return "ciruela";
  if (t.includes("higo")) return "higo";
  if (/\blima(s)?\b/.test(t)) return "lima";
  if (/\byerbamate\b|\byerba\s+mate\b|\byerba\b/.test(t)) return "yerba_mate";
  return null;
};

/**
 * Cultivo en respuestas previas (encabezado; evita notas finales sobre otro grano).
 */
const extraerCultivoDeTextoHilo = (texto = "") => {
  const head = String(texto || "").slice(0, 1200);
  const porPregunta = detectarCultivo(head);
  if (porPregunta) return porPregunta;
  if (/🌽/.test(head) || /\bma[ií]z\b/i.test(head)) return "maiz";
  if (/🫘/.test(head) || /\bsoja\b/i.test(head)) return "soja";
  if (/\btrigo\b/i.test(head)) return "trigo";
  if (/\bgirasol\b/i.test(head)) return "girasol";
  if (/\bsorgo\b/i.test(head)) return "sorgo";
  if (/\bcebada\b/i.test(head)) return "cebada";
  if (/\bpapa\b|\bpatata\b/i.test(head)) return "papa";
  if (/\byerbamate\b|\byerba\s+mate\b|\byerba\b/i.test(head)) return "yerba_mate";
  return null;
};

const cultivoPrimeroEnHistorial = (historialRows = [], maxFilas = 8) => {
  const rows = Array.isArray(historialRows) ? historialRows : [];
  for (let i = 0; i < Math.min(rows.length, maxFilas); i++) {
    const cq = detectarCultivo(rows[i]?.pregunta || "");
    if (cq) return cq;
  }
  for (let i = 0; i < Math.min(rows.length, maxFilas); i++) {
    const cr = extraerCultivoDeTextoHilo(rows[i]?.respuesta || "");
    if (cr) return cr;
  }
  return null;
};

const preguntaBreveOpcionalHueca = (pregunta = "") => {
  const t = String(pregunta || "").trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  if (!t || words > 14) return false;
  if (t.length > 140) return false;
  return true;
};

const preguntaSugiereContinuacionPorForma = (pregunta = "") => {
  const raw = String(pregunta || "").trim();
  const t = normalizar(raw);
  if (/^(y\s+|a\s+)/.test(t)) return true;
  if (
    /\b(eso|esto|eso mismo|lo mismo|anterior|pregunta anterior|mensaje anterior|respondiste|dijiste|hab[ií]as dicho)\b/.test(t)
  ) {
    return true;
  }
  return false;
};

const preguntaSugiereLogisticaOPuertos = (pregunta = "") => {
  const t = normalizar(pregunta);
  return /\bpuertos?\b|\bplazas?\b|\bfletes?\b|\blogist\b|\bacarreo\b|\btransporte\b|\bestiba\b|\bdestinos?\b|\bvias?\b|\bruta\b|\bviajes?\b|\bcarga(s)?\b/.test(t);
};

const tieneAnclaOperativaMercado = (textoNorm = "") =>
  /\b(puertos?|plazas?|fletes?|cotiza|liquid|margen|vender|venta|cobrar|usd\/|\btn\b|carga|transporte|ruta|cami[oó]n|camion)\b/i.test(textoNorm);

/**
 * Une cultivo/temas cuando el turno actual es continuación corta sin nombrar otra especie explícita.
 */
const resolverContextoConversacional = (pregunta = "", historialRows = []) => {
  const vacioDefault = {
    cultivo_contextual: null,
    temas_agregados: [],
    es_seguimiento: false,
    tema_activo_detectado: null,
    ultimo_turno_extracto: null,
  };
  const rows = Array.isArray(historialRows) ? historialRows : [];
  if (!rows.length || !String(pregunta || "").trim()) return vacioDefault;

  const temasLocales = detectarTemas(pregunta);
  const explicitoActual = !!detectarCultivo(pregunta);
  if (explicitoActual) return vacioDefault;

  const muyCorta = preguntaBreveOpcionalHueca(pregunta);
  const tnorm = normalizar(pregunta);
  const desdeHilo = cultivoPrimeroEnHistorial(rows);
  const logisticaOPuertos = preguntaSugiereLogisticaOPuertos(pregunta);
  const continuacionPorForma = preguntaSugiereContinuacionPorForma(pregunta);
  /** No arrastrar grano cuando el usuario pasó sólo a clima sin mención de cultivo/port logística */
  const soloClimaAjenoMercado =
    temasLocales.includes("clima") &&
    !logisticaOPuertos &&
    !tieneAnclaOperativaMercado(tnorm) &&
    !temasLocales.includes("precio") &&
    !temasLocales.includes("venta") &&
    !/\b(soja|ma[ií]z|trigo|girasol|cebada|sorgo|papa|yerba|campo|parcela|lote)\b/.test(tnorm);

  if (!desdeHilo || soloClimaAjenoMercado) return vacioDefault;

  const abreSeguimiento =
    logisticaOPuertos ||
    (muyCorta &&
      (continuacionPorForma ||
        tieneAnclaOperativaMercado(tnorm) ||
        /\b(qu[eé]|cu[aá](l|les|ndo)|donde|d[oó]nde|cu[aá]nto|cuanto|como|c[oó]mo|por\s*qu[eé])\b/.test(tnorm)));

  if (!abreSeguimiento) return vacioDefault;

  const temas_agregados = [];
  if (logisticaOPuertos || temasLocales.includes("precio") || temasLocales.includes("venta")) {
    /* ya hay precio/venta o la pregunta es logística típica de granos cargados antes */
    if (!temasLocales.includes("precio")) temas_agregados.push("precio");
  }

  const u = rows[0];
  const clipTurno = (s, max) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  const ultimo_turno_extracto = u
    ? `Último turno usuario: "${clipTurno(u.pregunta || "", 140)}" · Asistente (extracto): "${clipTurno(u.respuesta || "", 480)}"`
    : null;

  return {
    cultivo_contextual: desdeHilo,
    temas_agregados,
    es_seguimiento: true,
    tema_activo_detectado: logisticaOPuertos ? "logistica_continua" : "mercado_o_decision_previa",
    ultimo_turno_extracto,
  };
};

const extraerCultivosPregunta = (pregunta = "") => {
  const t = normalizar(pregunta);
  const out = [];
  if (t.includes("soja")) out.push("soja");
  if (t.includes("maiz")) out.push("maiz");
  if (t.includes("trigo")) out.push("trigo");
  if (t.includes("girasol")) out.push("girasol");
  if (t.includes("sorgo")) out.push("sorgo");
  return out;
};

const esPedidoDecisionOperativa = (pregunta = "") => {
  const t = normalizar(pregunta);
  return /(vendo|vender|espero|conviene|cubro|dejo correr|que hago|qué hago|decision|decisión)/.test(t);
};

const esConsultaInterpretativaRelacion = (pregunta = "") => {
  const t = normalizar(pregunta);
  return /(relacion|relación|ratio|equivalencia|vs|versus|conviene|estrategia|que hago|qué hago)/.test(t);
};

const MODULOS_CONTEXTO = {
  mercado_fisico: {
    archivo: "docs/contexto-ia/01-mercado-fisico.md",
    resumen:
      "Precio disponible/FAS/FOB + tipo de cambio + flete/neto. Salida: dato de hoy, lectura corta, accion sugerida y riesgo.",
  },
  forward_canje: {
    archivo: "docs/contexto-ia/02-forward-canje.md",
    resumen:
      "Forward para certidumbre de precio y canje para pago en especie. Aclarar riesgo de contraparte y validacion fiscal cuando corresponda.",
  },
  futuros: {
    archivo: "docs/contexto-ia/03-futuros.md",
    resumen:
      "Cobertura con contratos estandarizados, margen de garantia y ajuste diario. Diferenciar cobertura vs especulacion y riesgo caja.",
  },
  opciones: {
    archivo: "docs/contexto-ia/04-opciones.md",
    resumen:
      "Calls/Puts para piso de venta o techo de compra. Explicar prima, trade-off costo/proteccion y ejemplo corto por escenario.",
  },
  estrategias_mixtas: {
    archivo: "docs/contexto-ia/05-estrategias-mixtas.md",
    resumen:
      "Combinacion de instrumentos para balancear certidumbre/flexibilidad. Proponer estrategia principal y alternativa con condicion de invalidez.",
  },
  informacion_fresca: {
    archivo: "docs/contexto-ia/06-informacion-fresca.md",
    resumen:
      "Priorizacion de noticias diarias agro y validacion de actualidad por fecha/fuente antes de recomendar acciones.",
  },
  tiempo_real: {
    archivo: "docs/contexto-ia/07-tiempo-real.md",
    resumen:
      "Lectura de señales intradia (mercados, tipo de cambio, clima operativo) con foco en decisiones de hoy.",
  },
  clima_operativo: {
    archivo: "docs/contexto-ia/08-clima-operativo.md",
    resumen:
      "Impacto operativo de lluvias/heladas/viento sobre labores, logistica y timing comercial.",
  },
  ganaderia_mercados: {
    archivo: "docs/contexto-ia/09-ganaderia-mercados.md",
    resumen:
      "Contexto de hacienda, feedlot, faena y exportaciones para decisiones de compra/venta ganadera.",
  },
  suelos_nutricion: {
    archivo: "docs/contexto-ia/10-suelos-nutricion.md",
    resumen:
      "Soporte tecnico de suelos y nutricion para conectar decisiones comerciales con sustentabilidad productiva.",
  },
  politica_regulacion: {
    archivo: "docs/contexto-ia/11-politica-regulacion.md",
    resumen:
      "Marco regulatorio y politica sectorial (retenciones, comercio, normas) que afectan precios y estrategia comercial.",
  },
  cultivos_cereales_oleaginosas: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Manejo de soja/maiz/trigo/girasol/sorgo: siembra, densidad, materiales y rendimiento por zona.",
  },
  cultivos_regionales: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Economias regionales: papa, arroz, algodon, mani, poroto, cana, yerba, tabaco y calendario productivo.",
  },
  cultivos_fruticultura: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Fruticultura (manzana/pera/citrus/uva/olivo/cereza/berries), normas y mercados de destino.",
  },
  sanidad_vegetal: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Plagas/enfermedades/malezas, umbrales economicos y manejo de resistencias.",
  },
  maquinaria_labores: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Labores, contratismo, mantenimiento y costo operativo con impacto de gasoil/clima.",
  },
  ganaderia_cria: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Cria bovina: preñez, destete, mortandad, servicio y costo del ternero.",
  },
  ganaderia_invernada_feedlot: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Invernada/feedlot: conversion, dieta, margen y decision compra ternero/venta novillo.",
  },
  ganaderia_lecheria: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Lecheria: litros/vaca/dia, costo por litro, precio por cuenca y gestion de tambo.",
  },
  ganaderia_porcinos_aves: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Porcinos y aves: ciclos productivos, costos de alimentacion y precios de referencia.",
  },
  ganaderia_camelidos_ovinos: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Llamas/vicuñas/alpacas/ovinos: fibra, carne, mercados y normas de esquila.",
  },
  costos_margen_campana: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Costo por ha, punto de equilibrio y comparacion de margen entre alternativas productivas.",
  },
  arrendamiento_alquiler: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Alquiler en qq/ha o USD/ha, clausulas, riesgos y decision arrendar vs comprar.",
  },
  financiamiento_credito: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Credito agro, tasas/plazos/garantias y canje como financiamiento implicito.",
  },
  impuestos_fiscalidad: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Impacto fiscal (IVA/Ganancias/Ingresos Brutos) sobre margen y decision comercial.",
  },
  seguros_agropecuarios: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Seguro granizo/multirriesgo/helada/sequia: cobertura, franquicia y conveniencia economica.",
  },
  acopio_comercializacion: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Rol del acopio, comisiones y alternativas (consignacion, a fijar, forward).",
  },
  almacenamiento_silobolsa: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Silobolsa vs silo fijo: costo, riesgo de calidad y estrategia de venta diferida.",
  },
  calidad_granos: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Calidad comercial (humedad/proteina/falling number/daños) y su efecto en bonificaciones/castigos.",
  },
  exportaciones_mercados_externos: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Exportacion directa: requisitos SENASA/Aduana, Incoterms basicos y destino.",
  },
  agua_riego: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Disponibilidad de agua, sistemas de riego y costo operativo por zona.",
  },
  semillas_genetica: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Variedades/hibridos, genetica por zona, INASE/regalias y semilla propia vs comercial.",
  },
  agricultura_precision: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Ambientacion, NDVI, drones y tecnologia aplicada a rentabilidad.",
  },
  sustentabilidad_certificaciones: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Regenerativa, carbono y certificaciones para acceso a mercados premium.",
  },
  emergencias_siniestros: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Protocolo post-siniestro (granizo/sequia/inundacion/helada), seguro y tramites de emergencia.",
  },
  onboarding_ayuda: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Ayuda de uso del sistema: alta, carga de datos, alertas y comandos clave.",
  },
  glosario_terminos: {
    archivo: "docs/contexto-ia/12-37-modulos-completos.md",
    resumen: "Definiciones simples de terminos tecnicos/comerciales (FAS/FOB/base/canje/put/call/etc.).",
  },
};

const PRIORIDAD_POR_INTENCION = {
  precio_venta: ["mercado_fisico", "tiempo_real", "costos_margen_campana", "informacion_fresca", "clima_operativo"],
  cobertura_derivados: ["futuros", "opciones", "estrategias_mixtas", "forward_canje", "tiempo_real"],
  clima_operativo: ["clima_operativo", "mercado_fisico", "tiempo_real", "emergencias_siniestros"],
  noticias_contexto: ["informacion_fresca", "tiempo_real", "politica_regulacion", "mercado_fisico"],
  ganaderia: ["ganaderia_mercados", "ganaderia_cria", "ganaderia_invernada_feedlot", "ganaderia_lecheria", "ganaderia_porcinos_aves"],
  costos_finanzas: ["costos_margen_campana", "financiamiento_credito", "impuestos_fiscalidad", "arrendamiento_alquiler", "seguros_agropecuarios"],
  produccion_agricola: ["cultivos_cereales_oleaginosas", "cultivos_regionales", "sanidad_vegetal", "maquinaria_labores", "semillas_genetica"],
  exportacion: ["exportaciones_mercados_externos", "calidad_granos", "politica_regulacion", "mercado_fisico"],
  usuario_soporte: ["onboarding_ayuda", "glosario_terminos"],
};

const detectarIntencionPrincipal = (pregunta = "", datos = {}) => {
  const t = normalizar(pregunta);
  if (/(ayuda|como usar|c[oó]mo usar|comandos|onboarding)/.test(t)) return "usuario_soporte";
  if (/(que significa|qu[eé] es|definici[oó]n|glosario|fas|fob|put|call|mark to market)/.test(t)) return "usuario_soporte";
  if (/(futuro|futuros|opcion|opciones|cobertura|spread|collar|estrategia mixta)/.test(t)) return "cobertura_derivados";
  if (/(noticia|noticias|actualidad|resumen de mercado|ultimo minuto|en vivo|real time)/.test(t)) return "noticias_contexto";
  if (/(clima|lluvia|helada|viento|inundaci[oó]n|sequ[ií]a|siniestro)/.test(t)) return "clima_operativo";
  if (/(ganad|hacienda|feedlot|novillo|ternero|tambo|lecher[ií]a|porcino|ave|ovino|camelid)/.test(t)) return "ganaderia";
  if (/(costo|margen|equilibrio|arrendamiento|alquiler|cr[eé]dito|financiamiento|impuesto|seguro)/.test(t)) return "costos_finanzas";
  if (/(exportar|exportaci[oó]n|incoterm|senasa|aduana|mercado externo)/.test(t)) return "exportacion";
  if (/(siembra|densidad|h[ií]brido|variedad|plaga|enfermedad|maleza|fertiliz|riego|ndvi|dron)/.test(t))
    return "produccion_agricola";
  if (Array.isArray(datos.temas) && (datos.temas.includes("precio") || datos.temas.includes("venta") || datos.temas.includes("dolar"))) {
    return "precio_venta";
  }
  return "precio_venta";
};

const priorizarModulos = (modulos = [], intencion = "precio_venta") => {
  const orden = PRIORIDAD_POR_INTENCION[intencion] || [];
  const pesoBase = new Map(modulos.map((m, i) => [m, 100 - i]));
  for (let i = 0; i < orden.length; i += 1) {
    const m = orden[i];
    if (!pesoBase.has(m)) continue;
    pesoBase.set(m, pesoBase.get(m) + (orden.length - i) * 10);
  }
  return [...modulos].sort((a, b) => (pesoBase.get(b) || 0) - (pesoBase.get(a) || 0));
};

const detectarModulosContexto = (pregunta = "", datos = {}) => {
  const t = normalizar(pregunta);
  const seleccion = [];
  const agregar = (mod) => {
    if (!seleccion.includes(mod) && MODULOS_CONTEXTO[mod]) seleccion.push(mod);
  };

  // Mercado fisico/base: cualquier consulta de precio, dolar o venta necesita este piso.
  if (
    (Array.isArray(datos.temas) && (datos.temas.includes("precio") || datos.temas.includes("dolar") || datos.temas.includes("venta"))) ||
    /(precio|cotizacion|cotización|disponible|fas|fob|premio|base|neto|dolar|mep|blue|oficial|vender|venta|conviene|margen|rentabilidad)/.test(t)
  ) {
    agregar("mercado_fisico");
  }

  if (/(forward|a fijar|fijacion|fijación|canje|insumo por grano|insumos por granos)/.test(t)) agregar("forward_canje");
  if (/(futuro|futuros|matba|rofex|margen|mark to market|mark-to-market|ajuste diario|interes abierto|interés abierto)/.test(t))
    agregar("futuros");
  if (/(opcion|opciones|call|put|prima|collar|straddle|spread)/.test(t)) agregar("opciones");
  if (/(estrategia|mixta|combinad|sintetic|sintétic|cobertura parcial|escalonad)/.test(t)) agregar("estrategias_mixtas");
  if (/(noticia|noticias|actualidad|novedad|informe|resumen diario|resumen de mercado)/.test(t))
    agregar("informacion_fresca");
  if (/(en vivo|real time|tiempo real|intradia|intrad[ií]a|ahora|ultimo minuto)/.test(t)) agregar("tiempo_real");
  if (/(clima|lluvia|helada|viento|ventana de siembra|ventana de cosecha)/.test(t)) agregar("clima_operativo");
  if (/(ganad|hacienda|novill|terner|feedlot|faena|carne)/.test(t)) agregar("ganaderia_mercados");
  if (/(suelo|nutriente|fertiliz|fosforo|nitr[oó]geno|azufre|rotaci[oó]n|cultivo de servicio)/.test(t))
    agregar("suelos_nutricion");
  if (/(retencion|retenciones|regulacion|normativa|afip|sisa|exportaci[oó]n|derecho de exportaci[oó]n)/.test(t))
    agregar("politica_regulacion");
  if (/(soja|ma[ií]z|trigo|girasol|sorgo|densidad|fecha de siembra|h[ií]brido|variedad)/.test(t))
    agregar("cultivos_cereales_oleaginosas");
  if (/(papa|ca[nñ]a de az[uú]car|yerba|tabaco|arroz|algod[oó]n|man[ií]|poroto|econom[ií]as regionales)/.test(t))
    agregar("cultivos_regionales");
  if (/(manzana|pera|citrus|uva|olivo|cereza|berries|fruticultura)/.test(t)) agregar("cultivos_fruticultura");
  if (/(plaga|enfermedad|maleza|fungicida|herbicida|insecticida|umbral de da[nñ]o|resistencia)/.test(t))
    agregar("sanidad_vegetal");
  if (/(maquinaria|labores|siembra|pulverizaci[oó]n|cosecha|contratista|gasoil|mantenimiento)/.test(t))
    agregar("maquinaria_labores");
  if (/(cr[ií]a|pre[nñ]ez|destete|servicio de rodeo|ternero al pie)/.test(t)) agregar("ganaderia_cria");
  if (/(invernada|feedlot|conversi[oó]n|dieta|novillo|comprar ternero)/.test(t)) agregar("ganaderia_invernada_feedlot");
  if (/(lecher[ií]a|tambo|litros\/vaca|precio al tambo|cuenca lechera)/.test(t)) agregar("ganaderia_lecheria");
  if (/(porcino|cerdo|ave|pollo parrillero|ponedoras)/.test(t)) agregar("ganaderia_porcinos_aves");
  if (/(cam[eé]lido|llama|vicu[nñ]a|alpaca|ovino|oveja|micronaje|mohair|lana)/.test(t))
    agregar("ganaderia_camelidos_ovinos");
  if (/(costo por ha|punto de equilibrio|margen bruto|margen neto|campa[nñ]a)/.test(t)) agregar("costos_margen_campana");
  if (/(arrendamiento|alquiler de campo|qq\/ha|usd\/ha|arrendar|comprar campo)/.test(t)) agregar("arrendamiento_alquiler");
  if (/(cr[eé]dito|financiamiento|tasa|plazo|garant[ií]a|bice|canje financiero)/.test(t))
    agregar("financiamiento_credito");
  if (/(iva|ganancias|ingresos brutos|bienes personales|monotributo|responsable inscripto|impuesto)/.test(t))
    agregar("impuestos_fiscalidad");
  if (/(seguro|granizo|multirriesgo|franquicia|p[oó]liza|liquidaci[oó]n de siniestro)/.test(t)) agregar("seguros_agropecuarios");
  if (/(acopio|consignaci[oó]n|precio a fijar|boleta de compra|comisi[oó]n de acopio)/.test(t)) agregar("acopio_comercializacion");
  if (/(silobolsa|silo bolsa|silo fijo|almacenamiento|venta diferida)/.test(t)) agregar("almacenamiento_silobolsa");
  if (/(calidad de grano|humedad|prote[ií]na|falling number|da[nñ]o en soja|bonificaci[oó]n|penalizaci[oó]n)/.test(t))
    agregar("calidad_granos");
  if (/(exportar|incoterm|aduana|senasa|mercado externo|destino de exportaci[oó]n)/.test(t))
    agregar("exportaciones_mercados_externos");
  if (/(riego|goteo|aspersi[oó]n|surco|disponibilidad de agua|costo del riego)/.test(t)) agregar("agua_riego");
  if (/(semilla|h[ií]brido|gen[eé]tica|inase|regal[ií]a|rr|semilla propia)/.test(t)) agregar("semillas_genetica");
  if (/(ndvi|drone|ambientaci[oó]n|agricultura de precisi[oó]n|monitor de rendimiento)/.test(t)) agregar("agricultura_precision");
  if (/(regenerativa|carbono|certificaci[oó]n|org[aá]nico|rainforest|fair trade|sustentabilidad)/.test(t))
    agregar("sustentabilidad_certificaciones");
  if (/(siniestro|granizo|sequ[ií]a|inundaci[oó]n|helada tard[ií]a|emergencia agropecuaria)/.test(t))
    agregar("emergencias_siniestros");
  if (/(ayuda|como usar|c[oó]mo usar|comandos|onboarding|alta de usuario)/.test(t)) agregar("onboarding_ayuda");
  if (/(que significa|qu[eé] es|definici[oó]n|glosario|fas|fob|base|mark to market|put|call)/.test(t)) agregar("glosario_terminos");

  // Consultas de cobertura/especulacion suelen requerir futuros y/o opciones.
  if (/(cobertura|especulacion|especulación|apalancamiento)/.test(t)) {
    agregar("futuros");
    agregar("opciones");
  }

  if (!seleccion.length) agregar("mercado_fisico");
  const intencion = detectarIntencionPrincipal(pregunta, datos);
  const ordenados = priorizarModulos(seleccion, intencion);
  return ordenados.slice(0, 7);
};

const construirContextoIA = (modulos = []) =>
  modulos
    .map((mod) => {
      const cfg = MODULOS_CONTEXTO[mod];
      if (!cfg) return null;
      return {
        modulo: mod,
        archivo: cfg.archivo,
        resumen: cfg.resumen,
      };
    })
    .filter(Boolean);

const limpiarSalidaIA = (txt = "") =>
  String(txt || "")
    .replace(/\\boxed\{[^}]*\}/gi, "")
    .replace(/\brequest_fx\s*\([^)]*\)/gi, "")
    .replace(/\b(GET|POST|PUT|DELETE)\s+https?:\/\/\S+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const truncarTexto = (v, max = 280) => {
  const t = String(v ?? "");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}...`;
};

const envFlagGrounding = (name) => {
  const v = String(process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
};

/** Desactivación explícita (p. ej. GEMINI_GROUNDING_ENABLED=0). */
const groundingExplicitamenteOff = () => {
  const v = String(process.env.GEMINI_GROUNDING_ENABLED || process.env.GEMINI_GROUNDING || "")
    .trim()
    .toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
};

/**
 * Por defecto ON si hay GEMINI_API_KEY: evita deploys sin flag y consultas agro con hueco sin bloque web.
 * Opt-out: GEMINI_GROUNDING_ENABLED=false (o GEMINI_GROUNDING).
 */
const groundingHabilitadoEnConfig = () => {
  if (groundingExplicitamenteOff()) return false;
  if (envFlagGrounding("GEMINI_GROUNDING_ENABLED") || envFlagGrounding("GEMINI_GROUNDING")) return true;
  return Boolean(process.env.GEMINI_API_KEY?.trim());
};

const contarItemsClima = (datos) => {
  if (!datos?.clima) return 0;
  if (Array.isArray(datos.clima.items)) return datos.clima.items.length;
  if (Array.isArray(datos.clima)) return datos.clima.length;
  return 0;
};

const climaSinPronosticoVigente = (datos) => {
  const items = Array.isArray(datos?.clima?.items) ? datos.clima.items : Array.isArray(datos?.clima) ? datos.clima : [];
  if (!items.length) return true;
  const hoy = String(fechaISOArgentina() || "").slice(0, 10);
  if (!hoy) return false;
  return !items.some((it) => {
    const f = String(it?.fecha || "").slice(0, 10);
    return f && f >= hoy;
  });
};

const hayPrecioTrazable = (datos) =>
  datos?.precio != null &&
  Number.isFinite(Number(datos.precio.precio)) &&
  Number(datos.precio.precio) > 0;

const preguntaPideDisponible = (pregunta = "") => /\b(disponible|mercado fisico|mercado físico|spot)\b/.test(normalizar(pregunta));

const precioEsSoloReferenciaNoDisponible = (precio = {}) => {
  const mercado = normalizar(precio?.mercado || "");
  const fuente = normalizar(precio?.fuente || "");
  const tipo = normalizar(precio?.tipo_precio || "");
  const blob = `${mercado} ${fuente} ${tipo}`.trim();
  if (!blob) return false;
  if (/\bfob\b|export/.test(blob)) return true;
  if (/\bcac\b|camara|c[aá]mara|arbitral|magyp/.test(blob)) return true;
  return false;
};

/** Web fallback útil para el cultivo pedido (no alcanza con tener solo soja/maíz si preguntaron papa). */
const hayMercadoWebParaCultivo = (datos, cultivo) => {
  const merc = Array.isArray(datos?.webFallback?.mercados) ? datos.webFallback.mercados : [];
  if (!cultivo) {
    return merc.some(
      (x) => Number.isFinite(Number(x.precio_ars)) || Number.isFinite(Number(x.precio_usd))
    );
  }
  const c = normalizar(cultivo);
  return merc.some(
    (x) =>
      normalizar(x.cultivo) === c &&
      (Number.isFinite(Number(x.precio_ars)) || Number.isFinite(Number(x.precio_usd)))
  );
};

/**
 * True solo si hay filas web cuyo cultivo coincide con lo pedido (o el texto menciona ese cultivo).
 * Evita que soja/maíz del scraper “cubran” una pregunta por limones y apaguen el grounding.
 */
const hayMercadoWebQueAplicaAPregunta = (datos, pregunta = "") => {
  const merc = Array.isArray(datos?.webFallback?.mercados) ? datos.webFallback.mercados : [];
  if (!merc.length) return false;
  const c = datos?.cultivo || detectarCultivo(pregunta);
  if (c) return hayMercadoWebParaCultivo(datos, c);
  const t = normalizar(pregunta);
  return merc.some((x) => {
    const xc = normalizar(x.cultivo || "");
    if (!xc) return false;
    if (!(Number.isFinite(Number(x.precio_ars)) || Number.isFinite(Number(x.precio_usd)))) return false;
    return t.includes(xc);
  });
};

/** Preguntas triviales / no operativas: no forzar Google aunque falte precio en la plantilla base. */
const esConsultaExentaForzadoGoogle = (pregunta = "") => {
  const t = normalizar(pregunta);
  if (t.length < 6) return true;
  if (/^(hola|buenas|buenos\s+dias|gracias|chau|nos\s+vemos)\b/.test(t) && t.length < 40) return true;
  if (/qu[eé]\s+d[ií]a|cual\s+es\s+la\s+fecha|que\s+d[ií]a\s+es|\bhora\b.*\b(es|sera|será)\b/.test(t)) return true;
  if (
    /mejores?\s+campos?\s+para\s+invertir\b/.test(t) &&
    !detectarCultivo(pregunta) &&
    !RE_MERCADO_HORTI_O_FRUTA.test(t)
  ) {
    return true;
  }
  return false;
};

/**
 * Consulta del dominio agropecuario operativo (mercado, cultivo, clima, insumos, etc.).
 * No confundir con chistes o charla sin ancla agro.
 */
const esConsultaAgroOperativa = (pregunta = "") => {
  const t = normalizar(pregunta);
  if (t.length < 8) return false;
  const temas = detectarTemas(pregunta);
  if (temas.length > 0) return true;
  if (detectarCultivo(pregunta)) return true;
  if (RE_MERCADO_HORTI_O_FRUTA.test(t)) return true;
  if (
    /(campo|hectarea|hect[aá]rea|siembra|cosecha|grano|ganad|tambo|leche|hacienda|silobolsa|flete|rieg|fertiliz|plaga|rendim|magyp|sisa|retenc|rizobacter|inocul|pulveriz|sembrad|trillar|agronom|agr[oó]nom|agropecuario|chacra|estancia)/.test(
      t
    )
  ) {
    return true;
  }
  return false;
};

/**
 * No hay dato interno útil para cerrar la consulta (precio en BD, o señal explícita en respuesta_base).
 * Si ya hay precio trazable, no forzar búsqueda.
 */
const hayHuecoDatosInternosParaMercado = (respuestaBase, datos, pregunta) => {
  if (hayPrecioTrazable(datos)) return false;
  const b = String(respuestaBase || "");
  if (
    /\bPrecio:\s*sin dato puntual en base\b|\bsin datos en base\b|\bsin dato trazable\b|\bsin dato en base\b/i.test(b)
  ) {
    return true;
  }
  const tn = normalizar(pregunta);
  const temas = Array.isArray(datos?.temas) ? datos.temas : detectarTemas(pregunta);
  if (temas.includes("precio") || temas.includes("venta") || temas.includes("dolar")) return true;
  if (detectarCultivo(pregunta) || RE_MERCADO_HORTI_O_FRUTA.test(tn)) return true;
  if (/\b(insumo|fertilizante|urea|gasoil|agroquimico|fitosanitario|semilla)\b/.test(tn)) return true;
  return false;
};

/**
 * Agro operativo + hueco en datos internos → intentar Google Search (regla simple pedida por producto).
 * Exento: saludos cortos, fecha/hora, “campos para invertir” genérico sin cultivo/hortícola.
 * Consulta solo clima: no forzar acá (sigue el ramo meteo + clima_pronostico_resumen).
 */
const debeForzarGroundingAgroSinHechoEnBd = (pregunta, datos, respuestaBase) => {
  const t = String(pregunta || "").trim();
  if (t.length < 8) return false;
  if (esConsultaExentaForzadoGoogle(pregunta)) return false;
  if (!esConsultaAgroOperativa(pregunta)) return false;
  const temas = Array.isArray(datos?.temas) ? datos.temas : detectarTemas(pregunta);
  const soloClimaSinMercado =
    esConsultaMeteoPorTexto(pregunta) &&
    !temas.includes("precio") &&
    !temas.includes("venta") &&
    !temas.includes("dolar") &&
    !datos?.cultivo &&
    !detectarCultivo(pregunta) &&
    !RE_MERCADO_HORTI_O_FRUTA.test(normalizar(pregunta));
  if (soloClimaSinMercado) return false;
  return hayHuecoDatosInternosParaMercado(respuestaBase, datos, pregunta);
};

const CULTIVOS_MENCION_SNAPSHOT = ["soja", "maiz", "trigo", "girasol", "sorgo", "cebada", "papa"];

const contarCultivosMencionadosEnTexto = (pregunta = "") => {
  const t = normalizar(pregunta);
  return CULTIVOS_MENCION_SNAPSHOT.filter((k) => t.includes(k)).length;
};

/** Un cultivo en precio/venta, sin precio trazable en BD, sin pedido explícito de comparativa. */
const esHuecoPrecioCultivoUnico = (datos, pregunta = "") => {
  const temas = Array.isArray(datos?.temas) ? datos.temas : detectarTemas(pregunta);
  if (!datos?.cultivo) return false;
  if (!(temas.includes("precio") || temas.includes("venta"))) return false;
  if (hayPrecioTrazable(datos)) return false;
  if (contarCultivosMencionadosEnTexto(pregunta) >= 2) return false;
  if (/\b(vs\.?|versus|compar)\b/i.test(String(pregunta || ""))) return false;
  return true;
};

/**
 * El snapshot diario trae muchos granos; si preguntaron un solo cultivo sin precio en BD,
 * mandar todo el JSON invita a la IA a “rellenar” con soja/maíz aunque no sustituyan a papa.
 * Si no pidieron dólar, sacamos también tipo_cambio del JSON (sigue figurando en historial/noticias si no limpiamos aparte).
 */
const filtrarSnapshotSiHuecoPrecioUnico = (snapshot, datos, pregunta = "") => {
  if (!snapshot || !Array.isArray(snapshot.items) || snapshot.items.length === 0) return snapshot;
  if (!esHuecoPrecioCultivoUnico(datos, pregunta)) return snapshot;
  const temas = Array.isArray(datos?.temas) ? datos.temas : detectarTemas(pregunta);
  const pideDolarEnConsulta = temas.includes("dolar");
  const cNorm = normalizar(datos.cultivo);
  const tn = normalizar(pregunta);
  const pideFuturos = /(matba|rofex|futuro|carry|backwardation|base|spread)/.test(tn);
  const productoMatcheaCultivo = (producto = "") => {
    const p = normalizar(String(producto || ""));
    if (!p) return false;
    if (p === cNorm) return true;
    if (p.includes(cNorm) || cNorm.includes(p)) return true;
    return false;
  };
  const itemsFiltrados = snapshot.items.filter((row) => {
    const cat = normalizar(String(row.categoria || ""));
    if (cat === "tipo_cambio") return pideDolarEnConsulta;
    if (cat === "fletes") return true;
    if (cat === "futuros" && pideFuturos) return true;
    if (cat === "futuros") return false;
    return productoMatcheaCultivo(row.producto);
  });
  if (itemsFiltrados.length === snapshot.items.length) return snapshot;
  return { ...snapshot, items: itemsFiltrados };
};

/**
 * Grounding (Google Search vía Gemini) cuando la consulta no tiene respuesta trazable en base
 * para lo que pide (temas/cultivo/futuros explícitos), el bloque base señala huecos fuertes,
 * o no hay ningún hecho interno útil y la pregunta es sustantiva.
 */
const deberiaActivarGrounding = (pregunta, datos, respuestaBase) => {
  if (!groundingHabilitadoEnConfig() || !process.env.GEMINI_API_KEY?.trim()) return false;
  if (esProbableConocimientoGeneralSinAgro(pregunta)) return false;
  const t = String(pregunta || "").trim();
  const esMeteo = esConsultaMeteoPorTexto(pregunta);
  if (t.length < (esMeteo ? 6 : 12)) return false;
  const charsSignificativos = t.replace(/\s/g, "").length;
  if (charsSignificativos < (esMeteo ? 10 : 18)) return false;
  if (/^(hola|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|dale|ok|listo|gracias|che)\b/i.test(t) && t.length < 50) {
    return false;
  }

  const temas = Array.isArray(datos?.temas) ? datos.temas : detectarTemas(pregunta);
  const tn = normalizar(pregunta);
  const cultivo = datos?.cultivo || detectarCultivo(pregunta);
  const precioTema = temas.includes("precio") || temas.includes("venta");
  const pideDisponible = preguntaPideDisponible(pregunta);
  const pideFuturos = /(matba|rofex|futuro|carry|backwardation|base|spread)/.test(tn);

  const hayMercadosWeb = Array.isArray(datos?.webFallback?.mercados) && datos.webFallback.mercados.length > 0;
  const hayFuturosWeb = Array.isArray(datos?.webFallback?.futuros) && datos.webFallback.futuros.length > 0;
  const hayDolar = Array.isArray(datos?.dolar?.items) && datos.dolar.items.length > 0;
  const hayClima = contarItemsClima(datos) > 0;
  const climaVencido = esMeteo && climaSinPronosticoVigente(datos);
  const hayNoticias = Array.isArray(datos?.noticias) && datos.noticias.length > 0;

  const faltaPrecioRelevante =
    (precioTema || Boolean(cultivo)) &&
    (!hayPrecioTrazable(datos) || (pideDisponible && precioEsSoloReferenciaNoDisponible(datos?.precio || {}))) &&
    !hayMercadoWebQueAplicaAPregunta(datos, pregunta);
  const faltaDolar = temas.includes("dolar") && !hayDolar;
  const faltaClima = esMeteo && (!hayClima || climaVencido);
  const faltaFuturos = pideFuturos && !hayFuturosWeb;

  const sinHechoParaLoPedido = faltaPrecioRelevante || faltaDolar || faltaClima || faltaFuturos;

  const sinTemaNiCultivo = temas.length === 0 && !cultivo && !pideFuturos;
  const vacioGeneral =
    sinTemaNiCultivo &&
    !hayPrecioTrazable(datos) &&
    !hayMercadoWebQueAplicaAPregunta(datos, pregunta) &&
    !hayDolar &&
    !hayClima &&
    !hayNoticias &&
    !hayFuturosWeb &&
    t.length >= 28;

  const base = String(respuestaBase || "");
  const baseHuecoEstructural =
    /confianza de lectura:\s*baja|sin dato trazable|sin dato puntual|sin datos en base|sin dato en base|sin futuro comparable/i.test(
      base
    );

  const precioStale =
    hayPrecioTrazable(datos) &&
    String(datos?.precio?.fuente || "").toLowerCase() === "bd_stale" &&
    (precioTema || Boolean(cultivo));

  return sinHechoParaLoPedido || vacioGeneral || baseHuecoEstructural || precioStale;
};

const DISCLAIMER_GROUNDING = [
  "⚠️ _Complemento web_ — *no reemplaza* la base AgroHabilis.",
  "Puede estar desactualizado o ser inexacto → verificá *fuente* y *fecha* antes de operar.",
].join("\n");

const FORMATO_SALIDA_WHATSAPP_GROUNDING =
  "Formato obligatorio: mensaje tipo *WhatsApp* — *negrita* para títulos y cifras clave, _cursiva_ para matices, emojis al inicio de cada bloque (📌 💱 🌧️ etc.) y una línea ━━━━━━━━━━━━━━━━━━━━ entre secciones si cubrís más de un punto.";

/** Pronóstico 7 días: filas {fecha, temp_min, ...} necesitan profundidad >3; antes quedaban como [objeto_compactado] y la IA inventaba "sin datos en base". */
const MAX_DEPTH_COMPACTAR_JSON = 6;

const compactarValor = (valor, depth = 0) => {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === "string") return truncarTexto(valor, 280);
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  if (Array.isArray(valor)) {
    const maxItems = depth === 0 ? 8 : 5;
    return valor.slice(0, maxItems).map((v) => compactarValor(v, depth + 1));
  }
  if (typeof valor === "object") {
    if (depth >= MAX_DEPTH_COMPACTAR_JSON) return "[objeto_compactado]";
    const out = {};
    for (const [k, v] of Object.entries(valor)) {
      out[k] = compactarValor(v, depth + 1);
    }
    return out;
  }
  return String(valor);
};

const esReclamoConsistenciaMercado = (pregunta = "") => {
  const t = normalizar(pregunta);
  return (
    /(no cierra|al reves|al rev[eé]s|dato consistente|no se puede usar|mismo dolar|mismo dólar|spread|carry|backwardation|base)/.test(
      t
    ) && /(soja|maiz|ma[ií]z)/.test(t)
  );
};

const obtenerSpotRosario = async (cultivo) => {
  const fechaR = await query(
    `
      SELECT MAX(fecha) AS fecha
      FROM precios
      WHERE LOWER(cultivo)=LOWER($1)
        AND LOWER(COALESCE(mercado,'')) LIKE '%ros%'
        AND moneda='ARS'
    `,
    [cultivo]
  );
  const fecha = fechaR.rows[0]?.fecha;
  if (!fecha) return null;
  const r = await query(
    `
      SELECT mercado, precio, moneda, fecha
      FROM precios
      WHERE LOWER(cultivo)=LOWER($1)
        AND fecha=$2::date
        AND LOWER(COALESCE(mercado,'')) LIKE '%ros%'
        AND moneda='ARS'
      ORDER BY precio DESC NULLS LAST
      LIMIT 1
    `,
    [cultivo, fecha]
  );
  return r.rows[0] || null;
};

const obtenerFuturoPosicion = async (cultivo, posicionRegex) => {
  const fechaR = await query(
    `
      SELECT MAX(fecha) AS fecha
      FROM futuros_posiciones
      WHERE LOWER(cultivo)=LOWER($1)
    `,
    [cultivo]
  );
  const fecha = fechaR.rows[0]?.fecha;
  if (!fecha) return null;
  const r = await query(
    `
      SELECT posicion, precio_usd, fecha
      FROM futuros_posiciones
      WHERE LOWER(cultivo)=LOWER($1)
        AND fecha=$2::date
        AND LOWER(COALESCE(posicion,'')) ~ $3
      ORDER BY posicion
      LIMIT 1
    `,
    [cultivo, fecha, posicionRegex]
  );
  return r.rows[0] || null;
};

const obtenerDolarImplicito = async () => {
  const r = await query(
    `
      SELECT tipo, valor, fecha
      FROM tipo_cambio
      WHERE LOWER(tipo) IN ('mep','bolsa')
      ORDER BY fecha DESC
      LIMIT 1
    `
  );
  return r.rows[0] || null;
};

const toFecha = (v) => {
  if (!v) return "s/d";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toISOString().slice(0, 10);
};

const construirRespuestaBaseConDatos = async ({ pregunta, datos }) => {
  const tNorm = normalizar(pregunta);
  const pideRelacion = esConsultaInterpretativaRelacion(pregunta);
  const pideNovillo = /(novillo|novillos|hacienda|ternero|feedlot|encierre)/.test(tNorm);
  const pideMaiz = /(maiz|maíz)/.test(tNorm);
  if (pideRelacion && (pideNovillo || pideMaiz)) {
    const precioOk = Number.isFinite(Number(datos?.precio?.precio)) && Number(datos?.precio?.precio) > 0;
    const tcItems = Array.isArray(datos?.dolar?.items) ? datos.dolar.items : [];
    const tieneTc = tcItems.some((x) => Number.isFinite(Number(x?.valor)) && Number(x.valor) > 0);
    const tieneFutMaizWeb = Array.isArray(datos?.webFallback?.futuros)
      ? datos.webFallback.futuros.some((f) => /(maiz|maíz)/.test(normalizar(f?.cultivo || "")))
      : false;
    const faltanPatas = !precioOk || !tieneTc || (pideMaiz && !tieneFutMaizWeb);
    if (faltanPatas) {
      return [
        "📌 *No tengo patas completas para cerrar la relación hoy*",
        "━━━━━━━━━━━━━━━━━━━━",
        `- Maíz: ${precioOk ? "con referencia disponible" : "sin dato puntual en base"}.`,
        `- Novillo/hacienda: ${pideNovillo ? "falta referencia consistente para compararlo en la misma base temporal" : "no solicitado explícitamente"}.`,
        `- Tipo de cambio/futuro comparable: ${tieneTc && (tieneFutMaizWeb || !pideMaiz) ? "ok" : "incompleto"}.`,
        "",
        "👉 Si querés igual avanzar, te doy una lectura orientativa con fuentes externas (aclarando supuestos), o me decís plaza/fecha objetivo y lo cierro más fino.",
      ].join("\n");
    }
  }

  if (esReclamoConsistenciaMercado(pregunta)) {
    const futurosWeb = Array.isArray(datos?.webFallback?.futuros) ? datos.webFallback.futuros : [];
    const mercadosWeb = Array.isArray(datos?.webFallback?.mercados) ? datos.webFallback.mercados : [];
    const pickFuturoWeb = (cultivo, mes) => {
      const c = normalizar(cultivo);
      const m = normalizar(mes);
      return (
        futurosWeb.find(
          (x) =>
            normalizar(x.cultivo) === c &&
            (normalizar(x.posicion).includes(m) || normalizar(x.posicion).includes(m === "mayo" ? "may" : "jul"))
        ) || null
      );
    };
    const pickSpotWeb = (cultivo) =>
      mercadosWeb.find((x) => normalizar(x.cultivo) === normalizar(cultivo) && Number.isFinite(Number(x.precio_ars))) || null;

    const [tc, spotSoja, spotMaiz, futMaySoja, futJulSoja, futMayMaiz, futJulMaiz] = await Promise.all([
      obtenerDolarImplicito(),
      obtenerSpotRosario("soja"),
      obtenerSpotRosario("maiz"),
      obtenerFuturoPosicion("soja", "(may|mayo|05)"),
      obtenerFuturoPosicion("soja", "(jul|julio|07)"),
      obtenerFuturoPosicion("maiz", "(may|mayo|05)"),
      obtenerFuturoPosicion("maiz", "(jul|julio|07)"),
    ]);
    const tcVal = Number(tc?.valor);
    const tcFecha = toFecha(tc?.fecha);
    const f = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "sin dato en base");
    const calcLinea = (cultivo, spotBD, futBD, etiqueta) => {
      const futWeb = pickFuturoWeb(cultivo, etiqueta);
      const fut = futBD || (futWeb ? { ...futWeb, posicion: futWeb.posicion || `web_${etiqueta.toLowerCase()}` } : null);
      const spotWeb = pickSpotWeb(cultivo);
      const spot =
        spotBD ||
        (spotWeb
          ? { precio: spotWeb.precio_ars, fecha: spotWeb.fecha, mercado: spotWeb.mercado || "web" }
          : null);
      const spotArs = Number(spot?.precio);
      const futUsd = Number(fut?.precio_usd);
      const spotUsd = Number.isFinite(spotArs) && Number.isFinite(tcVal) && tcVal > 0 ? spotArs / tcVal : null;
      const spread = Number.isFinite(spotUsd) && Number.isFinite(futUsd) && spotUsd > 0 ? ((futUsd - spotUsd) / spotUsd) * 100 : null;
      const base = Number.isFinite(spotUsd) && Number.isFinite(futUsd) ? spotUsd - futUsd : null;
      const estructura = Number.isFinite(spread)
        ? spread > 0
          ? "carry"
          : spread < 0
          ? "backwardation"
          : "paridad"
        : "sin dato en base";
      return [
        `${cultivo.toUpperCase()} ${etiqueta}:`,
        `- Rosario cámara (disp): ${Number.isFinite(spotArs) ? formatearPrecio(spotArs) : "sin dato en base"} ARS | fecha ${toFecha(
          spot?.fecha
        )}`,
        `- MATBA cercano (${etiqueta}): ${f(futUsd)} USD/t | posición ${fut?.posicion || "sin dato en base"} | fecha ${toFecha(
          fut?.fecha
        )}`,
        `- Dólar implícito único: ${Number.isFinite(tcVal) ? formatearPrecio(tcVal) : "sin dato en base"} (${String(
          tc?.tipo || "MEP/BOLSA"
        ).toUpperCase()}) fecha ${tcFecha}`,
        `- Spread %: ${Number.isFinite(spread) ? `${spread.toFixed(1)}%` : "sin dato en base"}`,
        `- Base (spot-futuro): ${Number.isFinite(base) ? `${base.toFixed(2)} USD/t` : "sin dato en base"}`,
        `- Estructura: ${estructura}`,
      ].join("\n");
    };
    return [
      "Comparativo consistente solicitado (misma referencia de dólar):",
      calcLinea("soja", spotSoja, futMaySoja, "Mayo"),
      calcLinea("soja", spotSoja, futJulSoja, "Julio"),
      calcLinea("maiz", spotMaiz, futMayMaiz, "Mayo"),
      calcLinea("maiz", spotMaiz, futJulMaiz, "Julio"),
      "Si algún campo figura 'sin dato en base', falta esa pieza para cerrar la lectura completa.",
    ].join("\n\n");
  }

  if (esPedidoDecisionOperativa(pregunta)) {
    const cultivosPedido = extraerCultivosPregunta(pregunta);
    const cultivos = cultivosPedido.length ? cultivosPedido : [datos?.cultivo].filter(Boolean);
    const mercadosWeb = Array.isArray(datos?.webFallback?.mercados) ? datos.webFallback.mercados : [];
    const futurosWeb = Array.isArray(datos?.webFallback?.futuros) ? datos.webFallback.futuros : [];
    const haySpotInterno = Boolean(datos?.precio?.precio != null);
    const haySpotWeb = mercadosWeb.length > 0;
    const hayFuturosWeb = futurosWeb.length > 0;
    const confianza = haySpotInterno && hayFuturosWeb ? "media-alta" : haySpotInterno || haySpotWeb ? "media" : "baja";

    const bloquesMercado = cultivos.map((c) => {
      const mWeb = mercadosWeb.find((x) => normalizar(x.cultivo) === normalizar(c));
      const fWeb = futurosWeb.filter((x) => normalizar(x.cultivo) === normalizar(c)).slice(0, 2);
      const spotTxt =
        datos?.precio?.precio != null && normalizar(datos?.cultivo || "") === normalizar(c)
          ? (() => {
              const clf = datos.precio.clasificacion_precio || clasificarTipoFuentePrecio(datos.precio);
              const fm = datos.precio.fuente_mostrar || fuenteLegibleParaPrecio(datos.precio);
              return `${formatearPrecio(datos.precio.precio)} (${toFecha(datos.precio.fecha)}) [${clf.tipoEtiqueta} · ${fm}]`;
            })()
          : mWeb
          ? `${Number.isFinite(Number(mWeb.precio_ars)) ? `${formatearPrecio(mWeb.precio_ars)} ARS` : `${Number(mWeb.precio_usd).toFixed(2)} USD/t`} (${toFecha(
              mWeb.fecha
            )}) [web:${mWeb.fuente || "ref"}]`
          : "sin dato trazable";
      const futTxt = fWeb.length
        ? fWeb.map((f) => `${f.posicion}: ${Number(f.precio_usd).toFixed(2)} USD/t [web:${f.fuente || "ref"}]`).join(" | ")
        : "sin futuro comparable";
      return `- ${String(c).toUpperCase()}: spot ${spotTxt} | futuros ${futTxt}`;
    });

    const decisiones = cultivos.map((c) => {
      if (normalizar(c) === "soja") {
        return "- Soja: decisión parcial (20-30%) y resto abierto, priorizando no sobre-vender sin curva comparable completa.";
      }
      if (normalizar(c) === "maiz") {
        return "- Maíz: si impacta feedlot, cubrir parcialmente costo (fijación/cobertura escalonada) y no dejar 100% abierto.";
      }
      return `- ${String(c).toUpperCase()}: avanzar en forma parcial y revalidar con próximo corte de mercado.`;
    });

    return [
      "Mercado:",
      ...bloquesMercado,
      "",
      "Lectura:",
      `- Confianza de lectura: ${confianza} (según cobertura y comparabilidad de fuentes).`,
      "- Si falta futuro comparable, no se fuerza una conclusión de carry/backwardation cerrada.",
      "",
      "Decisión:",
      ...decisiones,
      "",
      "Riesgo:",
      "- Riesgo principal: mezclar referencias heterogéneas (FOB/spot/futuros) sin comparabilidad temporal.",
      "- Riesgo operativo: si sube maíz, se comprime margen de feedlot.",
    ].join("\n");
  }

  const lineas = [];
  const temasLocal = Array.isArray(datos?.temas) ? datos.temas : detectarTemas(pregunta);
  const soloMeteoSinMercado =
    esConsultaMeteoPorTexto(pregunta) &&
    !temasLocal.includes("precio") &&
    !temasLocal.includes("venta") &&
    !temasLocal.includes("dolar") &&
    !datos?.cultivo;
  const cultivoTxt = soloMeteoSinMercado
    ? "clima"
    : datos?.cultivo
      ? String(datos.cultivo).toUpperCase()
      : "mercado";
  lineas.push(`Respuesta base (${cultivoTxt})`);

  if (!soloMeteoSinMercado) {
    if (datos?.precio?.precio != null) {
      const clf = datos.precio.clasificacion_precio || clasificarTipoFuentePrecio(datos.precio);
      const fm = datos.precio.fuente_mostrar || fuenteLegibleParaPrecio(datos.precio);
      lineas.push(
        `- Precio ${datos.cultivo || "referencia"}: ${formatearPrecio(datos.precio.precio)} ${String(
          datos.precio.moneda || "ARS"
        )}/tn — tipo: ${clf.tipoEtiqueta}; ref/plaza: ${fm}; condición: ${clf.condicionComercial}; fecha: ${toFecha(
          datos.precio.fecha
        )}`
      );
      if (datos.precioComplementarioFob?.precio != null) {
        const cfo = datos.precioComplementarioFob;
        const clfF = cfo.clasificacion_precio || clasificarTipoFuentePrecio(cfo);
        const fmF = cfo.fuente_mostrar || fuenteLegibleParaPrecio(cfo);
        const mon = String(cfo.moneda || "USD").toUpperCase();
        const valorFmt =
          mon === "USD"
            ? `${Number(cfo.precio).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD/tn`
            : `${formatearPrecio(Number(cfo.precio))} ${mon}/tn`;
        lineas.push(
          `- Complementario ${clfF.tipoEtiqueta} (no cobro campo): ${valorFmt} — ref: ${fmF}; fecha ${toFecha(cfo.fecha)} — sólo referencia exportación/puerto; no equivale al precio disponible de arriba.`
        );
      }
    } else {
      lineas.push("- Precio: sin dato puntual en base.");
    }
  }

  if (!soloMeteoSinMercado && Array.isArray(datos?.webFallback?.mercados) && datos.webFallback.mercados.length) {
    const webM = datos.webFallback.mercados
      .slice(0, 4)
      .map((x) => {
        const valor = Number.isFinite(Number(x.precio_ars))
          ? `${formatearPrecio(x.precio_ars)} ARS`
          : Number.isFinite(Number(x.precio_usd))
          ? `${Number(x.precio_usd).toFixed(2)} USD/t`
          : "sin dato";
        return `${String(x.cultivo || "").toUpperCase()} ${x.mercado || "web"}: ${valor} (${toFecha(x.fecha)})`;
      })
      .join(" | ");
    lineas.push(`- Web fallback mercados: ${webM}`);
  }

  const fletesSnap = Array.isArray(datos?.snapshot?.fletes) ? datos.snapshot.fletes : [];
  const preguntaFlete =
    /(flete|fletes|fas|puerto|puertos|plaza|plazas|destino|destinos|neto a planta|neto en planta|transporte de granos|costo log|ruta|viaje|cami[oó]n|camion)/.test(
      normalizar(pregunta)
    ) || Boolean(datos?.contexto_hilo_resuelto?.tema_activo_detectado === "logistica_continua");
  if (preguntaFlete && fletesSnap.length) {
    const fl = fletesSnap
      .slice(0, 3)
      .map((x) => {
        const usd = Number.isFinite(Number(x.costo_usd_tn)) ? `${Number(x.costo_usd_tn).toFixed(2)} USD/tn` : "USD/tn s/d";
        const arsTn = Number.isFinite(Number(x.costo_ars_por_tn))
          ? `${formatearPrecio(x.costo_ars_por_tn)} ARS/tn`
          : "ARS/tn s/d";
        const tot =
          Number.isFinite(Number(x.costo_total_ars_viaje)) && Number(x.toneladas_referencia_viaje) > 0
            ? ` · total ref. ${String(Math.round(Number(x.toneladas_referencia_viaje)))} tn: ${formatearPrecio(
                Number(x.costo_total_ars_viaje)
              )} ARS`
            : "";
        return `${String(x.destino || "destino")}${x.distancia_km != null ? ` (${x.distancia_km} km)` : ""}: ${usd} · ${arsTn}${tot}`;
      })
      .join(" | ");
    lineas.push(`- Flete referencia (coherentes por tn): ${fl} [${fletesSnap[0]?.fuente || "fletes"}]`);
  }

  const dolarItems = Array.isArray(datos?.dolar?.items) ? ordenarItemsTipoCambio(datos.dolar.items) : [];
  if (dolarItems.length) {
    const oficial = dolarItems.find((x) => normalizar(x.tipo) === "oficial");
    const resto = dolarItems.filter((x) => normalizar(x.tipo) !== "oficial");
    const fuenteD = datos?.dolar?.fuente || "ref";
    if (oficial) {
      lineas.push(`- Dólar oficial (prioridad): ${formatearItemTipoCambioTexto(oficial)} [${fuenteD}]`);
    }
    if (resto.length) {
      lineas.push(`- ${oficial ? "Otros tipos de cambio" : "Tipos de cambio"}:`);
      lineas.push(...resto.map((x) => `  · ${formatearItemTipoCambioTexto(x)}`));
    }
  }

  const climaItems = Array.isArray(datos?.clima?.items) ? datos.clima.items : Array.isArray(datos?.clima) ? datos.clima : [];
  if (climaItems.length) {
    const ordenados = [...climaItems].sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || "")));
    const pronos = ordenados.slice(0, 7);
    const bloque = pronos
      .map(
        (d) =>
          `  · ${toFecha(d.fecha)}: ${d.temp_min ?? "s/d"}–${d.temp_max ?? "s/d"}° precip ${d.precipitacion ?? "s/d"} mm — ${String(
            d.descripcion || ""
          ).slice(0, 80)}`
      )
      .join("\n");
    lineas.push(`- Clima (${datos?.clima?.fuente || "ref"}) próximos días:\n${bloque}`);
  }

  const noticias = Array.isArray(datos?.noticias) ? datos.noticias.slice(0, 2) : [];
  if (noticias.length) {
    lineas.push(
      `- Contexto noticioso: ${noticias
        .map((n) => `${n.titulo} [${n.fuente || "s/fuente"} - ${toFecha(n.publicado_en)}]`)
        .join(" | ")}`
    );
  }

  if (!soloMeteoSinMercado && Array.isArray(datos?.webFallback?.futuros) && datos.webFallback.futuros.length) {
    const futTxt = datos.webFallback.futuros
      .slice(0, 4)
      .map((x) => `${String(x.cultivo || "").toUpperCase()} ${x.posicion}: ${Number(x.precio_usd).toFixed(2)} USD/t`)
      .join(" | ");
    lineas.push(`- Web fallback futuros: ${futTxt}`);
  }

  lineas.push(`- Consulta original: ${truncarTexto(pregunta, 180)}`);
  return lineas.join("\n");
};

module.exports = {
  nombre: "consulta",
  detectarTemas,
  __qa: {
    limpiarSalidaIA,
    detectarCultivo,
    resolverContextoConversacional,
    cultivoPrimeroEnHistorial,
  },

  async obtenerDatos(usuario, pregunta) {
    const whatsappNorm = String(usuario?.whatsapp || "").replace(/\D/g, "");
    let historialRows = [];
    if (whatsappNorm) {
      const hHist = horasFeedbackBroadcastMasivo();
      const filtroHist = sqlMasivoAdminRecienteOtroHistorial(2);
      const hist = await query(
        `
          SELECT pregunta, respuesta, creado_en
          FROM historial_consultas
          WHERE whatsapp = $1
            AND ${filtroHist}
          ORDER BY creado_en DESC
          LIMIT 8
        `,
        [whatsappNorm, hHist]
      );
      historialRows = hist.rows || [];
    }

    let temas = detectarTemas(pregunta);
    const ctxHilo = resolverContextoConversacional(pregunta, historialRows);
    if (ctxHilo.temas_agregados?.length) temas = [...new Set([...temas, ...ctxHilo.temas_agregados])];

    let cultivo = detectarCultivo(pregunta) || null;
    if (!cultivo && ctxHilo.cultivo_contextual) cultivo = ctxHilo.cultivo_contextual;

    const datos = {
      temas,
      cultivo,
      historial: historialRows,
      contexto_hilo_resuelto: ctxHilo,
    };
    if (temas.includes("precio") && cultivo) {
      // Ventana amplia: el mercado se publica por jornada; 2h dejaban "sin dato" con BD poblada.
      datos.precio = await obtenerPrecioFresco(cultivo, 120);
      const p = datos.precio;
      const ok =
        p &&
        p.precio != null &&
        Number.isFinite(Number(p.precio)) &&
        Number(p.precio) > 0;
      if (!ok) {
        const ult = await obtenerUltimoPrecioCultivoDesdeBd(cultivo);
        if (ult) datos.precio = ult;
      }
      if (datos.precio) {
        datos.precioComplementarioFob = await obtenerPrecioComplementarioFob(cultivo, datos.precio);
      }
    }
    if (temas.includes("dolar")) datos.dolar = await obtenerDolarFresco(0);
    let latN = Number(usuario?.lat);
    let lngN = Number(usuario?.lng);
    if (esConsultaMeteoPorTexto(pregunta) && (!Number.isFinite(latN) || !Number.isFinite(lngN)) && usuario?.partido && usuario?.provincia) {
      try {
        const geo = await geocodificarZonaArgentina({
          partido: usuario.partido,
          provincia: usuario.provincia,
        });
        if (geo) {
          latN = geo.lat;
          lngN = geo.lng;
          if (usuario?.id) {
            await actualizarUsuario(usuario.id, { lat: geo.lat, lng: geo.lng }).catch(() => {});
          }
        }
      } catch (_e) {
        /* seguimos sin coords */
      }
    }
    if (esConsultaMeteoPorTexto(pregunta) && Number.isFinite(latN) && Number.isFinite(lngN)) {
      try {
        datos.clima = await obtenerClimaFresco(latN, lngN, 3);
      } catch (_e) {
        try {
          const vivo = await obtenerClima(latN, lngN);
          datos.clima = { items: vivo, fuente: "vivo_openmeteo_retry" };
        } catch (_e2) {
          datos.clima = { items: [], fuente: "clima_error" };
        }
      }
    }
    datos.snapshot = await obtenerSnapshotParaIA(usuario);
    datos.noticias = await obtenerNoticiasFrescas([cultivo, ...temas].filter(Boolean), 3);

    const preguntaNorm = normalizar(pregunta);
    const pideFuturos = /(matba|rofex|futuro|carry|backwardation|base|spread)/.test(preguntaNorm);
    const faltaPrecioBase = temas.includes("precio") && !datos.precio;
    const itemsClima = contarItemsClima(datos);
    const sinClimaCuandoImporta = esConsultaMeteoPorTexto(pregunta) && !itemsClima;
    const sinDatosBaseRelevantes =
      !datos.precio &&
      (!datos.dolar || !(Array.isArray(datos.dolar.items) && datos.dolar.items.length)) &&
      (!datos.clima || !itemsClima) &&
      (!datos.noticias || !datos.noticias.length);
    if (faltaPrecioBase || pideFuturos || sinDatosBaseRelevantes || sinClimaCuandoImporta) {
      try {
        const webFallback = await buscarDatosAgroEnWeb({
          pregunta,
          cultivos: datos.cultivo ? [datos.cultivo] : [],
        });
        datos.webFallback = webFallback;
      } catch (_e) {
        datos.webFallback = { mercados: [], futuros: [], noticias: [], errores: ["web_fallback_error"] };
      }
    }
    return datos;
  },

  async renderizar(usuario, datos, pregunta) {
    const modulosContexto = detectarModulosContexto(pregunta, datos);
    const respuestaBase = await construirRespuestaBaseConDatos({ pregunta, datos });
    const guardrailInterpretativoActivo = /^📌 \*No tengo patas completas/i.test(String(respuestaBase || "").trim());
    if (guardrailInterpretativoActivo) {
      let mensajeFinal = respuestaBase;
      let pipeline = "base_datos + guardrail_interpretativo";
      const traceExtra = [];
      if (groundingHabilitadoEnConfig() && process.env.GEMINI_API_KEY?.trim()) {
        try {
          const g = await generarConGroundingGoogleSearch({
            prompt: [
              "Sos asistente agropecuario para productores argentinos.",
              "Faltan patas internas para cerrar una relación/decisión de mercado.",
              "Complementá con búsqueda web reciente y trazable en Argentina.",
              FORMATO_SALIDA_WHATSAPP_GROUNDING,
              "Máximo 8 líneas. Si no hay dato exacto, repreguntá en una sola línea qué falta (plaza/fecha/categoría).",
              "",
              "Consulta:",
              truncarTexto(pregunta, 400),
              "",
              "Base interna (no contradecir; complementar):",
              truncarTexto(respuestaBase, 900),
            ].join("\n"),
            contextLabel: "consulta.guardrail_interpretativo",
          });
          const textoG = limpiarSalidaIA(String(g.texto || "").trim()).slice(0, getGroundingMaxChars());
          if (textoG) {
            const urlsLine = formatearFuentesGroundingWhatsApp(g.urls);
            const cabWeb = ["━━━━━━━━━━━━━━━━━━━━", "🌐 *Complemento web*", "━━━━━━━━━━━━━━━━━━━━"].join("\n");
            mensajeFinal = [mensajeFinal, "", cabWeb, DISCLAIMER_GROUNDING, "", textoG + urlsLine].join("\n");
            pipeline = "base_datos + guardrail_interpretativo + grounding_google";
            traceExtra.push({
              stage: "grounding_google_search",
              ok: true,
              model: g.model,
              via: g.via,
              urls: g.urls || [],
              queries: g.queries || [],
            });
          }
        } catch (errG) {
          traceExtra.push({
            stage: "grounding_google_search",
            ok: false,
            error: String(errG?.message || errG),
          });
        }
      }
      return {
        mensaje: aplicarLayout("consulta", usuario, { mensaje: mensajeFinal }),
        meta: {
          temas: datos.temas,
          modulosContexto,
          respuestaPipeline: pipeline,
          iaProvider: null,
          iaProviderTrace: traceExtra,
          tokensUsados: null,
        },
      };
    }
    const huecoUnico = esHuecoPrecioCultivoUnico(datos, pregunta);
    const snapshotParaIa = filtrarSnapshotSiHuecoPrecioUnico(datos.snapshot, datos, pregunta);
    const cNormIa = datos?.cultivo ? normalizar(datos.cultivo) : "";
    const webFallbackIa =
      huecoUnico && datos.webFallback
        ? {
            ...datos.webFallback,
            mercados: (datos.webFallback.mercados || []).filter((x) => normalizar(x.cultivo) === cNormIa),
            futuros: (datos.webFallback.futuros || []).filter((x) => normalizar(x.cultivo) === cNormIa),
          }
        : datos.webFallback;
    const noticiasIa = huecoUnico
      ? (datos.noticias || [])
          .filter((n) => normalizar(`${n.titulo || ""} ${n.resumen || ""}`).includes(cNormIa))
          .slice(0, 3)
      : (datos.noticias || []).slice(0, 3);
    const historialIa = (datos.historial || []).slice(0, 5);
    const datosCompactos = compactarValor({
      ...datos,
      snapshot: snapshotParaIa,
      webFallback: webFallbackIa,
      historial: historialIa,
      noticias: noticiasIa,
    });
    const itemsClimaIA = Array.isArray(datos?.clima?.items) ? datos.clima.items : Array.isArray(datos?.clima) ? datos.clima : [];
    const climaPronosticoResumen = itemsClimaIA.length
      ? [...itemsClimaIA]
          .sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || "")))
          .slice(0, 7)
          .map(
            (r) =>
              `${toFecha(r.fecha)} ${r.temp_min ?? "s/d"}–${r.temp_max ?? "s/d"}° precip ${r.precipitacion ?? "s/d"}mm (${String(
                r.descripcion || ""
              ).slice(0, 55)})`
          )
          .join(" | ")
          .slice(0, 1400)
      : "";
    const payload = {
      fecha_hoy_ar: fechaISOArgentina(),
      usuario: { nombre: usuario?.nombre, zona: `${usuario?.partido || ""}, ${usuario?.provincia || ""}` },
      pregunta: truncarTexto(pregunta, 350),
      respuesta_base: respuestaBase,
      datos: datosCompactos,
      /** Continuidad conversacional inferida (cultivo/tema/seguimiento) antes del compactado profundo de datos. */
      contexto_hilo_resuelto: datos.contexto_hilo_resuelto || null,
      /** Texto plano para la IA: el JSON compactado antes aplastaba filas de clima. */
      clima_pronostico_resumen: climaPronosticoResumen,
      contexto_ia: construirContextoIA(modulosContexto),
    };
    try {
      const temasFmt = Array.isArray(datos?.temas) ? datos.temas : detectarTemas(pregunta);
      const hayMeteo = esConsultaMeteoPorTexto(pregunta);
      const hayMercadoTema =
        temasFmt.includes("precio") || temasFmt.includes("venta") || temasFmt.includes("dolar");
      const tituloPrimerBloque =
        hayMeteo && !hayMercadoTema ? "Clima (o Pronóstico)" : hayMercadoTema && !hayMeteo ? "Mercado" : "Contexto";
      const instruccionCuatroBloques =
        "Cuatro apartados en este orden, con título explícito en cada uno: " +
        `*${tituloPrimerBloque}* -> *Lectura* -> *Decisión* -> *Riesgo*. ` +
        "Si la consulta es solo tiempo/clima/pronóstico, el primer apartado NO debe llamarse Mercado (usá Clima o Pronóstico). " +
        "Si es solo precios/dólar/venta, el primero puede ser Mercado o Precios. " +
        "Si mezcla temas, usá Contexto en el primero. ";
      const instruccionEditorHuecoUnico =
        "CASO HUECO CULTIVO ÚNICO (precio/venta sin precio trazable en BD para datos.cultivo): " +
        "NO uses la plantilla de cuatro apartados (Mercado→Lectura→Decisión→Riesgo). " +
        "Máximo 5–6 líneas en WhatsApp. " +
        "No agregues soja/maíz/trigo/girasol ni tablero de granos; no agregues dólar/CCL/MEP salvo que la pregunta lo pida o respuesta_base ya lo traiga. " +
        "No agregues clima ni temperaturas si clima_pronostico_resumen está vacío y respuesta_base no trae clima. " +
        "No inventes porcentajes de venta ni cobertura (p. ej. 20-30%) si no están en respuesta_base. " +
        "Podés sugerir una verificación concreta (fuente sectorial/bolsa) en una sola frase. ";

      const ia = await generarConPromptLibre({
        system:
          "Rol: editor contextual. " +
          "Si datos.historial trae turnos previos (pregunta/respuesta), usalos para interpretar la consulta actual: desambiguá referencias cortas (‘eso’, ‘lo mismo’, ‘mañana’ en sentido de calendario vs. mercado) según el hilo. " +
          "Campo JSON contexto_hilo_resuelto: si es_seguimiento es true, tratá la pregunta como continuación del mismo cultivo/tema que el último intercambio; usá cultivo_contextual y ultimo_turno_extracto como hechos de hilo y NO cambies a otro cultivo por noticias o alertas si la pregunta no lo pide (ej. seguimiento de maíz tras precio del maíz). " +
          "Si tema_activo_detectado es logistica_continua o la pregunta es sobre puerto/plaza/destino/viaje/ruta/flete y respuesta_base ya listó línea 'Flete referencia' con destinos (ej. Rosario, Bahía Blanca), respondé nombrando esos destinos de referencia y no digas sin dato puntual ni que el cultivo es otro si datos.cultivo y el hilo dicen lo contrario. " +
          "Si el usuario solo continúa un tema explícito del historial, mantené coherencia con ese tema; no cambies a otro dominio (p. ej. de fecha a mercado) sin que la pregunta lo pida. " +
          "Si el JSON trae clima_pronostico_resumen con contenido, son datos de pronóstico ya cargados: no digas que faltan en base salvo que esté vacío. " +
          "Usá fecha_hoy_ar del JSON como única fecha de 'hoy' en Argentina (no uses la fecha del servidor ni inventes el día). " +
          "La respuesta_base ya fue calculada por reglas de negocio y datos internos. " +
          "NO reemplaces ni contradigas la respuesta_base. " +
          "Tu tarea es SOLO mejorar claridad, orden y contexto operativo. " +
          (huecoUnico
            ? instruccionEditorHuecoUnico +
              "No repitas listados que ya fueron omitidos del JSON por hueco de cultivo. " +
              "Si falta el dato central, no lo reemplaces con otros mercados: una lectura conservadora breve alcanza. "
            : "Mantené todas las cifras y etiquetas técnicas (spread, base, carry/backwardation) exactamente como están en respuesta_base. " +
              "Nunca respondas solo con 'faltan datos'; siempre entregá lectura operativa y decisión parcial con lo disponible. " +
              instruccionCuatroBloques) +
          "Nunca repitas textual la pregunta del usuario al inicio (ni la misma frase como primera línea, ni eco de WhatsApp). " +
          "En datos.snapshot.fletes y en items categoria=fletes enriquecidos: costo_usd_tn y costo_ars_por_tn (o precio si viene unificado) son por tn; costo_total_ars_viaje es el total del viaje a toneladas_referencia_viaje. No mezcles total de viaje como si fuera ARS/tn. " +
          "Si aparece 'Web fallback', tratá esos datos como referencia externa trazable (fuente/fecha) y no los mezcles como si fueran base interna. " +
          "No inventes números, fuentes, fechas, ni recomendaciones fuera de los módulos habilitados. " +
          "Si respuesta_base ya lista precio u oferta para el cultivo de la consulta (o datos.precio en el JSON), NO digas que ese precio falta en base ni que no hay cotización vigente. " +
          "La zona del usuario (partido/provincia) es contexto para logística/clima; los precios de granos suelen ser referencia de plaza/fuente nacional salvo que respuesta_base detalle plaza explícita. No inventes que no hay datos para esa zona si sí hay precio en respuesta_base. " +
          "Usá la expresión 'sin dato en base' solo cuando respuesta_base lo diga explícitamente o ese dato no aparezca en respuesta_base ni en datos.precio/datos.dolar según la consulta. " +
          (huecoUnico
            ? ""
            : "Si datos.cultivo está definido y la consulta es precio/venta de ese cultivo sin precio trazable en BD (respuesta_base lo indica), no agregues rangos de otros granos del snapshot como sustituto: papa/horticolas no se reemplazan con soja/maíz/trigo salvo que el usuario pida comparativa o canasta. ") +
          "No inventes pronóstico ni clima local si no viene en clima_pronostico_resumen ni en respuesta_base. " +
          "Mercado físico Argentina (obligatorio en precios granos/datos.precio): nombrá el *tipo de precio* (disponible/mercado físico vs cámara-institucional vs FOB-exportación usando datos.precio.clasificacion_precio o respuesta_base), la referencia legible (datos.precio.fuente_mostrar o plaza equivalente — nunca el único texto 'bd'), moneda/cotización por tn, fecha. Si es FOB/puerto/exportación aclarálos explícitos y no como cobro campo. Consultas tipo 'cuánto vale' sin mencionar exportación: priorizar disponible/mercado físico cuando figure en respuesta_base; FOB sólo línea aparte aclarando que es exportación puerto y no equivale al neto campo. Si datos.precioComplementarioFob existe, incluí esa referencia FOB en una línea separada (no fusionar con el precio disponible) y mantené la aclaración de que no es cobro en campo. Si hay dos tipos concurrentes para el mismo cultivo (precio BD + líneas web_fallback), una frase explicando la no comparabilidad. " +
          "Formato WhatsApp: 1) respuesta breve, 2) datos clave por línea, 3) cierre accionable corto.",
        user: JSON.stringify(payload, null, 2),
      });
      const textoIA = limpiarSalidaIA(String(ia.texto || "").trim());
      const traceExtra = [];
      let pipeline = "base_datos + contexto_ia";
      let mensajeFinal = textoIA || respuestaBase;

      const cultivoGapPrecio = datos?.cultivo || detectarCultivo(pregunta);
      const temasGapPrecio = Array.isArray(datos?.temas) ? datos.temas : detectarTemas(pregunta);
      const gapPrecioCultivoSinCubrir =
        Boolean(cultivoGapPrecio) &&
        (temasGapPrecio.includes("precio") || temasGapPrecio.includes("venta")) &&
        (!hayPrecioTrazable(datos) || (preguntaPideDisponible(pregunta) && precioEsSoloReferenciaNoDisponible(datos?.precio || {}))) &&
        !hayMercadoWebQueAplicaAPregunta(datos, pregunta);

      const forzarGroundingAgro =
        debeForzarGroundingAgroSinHechoEnBd(pregunta, datos, respuestaBase) || gapPrecioCultivoSinCubrir;
      const climaVencido = esConsultaMeteoPorTexto(pregunta) && climaSinPronosticoVigente(datos);
      const debeIntentarGrounding =
        groundingHabilitadoEnConfig() &&
        process.env.GEMINI_API_KEY?.trim() &&
        (deberiaActivarGrounding(pregunta, datos, respuestaBase) ||
          (esConsultaMeteoPorTexto(pregunta) && (!String(climaPronosticoResumen || "").trim() || climaVencido)) ||
          gapPrecioCultivoSinCubrir ||
          forzarGroundingAgro);

      if (debeIntentarGrounding) {
        const maxG = getGroundingMaxChars();
        const temasG = Array.isArray(datos?.temas) ? datos.temas : detectarTemas(pregunta);
        const tnG = normalizar(pregunta);
        const cultivoG = datos?.cultivo || detectarCultivo(pregunta);
        const hayAnclaMercadoOProducto =
          temasG.includes("precio") ||
          temasG.includes("venta") ||
          temasG.includes("dolar") ||
          Boolean(cultivoG) ||
          RE_MERCADO_HORTI_O_FRUTA.test(tnG);
        const sinClimaCtx =
          (contarItemsClima(datos) === 0 || climaVencido) &&
          (temasG.includes("clima") || esConsultaMeteoPorTexto(pregunta)) &&
          !hayAnclaMercadoOProducto;
        const sinDolarCtx = temasG.includes("dolar") && !(Array.isArray(datos?.dolar?.items) && datos.dolar.items.length);
        const pideFuturosG = /(matba|rofex|futuro|carry|backwardation|base|spread)/.test(tnG);
        const gapMercadoPrecio =
          (temasG.includes("precio") || temasG.includes("venta") || Boolean(cultivoG)) &&
          (!hayPrecioTrazable(datos) || (preguntaPideDisponible(pregunta) && precioEsSoloReferenciaNoDisponible(datos?.precio || {}))) &&
          !hayMercadoWebQueAplicaAPregunta(datos, pregunta);
        const sinFuturosWebG =
          pideFuturosG && !(Array.isArray(datos?.webFallback?.futuros) && datos.webFallback.futuros.length);
        const zonaUsuario = [usuario?.partido, usuario?.provincia].filter(Boolean).join(", ") || "Argentina";
        let promptGrounding;
        if (sinClimaCtx) {
          promptGrounding = [
            "Sos asistente agropecuario para productores argentinos.",
            "La base interna no trajo pronóstico trazable para esta consulta.",
            "Usá búsqueda web: SMN, alertas provinciales u otras fuentes confiables para la zona.",
            FORMATO_SALIDA_WHATSAPP_GROUNDING,
            "Máximo 8 líneas. Incluí fecha del pronóstico si consta.",
            "No inventes cifras: si solo hay tendencia cualitativa, decilo.",
            "",
            `Zona aproximada del productor: ${zonaUsuario}.`,
            "Consulta:",
            truncarTexto(pregunta, 400),
            "",
            "Resumen interno AgroHabilis (huecos; no contradecir, solo complementar):",
            truncarTexto(respuestaBase, 900),
          ].join("\n");
        } else if (sinDolarCtx) {
          promptGrounding = [
            "Sos asistente agropecuario para productores argentinos.",
            "La base no trajo cotizaciones de tipo de cambio para esta consulta.",
            "Usá búsqueda web: BCRA, cotización oficial, MEP, CCL, blue u otras referencias recientes en Argentina.",
            FORMATO_SALIDA_WHATSAPP_GROUNDING,
            "Máximo 8 líneas. Incluí fecha de la cotización si la tenés.",
            "",
            "Consulta:",
            truncarTexto(pregunta, 400),
            "",
            "Resumen interno AgroHabilis (no contradecir, solo complementar):",
            truncarTexto(respuestaBase, 900),
          ].join("\n");
        } else if (gapMercadoPrecio || sinFuturosWebG) {
          const lineaCultivoGrounding = cultivoG
            ? `Prioridad absoluta: precio o referencia reciente en Argentina para *${String(cultivoG).toUpperCase()}* (p. ej. MAGYP hortícolas, bolsas, referencias sectoriales). No alcanza con citar solo soja/maíz/trigo si la consulta es otro cultivo.`
            : "Priorizá el cultivo o producto que nombre la consulta.";
          promptGrounding = [
            "Sos asistente agropecuario para productores argentinos.",
            "Usá búsqueda web para datos recientes de mercados agro en Argentina (precios spot, MATBA/Rofex, MAGYP, bolsas) cuando aplique.",
            lineaCultivoGrounding,
            FORMATO_SALIDA_WHATSAPP_GROUNDING,
            "Máximo 8 líneas.",
            "No inventes: si las fuentes discrepan, decilo. Incluí fechas cuando las tengas.",
            "",
            "Consulta:",
            truncarTexto(pregunta, 400),
            "",
            "Resumen interno AgroHabilis (puede estar incompleto; no lo contradigas, solo complementá huecos):",
            truncarTexto(respuestaBase, 900),
          ].join("\n");
        } else {
          promptGrounding = [
            "Sos asistente agropecuario para productores argentinos.",
            "El resumen interno abajo tiene huecos o no alcanza para responder con hechos verificables en base.",
            "Usá búsqueda web para complementar la consulta con información reciente y trazable en Argentina (mercados, normativa MAGYP/BCBA, logística, campo, u otra temática agro acorde al texto).",
            FORMATO_SALIDA_WHATSAPP_GROUNDING,
            "Máximo 8 líneas. Si hay divergencias entre fuentes, decilo. Incluí fechas cuando consten.",
            "",
            "Consulta:",
            truncarTexto(pregunta, 400),
            "",
            "Resumen interno AgroHabilis (no contradecir, solo complementar):",
            truncarTexto(respuestaBase, 900),
          ].join("\n");
        }
        try {
          const g = await generarConGroundingGoogleSearch({
            prompt: promptGrounding,
            contextLabel: "consulta.grounding",
          });
          const textoG = limpiarSalidaIA(String(g.texto || "").trim()).slice(0, maxG);
          const urlsLine = formatearFuentesGroundingWhatsApp(g.urls);
          if (textoG) {
            const cabWeb = ["━━━━━━━━━━━━━━━━━━━━", "🌐 *Complemento web*", "━━━━━━━━━━━━━━━━━━━━"].join("\n");
            mensajeFinal = [mensajeFinal, "", cabWeb, DISCLAIMER_GROUNDING, "", textoG + urlsLine].join("\n");
            pipeline = "base_datos + contexto_ia + grounding_google";
            traceExtra.push({
              stage: "grounding_google_search",
              ok: true,
              model: g.model,
              via: g.via,
              urls: g.urls || [],
              queries: g.queries || [],
            });
          } else if (forzarGroundingAgro) {
            const cabWeb = ["━━━━━━━━━━━━━━━━━━━━", "🌐 *Complemento web*", "━━━━━━━━━━━━━━━━━━━━"].join("\n");
            const stub =
              "⚠️ La búsqueda web no devolvió texto utilizable en este intento (_respuesta vacía_). Podés reintentar en unos minutos.";
            mensajeFinal = [mensajeFinal, "", cabWeb, DISCLAIMER_GROUNDING, "", stub].join("\n");
            pipeline = "base_datos + contexto_ia + grounding_google_vacio";
            traceExtra.push({ stage: "grounding_google_search", ok: false, error: "respuesta_sin_texto" });
          }
        } catch (errG) {
          const errMsg = String(errG?.message || errG);
          console.warn("[consulta.grounding] fallo:", errMsg);
          traceExtra.push({
            stage: "grounding_google_search",
            ok: false,
            error: errMsg,
          });
          if (forzarGroundingAgro) {
            const stub =
              "⚠️ _No se pudo completar la búsqueda web_ (error técnico o cuota). Reintentá más tarde; la *base AgroHabilis* sigue siendo la referencia principal.";
            const cabWeb = ["━━━━━━━━━━━━━━━━━━━━", "🌐 *Complemento web*", "━━━━━━━━━━━━━━━━━━━━"].join("\n");
            mensajeFinal = [mensajeFinal, "", cabWeb, DISCLAIMER_GROUNDING, "", stub].join("\n");
            pipeline = "base_datos + contexto_ia + grounding_google_error";
          }
        }
      }

      const tokensUsados =
        typeof ia?.tokensUsados === "number" && Number.isFinite(ia.tokensUsados) ? ia.tokensUsados : null;
      return {
        mensaje: aplicarLayout("consulta", usuario, { mensaje: mensajeFinal }),
        meta: {
          temas: datos.temas,
          modulosContexto,
          respuestaPipeline: pipeline,
          iaProvider: ia?.providerUsed || null,
          iaProviderTrace: [...(ia?.providerTrace || []), ...traceExtra],
          tokensUsados,
        },
      };
    } catch (_e) {
      const precio = datos.precio ? `Precio ${datos.cultivo}: ${formatearPrecio(datos.precio.precio)}` : null;
      return {
        mensaje: aplicarLayout("consulta", usuario, {
          mensaje: [
            respuestaBase,
            precio,
            "Ahora no pude usar la capa contextual de IA, pero la respuesta base de datos ya está aplicada.",
          ]
            .filter(Boolean)
            .join("\n"),
        }),
        meta: {
          temas: datos.temas,
          modulosContexto,
          respuestaPipeline: "base_datos + fallback_sin_ia",
          iaProvider: null,
          iaProviderTrace: [],
          tokensUsados: null,
        },
      };
    }
  },
};
