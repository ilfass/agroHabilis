"use strict";

const normMin = (texto = "") =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const normSeguimientoCalendario = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

const CULTIVOS_ALIAS = [
  { key: "soja", patrones: ["soja"] },
  { key: "maiz", patrones: ["maiz"] },
  { key: "trigo", patrones: ["trigo"] },
  { key: "girasol", patrones: ["girasol"] },
  { key: "sorgo", patrones: ["sorgo"] },
  { key: "cebada", patrones: ["cebada"] },
  { key: "papa", patrones: ["papa", "patata", "spunta", "kennebec", "innovator"] },
  { key: "yerba_mate", patrones: ["yerba mate", "yerbamate", "yerba"] },
];

const esAfirmacionBreve = (texto = "") => {
  const t = normMin(texto);
  return ["si", "sí", "dale", "ok", "oka", "de acuerdo", "perfecto"].includes(t);
};

const detectarCultivoEnTexto = (texto = "") => {
  const t = normMin(texto);
  for (const item of CULTIVOS_ALIAS) {
    if (item.patrones.some((p) => t.includes(p))) return item.key;
  }
  return null;
};

const patronSqlCultivo = (cultivo = "") => {
  const c = normMin(cultivo);
  if (!c) return "%";
  if (c.includes("maiz")) return "%maiz%";
  if (c.includes("soja")) return "%soja%";
  if (c.includes("trigo")) return "%trigo%";
  if (c.includes("girasol")) return "%girasol%";
  if (c.includes("sorgo")) return "%sorgo%";
  if (c.includes("cebada")) return "%cebada%";
  if (c.includes("papa")) return "%papa%";
  return `%${c}%`;
};

const detectarCultivoConsulta = (
  texto = "",
  cultivosRows = [],
  { parseCultivoFn, preguntaNoCubiertaFn } = {}
) => {
  const parseCultivo = typeof parseCultivoFn === "function" ? parseCultivoFn : (x) => x;
  const preguntaNoCubierta =
    typeof preguntaNoCubiertaFn === "function" ? preguntaNoCubiertaFn : () => false;
  const enTexto = detectarCultivoEnTexto(texto);
  if (enTexto) return enTexto;
  if (preguntaNoCubierta(texto)) return null;
  const t = normMin(texto);
  const cultivos = (cultivosRows || [])
    .map((x) => parseCultivo(x?.cultivo))
    .filter(Boolean);
  if (cultivos.length === 1) return cultivos[0];
  for (const c of cultivos) if (t.includes(normMin(c))) return c;
  return null;
};

const detectarMercadoConsulta = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto);
  if (/rosario|ros\b/.test(t)) return "ros";
  if (/bahia blanca|bahia\b/.test(t)) return "bah";
  if (/necochea/.test(t)) return "neco";
  if (/quequen|quiquen/.test(t)) return "quequen";
  if (/puerto|plaza|mercado/.test(t)) return "__ANY_MARKET__";
  return null;
};

const preguntaNombreProductoNoCubiertaporPerfilUnico = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto);
  if (!t) return false;
  return /\byerba\b|\byerbamate\b|\byerba\s+mate\b/.test(t) || /\btabaco\b/.test(t);
};

const esPreguntaPorQueBreve = (texto = "") => {
  const t = normMin(texto).replace(/[¿?]/g, "");
  return ["porque", "por que", "pero por que", "pero porque"].includes(t);
};

const esDespedidaOEfectoAbiertoSinContenido = (pregunta = "") => {
  const t = normSeguimientoCalendario(pregunta);
  if (!t.length) return true;
  return /^(gracias|muchas gracias|mil gracias|perfecto\b|perfecto\s+entiendo|oki|ok+|listo\b|saludos|nos vemos|chau|hasta luego|hasta maniana|hasta manana)\b/.test(
    t
  );
};

const esDespedidaSimpleNoOperativa = (texto = "") => {
  const t = normSeguimientoCalendario(texto);
  if (!t) return false;
  if (t.length > 40) return false;
  return /^(chau|chao|nos vemos|saludos|hasta luego|hasta maniana|hasta manana|hasta pronto|hasta la proxima)$/.test(
    t
  );
};

const esReclamoFaltaDatosConversacional = (texto = "") => {
  const t = normMin(texto);
  return /(como no tenes datos|como que no tenes datos|por que no tenes datos|no tenes datos para eso|no tenes datos de eso)/.test(
    t
  );
};

const esPedidoOcioNoOperativo = (texto = "") => {
  const t = normMin(texto);
  return /(escuchar una cancion|escuchar cancion|poneme musica|poneme una cancion|reproducir musica|quiero musica)/.test(
    t
  );
};

const esPedidoEstadoCieloConversacional = (texto = "") => {
  const t = normMin(texto);
  return /(ver el sol|hay sol|sale el sol|esta soleado|está soleado|como esta el cielo|cómo está el cielo)/.test(
    t
  );
};

const esConsultaClima = (texto = "") =>
  /clima|helada|lluvia|llover|llueve|lloviendo|llovizn|tormenta|graniz|temporal|temperatura|viento|pron[oó]stico|\bel tiempo\b|humedad|fri[oó]|frialdad|fumigar|pulveriz/i.test(
    String(texto || "")
  );

const esConsultaPoliticaAlertas = (texto = "") => {
  const t = normMin(texto);
  const hablaAlerta = /(alerta|avisame|av[ií]same|avisa|notificaci[oó]n)/.test(t);
  const pideDetalle = /(disponible|rosario|matba|ambas|intradiario|intra|cierre|cierra|tick)/.test(t);
  return hablaAlerta && pideDetalle;
};

const preguntaRequierePipelineConsultaIA = (texto = "") => {
  const t = normMin(texto);
  if (
    /precio|cotizacion|cuanto|cuando\s+esta|esta\s+la|vale|cuesta|mercado|dolar|mep|ccl|blue|clima|lluvia|helada|viento|futuro|matba|rofex|magyp|horticol|relacion|ratio|equivalencia|vs|versus|conviene|vender|esperar|hacienda|novillo|novillos|ternero|feedlot|encierre|sol|cielo|nublado|despejado/.test(
      t
    )
  ) {
    return true;
  }
  return /lim[oó]n|limones|tomate|naranja|mandarina|papa|patata|palta|cebolla|zanahoria|morron|morr[oó]n|pimiento|c[ií]tric|verdura|fruta|hortaliza|yerba mate|yerba|yerbamate|tabaco/.test(
    t
  );
};

const detectarTemaGeneral = (texto = "", cultivoDetectado = null) => {
  if (cultivoDetectado) return cultivoDetectado;
  const t = normMin(texto);
  if (/terner|novill|vaca|vaquillon|hacienda|ganad|invernada|cria|cría/.test(t)) return "hacienda";
  if (/dolar|dólar|mep|blue|ccl|oficial|tipo de cambio/.test(t)) return "tipo de cambio";
  if (/clima|lluvia|helada|viento|temperatura/.test(t)) return "clima";
  if (/insumo|fertiliz|semilla|herbic|glifosato|urea/.test(t)) return "insumos";
  if (/flete|camion|logistica|bahia blanca|rosario/.test(t)) return "fletes";
  if (/gasto|costos|margen|rinde|ha|hectareas|hectáreas|arrendamiento|alquiler|credito|crédito|impuesto/.test(t))
    return "costos";
  return "mercado";
};

const timeoutPromise = (ms, label = "timeout") =>
  new Promise((_, reject) => {
    const t = Math.max(1000, Number(ms) || 20000);
    setTimeout(() => reject(new Error(`${label}: timeout ${t}ms`)), t);
  });

const esConsultaIrrelevanteParaIA = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto);
  if (!t) return true;
  if (t.length <= 8 && /^(ok|dale|listo|gracias|genial|perfecto)$/.test(t)) return true;
  if (/^(hola|buenas|buen dia|buenos dias|chau)$/.test(t)) return true;
  return false;
};

const detectarNivelUsuarioConsulta = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto);
  const scoreTecnico =
    (/(spread|basis|contango|backwardation|relacion|relación|cobertura|matba|rofex|futuro|dic|abr|jul|usd\/tn|%)/.test(t)
      ? 2
      : 0) +
    (/\d/.test(t) ? 1 : 0) +
    (/(compar|vs|versus|brecha|carry|estrateg)/.test(t) ? 1 : 0);
  if (scoreTecnico >= 3) return "TECNICO";
  if (/(precio|mercado|conviene|tendencia|firme|flojo|esperar|vender|comprar|clima|dolar|dólar|insumo)/.test(t)) {
    return "INTERMEDIO";
  }
  return "SIMPLE";
};

const timeoutConsultaTemplateMs = (textoPregunta = "", { esConsultaIrrelevanteParaIAFn } = {}) => {
  const n = Number(process.env.CONSULTA_TEMPLATE_TIMEOUT_MS);
  const base = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 90000) : 35000;
  const esConsultaIrrelevanteParaIA =
    typeof esConsultaIrrelevanteParaIAFn === "function"
      ? esConsultaIrrelevanteParaIAFn
      : (txt) => esConsultaIrrelevanteParaIA(txt, { normMinFn });
  if (esConsultaIrrelevanteParaIA(textoPregunta)) return Math.min(base, 15000);
  return base;
};

const esConsultaEstructuraMercadoFeedlot = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto);
  const pideEstructura =
    /(base|carry|backwardation|matba|rofex|posicion|posición|fob|rosario|camara|cámara|cobertura|spread|paridad|implicito|relacion|fijar|liquidacion|liquidación|usd\/tn)/.test(
      t
    );
  const pideDecision = /(encierre|feedlot|estiro|vendo|salgo|cobertura|decidir)/.test(t);
  const cultivos = /(soja|maiz|maíz)/.test(t);
  const hacienda = /(novillo|ternero|feedlot|encierre|hacienda)/.test(t);
  return (pideEstructura && (cultivos || hacienda)) || (pideDecision && (cultivos || hacienda));
};

const esConsultaInterpretativaIA = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto);
  if (!t) return false;
  if (
    /(me conviene|conviene|debo|que hago|qué hago|vendo|vender|esperar|estrategia|recomendas|recomend[aá]s|opcion|opción)/.test(
      t
    )
  ) {
    return true;
  }
  if (/(relacion|relación|ratio|equivalencia|vs|versus|maiz\/soja|soja\/maiz|ma[ií]z\/novill|novill.*ma[ií]z)/.test(t)) {
    return true;
  }
  if (/\b(esta semana|hoy|en estos dias|en estos días)\b/.test(t) && /(hacienda|novillo|ternero|soja|ma[ií]z|trigo)/.test(t)) {
    return true;
  }
  return false;
};

const CHATBOT_CORE_POLICY = Object.freeze({
  dbFirst: true,
  interpretationNeedsIaBd: true,
  avoidRigidWhenDataIncomplete: true,
  humanizeResponses: true,
});

const debeDerivarAFlujoIaBdPorPolitica = (pregunta = "", { esConsultaInterpretativaIAFn } = {}) => {
  const esConsultaInterpretativaIAImpl =
    typeof esConsultaInterpretativaIAFn === "function"
      ? esConsultaInterpretativaIAFn
      : (texto) => esConsultaInterpretativaIA(texto, { normMinFn });
  return CHATBOT_CORE_POLICY.interpretationNeedsIaBd && esConsultaInterpretativaIAImpl(pregunta);
};

const esPreguntaBloquesPlantillaPlan = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto).replace(/[¿?]/g, "").trim();
  if (t.length < 10 || t.length > 280) return false;
  if (!/\bbloques?\b/.test(t)) return false;
  const tocaPieOPlan =
    /\bactivos?\b/.test(t) ||
    /\bplantilla\b/.test(t) ||
    /\b(7|siete|9|nueve|13|trece)\s+bloques\b/.test(t) ||
    /\bbloques\s+(de\s+)?(la\s+)?plantilla\b/.test(t) ||
    (/\bplan\b/.test(t) && /\bbloques\b/.test(t));
  if (!tocaPieOPlan) return false;
  const esConsultaMeta =
    /(cu[aá]les|cu[aá]l|que|qu[eé]|como|cu[aá]ndo|cu[aá]ntos|donde|por\s*que|porque|para\s*que|significa|significan|refiere|refieren|explic|entend)/.test(
      t
    ) ||
    /(dec[ií]s|decis|contame|cont[aá]me)\b/.test(t) ||
    /\b(no entiendo|informacion|info)\b/.test(t);
  if (!esConsultaMeta) return false;
  if (/\b(sio|nodo\s*portuario|inventario\s+magyp)\b/.test(t) && !/\bplantilla\b/.test(t)) return false;
  return true;
};

const esComentarioSeguimientoMercado = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto).replace(/[¿?]/g, "").trim();
  if (!t) return false;
  if (t.split(/\s+/).length > 6) return false;
  return /(subio|subio un poco|subio algo|subio bastante|subió|bajo|bajó|firme|flojo|estable)/.test(t);
};

const parseDeclaracionHectareas = (texto = "", { parseCultivoFn } = {}) => {
  const parseCultivo = typeof parseCultivoFn === "function" ? parseCultivoFn : (x) => x;
  const m = String(texto || "")
    .trim()
    .match(/^([A-Za-zÁÉÍÓÚáéíóúÑñ]+)\s+(\d+(?:[.,]\d+)?)\s*ha\b/i);
  if (!m) return null;
  const cultivo = parseCultivo(m[1] || "");
  const hectareas = Number(String(m[2] || "").replace(",", "."));
  if (!cultivo || !Number.isFinite(hectareas) || hectareas <= 0) return null;
  return { cultivo, hectareas };
};

const esPedidoAnalisisContextual = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto);
  return /(analizalo|analizarlo|podes analizar|pod[eé]s analizar|analizar\?)/.test(t);
};

const esSolicitudAlertaDirecta = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto);
  const pideAviso = /(avisame|av[ií]same|avisa|me avisas|me avises|alerta|alertame|avisar)/.test(t);
  const tieneUmbral = /\d{3,}/.test(t);
  const tieneActivo = /(novillo|ternero|vaca|vaquillona|hacienda|soja|maiz|trigo|girasol|dolar|blue|mep|oficial)/.test(
    t
  );
  return pideAviso && tieneUmbral && tieneActivo;
};

const esPreguntaConfirmacionAlerta = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto);
  const pideConfirmacion = /(quedo cargad|qued[óo]|confirm|me lo tomaste|me vas a avisar|tengo que hacer algo mas|tengo que hacer algo más|la cargaste o no)/.test(
    t
  );
  const hablaAlerta = /(alerta|avisar|avisame|av[ií]same|novillo|ternero|vaca|vaquillona|precio)/.test(t);
  return pideConfirmacion && hablaAlerta;
};

const ultimaPreguntaFueMetaFecha = (prevQ = "", { normSeguimientoCalendarioFn } = {}) => {
  const norm = typeof normSeguimientoCalendarioFn === "function" ? normSeguimientoCalendarioFn : normSeguimientoCalendario;
  const t = norm(prevQ);
  return (
    /^(que|qu[eé])\s+d[ií]a\s+(es\s+)?(hoy|ahora)\b/.test(t) ||
    /^fecha\s+(de\s+)?hoy\b/.test(t) ||
    /^hoy\s+que\s+d[ií]a\b/.test(t) ||
    /^que\s+fecha\s+(es\s+)?hoy\b/.test(t) ||
    /\bque\s+d[ií]a\s+es\s+hoy\b/.test(t)
  );
};

const botUltimaRespuestaFueMetaFecha = (prevBot = "") => {
  const b = String(prevBot || "");
  return /^\s*Hoy es\s+\*/i.test(b) && /\(Argentina\)/i.test(b);
};

const offsetSeguimientoCalendarioPedido = (pregunta = "", { normSeguimientoCalendarioFn } = {}) => {
  const norm = typeof normSeguimientoCalendarioFn === "function" ? normSeguimientoCalendarioFn : normSeguimientoCalendario;
  const t = norm(pregunta);
  if (/^pasado\s+ma[nñ]ana/.test(t) || /^y\s+pasado(\s+ma[nñ]ana)?$/.test(t)) return 2;
  if (/ma[nñ]ana/.test(t)) return 1;
  return null;
};

const esSeguimientoCalendarioTrasMetaFecha = (pregunta, ultima, { normSeguimientoCalendarioFn } = {}) => {
  const norm =
    typeof normSeguimientoCalendarioFn === "function"
      ? normSeguimientoCalendarioFn
      : normSeguimientoCalendario;
  if (!ultima || !pregunta) return false;
  const prevQ = String(ultima.pregunta || "");
  const prevBot = String(ultima.respuesta || "");
  if (
    !(
      ultimaPreguntaFueMetaFecha(prevQ, { normSeguimientoCalendarioFn: norm }) ||
      botUltimaRespuestaFueMetaFecha(prevBot)
    )
  ) {
    return false;
  }
  const p = norm(pregunta);
  if (p.length > 40) return false;
  return offsetSeguimientoCalendarioPedido(pregunta, { normSeguimientoCalendarioFn: norm }) != null;
};

const esFlujoOnboarding = (texto = "", usuario = null, { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto);
  if (!usuario?.id) return true;
  return /(onboarding|completar perfil|completar mi perfil|crear perfil|alta perfil|mi nombre es|me llamo|quiero registrarme|quiero empezar|arranco onboarding)/.test(
    t
  );
};

const esTurnoCortoSeguimientoTemporal = (pregunta = "", { normSeguimientoCalendarioFn } = {}) => {
  const norm = typeof normSeguimientoCalendarioFn === "function" ? normSeguimientoCalendarioFn : normMin;
  const t = norm(pregunta);
  if (!t || t.length > 56) return false;
  if (/^y\s+pasado(\s+ma[nñ]ana)?$/.test(t)) return true;
  if (/^pasado(\s+ma[nñ]ana)?$/.test(t)) return true;
  if (/^(y\s+)?el\s+pasado(\s+ma[nñ]ana)?$/.test(t)) return true;
  if (/^y\s+ma[nñ]ana$/.test(t)) return true;
  if (/^ma[nñ]ana$/.test(t)) return true;
  return false;
};

const esPreguntaDudaBreveSobreContexto = (pregunta = "", { normSeguimientoCalendarioFn } = {}) => {
  const norm = typeof normSeguimientoCalendarioFn === "function" ? normSeguimientoCalendarioFn : normMin;
  const t = norm(pregunta);
  if (!t || t.length > 80) return false;
  return (
    /^(estas|estás)\s+seguro$/.test(t) ||
    /^seguro$/.test(t) ||
    /^(en\s+)?serio$/.test(t) ||
    /^no\s+me\s+convence$/.test(t) ||
    /^es\s+correcto$/.test(t) ||
    /^me\s+confirmas$/.test(t)
  );
};

const pareceConsultaAutosuficienteNueva = (
  pregunta = "",
  cultivosLista = [],
  { normMinFn, detectarCultivoConsultaFn } = {}
) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const detectarCultivoConsulta =
    typeof detectarCultivoConsultaFn === "function" ? detectarCultivoConsultaFn : () => null;
  const t = norm(String(pregunta || "").trim());
  const raw = String(pregunta || "").trim();
  if (raw.length > 130) return true;
  if (/\d{4,}/.test(raw)) return true;
  if (/\b(mi resumen|mis alertas|ver comandos|completar perfil)\b/i.test(t)) return true;
  if (/\bvend[ií]\b|\bgast[eé]\b|\bcompr[eé]\b/.test(t) && /\d/.test(raw)) return true;
  const cultivo = detectarCultivoConsulta(raw, cultivosLista || []);
  if (cultivo && raw.length > 55) return true;
  if (
    /\b(precio|cotiz|disponible|matba|fob|fas|cotización)\b/.test(t) &&
    /\b(soja|ma[ií]z|trigo|girasol|cebada|papa)\b/.test(t)
  ) {
    return true;
  }
  return false;
};

const clasificarExpansionHiloConversacional = (
  pregunta = "",
  cultivosLista = [],
  ultimasHistCount = 0,
  deps = {}
) => {
  const {
    normSeguimientoCalendarioFn,
    pareceConsultaAutosuficienteNuevaFn,
    esDespedidaOEfectoAbiertoSinContenidoFn,
    esAfirmacionBreveFn,
    esSaludoSocialCortoFn,
    textoParaClasificacionSaludoFn,
    esSaludoSimpleFn,
    esPreguntaAyudaComandosOMenuFn,
    esTurnoCortoSeguimientoTemporalFn,
    esPreguntaDudaBreveSobreContextoFn,
  } = deps;
  const normSeg = typeof normSeguimientoCalendarioFn === "function" ? normSeguimientoCalendarioFn : normMin;
  const pareceConsultaAutosuficienteNuevaImpl =
    typeof pareceConsultaAutosuficienteNuevaFn === "function" ? pareceConsultaAutosuficienteNuevaFn : () => false;
  const esDespedidaOEfectoAbiertoSinContenidoImpl =
    typeof esDespedidaOEfectoAbiertoSinContenidoFn === "function" ? esDespedidaOEfectoAbiertoSinContenidoFn : () => false;
  const esAfirmacionBreveImpl = typeof esAfirmacionBreveFn === "function" ? esAfirmacionBreveFn : () => false;
  const esSaludoSocialCortoImpl = typeof esSaludoSocialCortoFn === "function" ? esSaludoSocialCortoFn : () => false;
  const textoParaClasificacionSaludoImpl =
    typeof textoParaClasificacionSaludoFn === "function" ? textoParaClasificacionSaludoFn : (x) => x;
  const esSaludoSimpleImpl = typeof esSaludoSimpleFn === "function" ? esSaludoSimpleFn : () => false;
  const esPreguntaAyudaComandosOMenuImpl =
    typeof esPreguntaAyudaComandosOMenuFn === "function" ? esPreguntaAyudaComandosOMenuFn : () => false;
  const esTurnoCortoSeguimientoTemporalImpl =
    typeof esTurnoCortoSeguimientoTemporalFn === "function" ? esTurnoCortoSeguimientoTemporalFn : () => false;
  const esPreguntaDudaBreveSobreContextoImpl =
    typeof esPreguntaDudaBreveSobreContextoFn === "function" ? esPreguntaDudaBreveSobreContextoFn : () => false;

  if (!ultimasHistCount) return null;
  const raw = String(pregunta || "").trim();
  if (!raw) return null;
  if (pareceConsultaAutosuficienteNuevaImpl(raw, cultivosLista)) return null;
  if (esDespedidaOEfectoAbiertoSinContenidoImpl(raw)) return null;
  if (esAfirmacionBreveImpl(raw)) return null;
  if (
    esSaludoSocialCortoImpl(textoParaClasificacionSaludoImpl(raw)) ||
    esSaludoSimpleImpl(textoParaClasificacionSaludoImpl(raw))
  ) {
    return null;
  }
  if (esPreguntaAyudaComandosOMenuImpl(raw) || esPreguntaAyudaComandosOMenuImpl(textoParaClasificacionSaludoImpl(raw))) {
    return null;
  }
  const tTrim = raw.trim();
  if (esTurnoCortoSeguimientoTemporalImpl(raw)) return "temporal";
  if (esPreguntaDudaBreveSobreContextoImpl(raw)) return "duda";
  const tNormSeg = normSeg(raw);
  if (tNormSeg.length <= 72 && tTrim.split(/\s+/).filter(Boolean).length <= 12) return "continuacion";
  return null;
};

const esConsultaCoberturaMaiz = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto);
  const tieneMaiz = /\bmaiz\b/.test(t);
  const tieneMatba = /\bmatba\b|\brofex\b|futuro|posicion/.test(t);
  const pideRelacion = /relacion|brecha|vs|versus|conviene|cubri|cubriendo/.test(t);
  const tieneSpotRosario = /disponible/.test(t) && /rosario|\bros\b/.test(t);
  return tieneMaiz && tieneMatba && (pideRelacion || tieneSpotRosario);
};

const esConsultaEstructuraMercado = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto);
  const pideEstructura =
    /(carry|backwardation|contango|basis|base|spread|forward|futuro|matba|rofex|mayo|julio|may|jul)/.test(t);
  const tieneProducto = /(soja|maiz|trigo|girasol|cebada|sorgo)/.test(t);
  return pideEstructura && tieneProducto;
};

const esReclamoConsistenciaMercado = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const t = norm(texto);
  return /(no responde|no me responde|eso no responde|no era eso|no cierra|estan mal|estan mezclad|sin mezclar|misma referencia|misma condicion|mismo dolar|mismo dólar|consistencia)/.test(
    t
  );
};

module.exports = {
  detectarCultivoEnTexto,
  patronSqlCultivo,
  detectarCultivoConsulta,
  detectarMercadoConsulta,
  preguntaNombreProductoNoCubiertaporPerfilUnico,
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
  esConsultaIrrelevanteParaIA,
  timeoutConsultaTemplateMs,
  esConsultaEstructuraMercadoFeedlot,
  esConsultaInterpretativaIA,
  CHATBOT_CORE_POLICY,
  debeDerivarAFlujoIaBdPorPolitica,
  esComentarioSeguimientoMercado,
  esPedidoAnalisisContextual,
  esFlujoOnboarding,
  esPreguntaDudaBreveSobreContexto,
  botUltimaRespuestaFueMetaFecha,
  esSeguimientoCalendarioTrasMetaFecha,
  offsetSeguimientoCalendarioPedido,
  ultimaPreguntaFueMetaFecha,
  esPreguntaBloquesPlantillaPlan,
  esPreguntaConfirmacionAlerta,
  esSolicitudAlertaDirecta,
  esTurnoCortoSeguimientoTemporal,
  clasificarExpansionHiloConversacional,
  pareceConsultaAutosuficienteNueva,
  esConsultaCoberturaMaiz,
  esConsultaEstructuraMercado,
  esReclamoConsistenciaMercado,
  parseDeclaracionHectareas,
  timeoutPromise,
  detectarNivelUsuarioConsulta,
};
