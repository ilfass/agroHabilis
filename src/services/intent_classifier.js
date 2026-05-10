const { generarClasificacionIntencion } = require("./gemini");

const normalizarTexto = (texto = "") =>
  String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

/** Registro literal tipo "vendí 120 qq" o "registrá la venta". */
const esRegistroVentaExplicito = (t = "") => {
  if (/^\s*vend[ií]\s+\d/.test(t)) return true;
  if (/\bvend[ií]\s+[\d.,]+\s*(qq|tn|tns|kg|kilos|kgs)\b/.test(t)) return true;
  if (/\bregistr\w*\s+(una\s+)?venta\b/.test(t)) return true;
  if (/^\s*mis ventas\s*$/i.test(String(t || "").trim())) return true;
  return false;
};

const esPreguntaAyudaRegistroVenta = (texto = "") => {
  const t = normalizarTexto(texto);
  if (!t) return false;
  const pideComo =
    /\b(como|c[oó]mo|donde|d[oó]nde)\b.*\b(agrego|agregar|cargo|cargar|registro|registrar|anoto|anotar|declaro|declarar)\b/.test(
      t
    ) || /\b(ayuda|explicame|explic[aá]me|no se|no s[eé])\b.*\b(venta|vend[ií]|factur)\b/.test(t);
  const mencionaVenta = /\b(venta|vend[ií]|vendi|factur|operaci[oó]n)\b/.test(t);
  return pideComo && mencionaVenta && !esRegistroVentaExplicito(t);
};

const esPreguntaAyudaRegistroGasto = (texto = "") => {
  const t = normalizarTexto(texto);
  if (!t) return false;
  if (/\b(gaste|gast[eé]|compre)\s+[\d.,]/i.test(t)) return false;
  const pideComo =
    /\b(como|c[oó]mo|donde|d[oó]nde)\b.*\b(agrego|agregar|cargo|cargar|registro|registrar|anoto|anotar)\b/.test(t) ||
    /\b(ayuda|explicame|explic[aá]me)\b.*\b(gasto|gast[eé])\b/.test(t);
  const mencionaGasto = /\b(gasto|gast[eé]|compra|compre)\b/.test(t);
  return pideComo && mencionaGasto && !/(gaste|gast[eé]|compre|compr[eé])\s+[\d.,]/i.test(t);
};

const esMetaFechaHeuristica = (texto = "") => {
  const t = normalizarTexto(texto).replace(/[¿?]/g, "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 80) return false;
  return (
    /^(que|qu[eé])\s+d[ií]a\s+(es\s+)?(hoy|ahora)\b/.test(t) ||
    /^fecha\s+(de\s+)?hoy\b/.test(t) ||
    /^hoy\s+que\s+d[ií]a\b/.test(t) ||
    /^que\s+fecha\s+(es\s+)?hoy\b/.test(t)
  );
};

const esMetaHoraHeuristica = (texto = "") => {
  const t = normalizarTexto(texto).replace(/[¿?]/g, "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 80) return false;
  return (
    /^(y\s+)?(que|qu[eé])\s+hora\s+es\b/.test(t) ||
    /^hora\s+actual\b/.test(t) ||
    /^decime\s+la\s+hora\b/.test(t) ||
    /^me\s+decis\s+la\s+hora\b/.test(t)
  );
};

const esMensajeRuidoOSinSentido = (texto = "") => {
  const raw = String(texto || "").trim();
  if (!raw) return true;
  if (raw.length > 8) return false;
  if (!/[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]/.test(raw)) return true;
  return false;
};

/** Guerra / conflicto internacional sin ancla operativa agro → no_agro (respuesta breve + web). */
const esActualidadGeopoliticaSinAnclaAgro = (texto = "") => {
  const raw = String(texto || "").trim();
  if (raw.length < 12 || raw.length > 280) return false;
  const t = normalizarTexto(raw);
  if (tieneTemaOperativoSaludo(t)) return false;
  if (
    /\b(soja|ma[ií]z|trigo|girasol|hect[aá]rea|flete|matba|rofex|disponible|acopio|MAGYP|siembra|cosecha|rinde|retenci[oó]n)\b/.test(t)
  ) {
    return false;
  }
  const geo =
    /\b(iran|ir[aá]n|israel|ucrania|rusia|hamas|gaza|oriente\s+medio|medio\s+oriente|estrecho\s+de\s+ormuz|corea|china|eeuu|estados\s+unidos|otan|nato)\b/i.test(
      raw,
    );
  const conflicto =
    /\b(guerra|conflicto|misiles?|misil|invasi[oó]n|ataques?|bombardeo|genocidio|conflicto\s+armado)\b/i.test(t);
  if (geo && conflicto) return true;
  if (
    /\b(termin[oó]|acab[oó]|sigue|empez[oó]|volvi[oó])\b/i.test(t) &&
    /\b(guerra|conflicto)\b/i.test(t) &&
    /\b(iran|ir[aá]n|israel|ucrania|oriente|gaza)\b/i.test(t)
  ) {
    return true;
  }
  return false;
};

/**
 * Pregunta por la lista de comandos del bot / menú / cómo escribir (no consulta de mercado).
 * Si hay cita larga arriba y la última línea es la pregunta, se evalúa esa última parte.
 */
const esPreguntaAyudaComandosOMenu = (textoRaw = "") => {
  let raw = String(textoRaw || "")
    .trim()
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "");
  if (!raw || raw.length > 220) return false;
  const lines = raw.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const last = lines[lines.length - 1].replace(/\s+/g, " ").trim();
    const prev = lines.slice(0, -1).join("\n");
    const prevNorm = normalizarTexto(prev);
    const prevSustancial = prev.length > 48 || tieneTemaOperativoSaludo(prevNorm);
    const lastNorm = normalizarTexto(last);
    if (prevSustancial && last.length <= 120 && !tieneTemaOperativoSaludo(lastNorm)) {
      raw = last;
    }
  }
  const t = normalizarTexto(raw.replace(/\s+/g, " "));
  if (!t || t.length > 180) return false;
  return (
    /\b(qu[eé]|cuales|cuáles)\b.{0,48}\b(comando|comandos|instrucciones)\b/.test(t) ||
    /\b(comando|comandos|menu|menú)\b.{0,48}\b(puedo|podés|podes|usar|uso|hay|existen|sirven|decime|decíme|pasame|pasá|mostra|mostrá|tengo que escribir)\b/.test(t) ||
    /\b(como|c[oó]mo)\b.{0,40}\b(comando|comandos|menu|menú|funciona el bot|usar el bot)\b/.test(t) ||
    /\b(ver|mostrar|listar|pasame|decime|decíme).{0,35}\b(comando|comandos|menu|menú|lista)\b/.test(t) ||
    /\b(ayuda)\b.{0,30}\b(comando|comandos|menu|menú|bot)\b/.test(t) ||
    /\bver\s+comandos\b/.test(t) ||
    /\b(todas|todos)\s+los\s+comandos\b/.test(t)
  );
};

const normalizarTipoIntencion = (raw = "") => {
  const t = normalizarTexto(String(raw || ""));
  const map = {
    saludo: "saludo",
    comando: "comando",
    consulta_libre: "consulta_libre",
    consulta_agro: "consulta_libre",
    consulta: "consulta_libre",
    mercado: "consulta_libre",
    tipo_cambio: "tipo_cambio",
    dolar: "tipo_cambio",
    meta_fecha: "meta_fecha",
    meta_hora: "meta_hora",
    meta: "meta_fecha",
    fecha: "meta_fecha",
    ayuda_uso: "ayuda_uso",
    ayuda: "ayuda_uso",
    uso: "ayuda_uso",
    how_to: "ayuda_uso",
    no_agro: "no_agro",
    fuera_dominio: "no_agro",
    off_topic: "no_agro",
    trivia: "no_agro",
  };
  return map[t] || "consulta_libre";
};

const normalizarRecursoAyuda = (raw = "") => {
  const t = normalizarTexto(String(raw || ""));
  if (/(venta|vend[ií]|factur)/.test(t)) return "venta";
  if (/(gasto|gast[eé]|compra\s+de)/.test(t)) return "gasto";
  if (/(comando|menu|ayuda\s+general)/.test(t)) return "comandos";
  return "otro";
};

const esConsultaMercadoExcluyeRegistroVenta = (texto = "") => {
  const t = normalizarTexto(texto);
  if (!t || esRegistroVentaExplicito(t)) return false;
  if (esPreguntaAyudaRegistroVenta(t)) return true;
  if (t.length < 50) return false;
  const pMercado =
    /\b(soja|ma[ií]z|girasol|trigo|sorgo|cebada|matba|rofex|carry|backwardation|spread|fob|rosario|disponible|futuro|cotizaci[oó]n|usd\s*\/\s*t)\b/.test(
      t
    );
  const pOperativa =
    /\b(conviene vender|me conviene vender|que har[ií]as|qu[eé] har[ií]as|dec[ií]me directo|no me des|mezcl|lectura r[aá]pida|no es comparable|no me cierr|decidir fino)\b/.test(
      t
    );
  return pMercado || pOperativa || t.length > 260;
};

const inferirComandoNatural = (texto = "") => {
  const t = normalizarTexto(texto);
  if (!t) return null;
  if (/(manda|mandame|envi|enviame|pasa).*(resumen)|\bmi resumen\b/.test(t)) return "MI RESUMEN";
  if (/que alertas tengo|mis alertas|alertas activas/.test(t)) return "MIS ALERTAS";
  if (/cuanto gane|cuanto gan[eé]|mi margen|margen del mes|gan[eé] este mes/.test(t)) return "MI MARGEN";
  // Cambio de plan en lenguaje natural (antes que "planes" → MI PLAN; sin matchear solo "¿cuánto sale el plan pro?").
  if (
    /\bquiero\s+plan\s+pro\b/.test(t) ||
    /\bquiero\s+el\s+plan\s+pro\b/.test(t) ||
    /\b(pasar|cambiar|cambio|subir|activar|contratar|suscribirme|suscribir|pasarme|pasame|pasá)\b.*\bplan\s+pro\b/.test(t) ||
    /\bplan\s+pro\b.*\b(pasar|cambiar|cambio|subir|activar|contratar|suscribir)\b/.test(t) ||
    /\b(me\s+)?(pod[eé]s|podes)\s+(pasar|pasarme)\b.*\bplan\s+pro\b/.test(t)
  ) {
    return "QUIERO PLAN PRO";
  }
  if (
    /\bquiero\s+plan\s+b[aá]sico\b/.test(t) ||
    /\bquiero\s+el\s+plan\s+b[aá]sico\b/.test(t) ||
    /\b(pasar|cambiar|cambio|subir|bajar|activar|contratar|suscribirme|suscribir|pasarme|pasame|pasá)\b.*\bplan\s+b[aá]sico\b/.test(t) ||
    /\bplan\s+b[aá]sico\b.*\b(pasar|cambiar|cambio|subir|bajar|activar|contratar|suscribir)\b/.test(t) ||
    /\b(me\s+)?(pod[eé]s|podes)\s+(pasar|pasarme)\b.*\bplan\s+b[aá]sico\b/.test(t)
  ) {
    return "QUIERO PLAN BASICO";
  }
  if (
    /\bquiero\s+plan\s+gratis\b/.test(t) ||
    /\bquiero\s+el\s+plan\s+gratis\b/.test(t) ||
    /\b(pasar|cambiar|cambio|bajar|volver|dar\s+de\s+baja)\b.*\bplan\s+gratis\b/.test(t) ||
    /\bplan\s+gratis\b.*\b(pasar|cambiar|cambio|bajar|volver)\b/.test(t) ||
    /\b(me\s+)?(pod[eé]s|podes)\s+(pasar|pasarme)\b.*\bplan\s+gratis\b/.test(t)
  ) {
    return "QUIERO PLAN GRATIS";
  }
  if (/que planes|planes tienen|planes/.test(t)) return "MI PLAN";
  if (/(ver|mostrar|consultar).*(insumos)|\binsumos\b/.test(t)) return "__INSUMOS__";
  if (/(alerta|avisame|av[ií]same|me avisas|me avises|avisa cuando|avisar cuando|avisar si|avisame si|av[ií]same si|alertame)/.test(t)) return "__ALERTA__";
  if (
    /(quiero desuscribirme|desuscribirme|dar de baja suscripcion|dar de baja suscripción|cancelar suscripcion|cancelar suscripción|cancelar mercado pago|cancelar mp|dar de baja mp)/.test(
      t
    )
  ) {
    return "QUIERO DESUSCRIBIRME";
  }
  if (/editar perfil|modificar perfil|actualizar perfil|completar perfil/.test(t)) return "COMPLETAR PERFIL";
  if (/(agregar|actualizar|modificar).*(zona|zonas|lote|lotes)|quiero agregar zonas/.test(t)) return "__ZONAS__";
  if (/(agregar|sumar|mas|más).*(noticia|noticias)|configurar noticias/.test(t)) return "__NOTICIAS__";
  if (/(vendi|vendi|venta|vender)/.test(t) && /\d/.test(t)) return "__VENTA__";
  if (/(gaste|gaste|compre|compr[eé]|gasto|compra)/.test(t) && /\d/.test(t)) return "__GASTO__";
  if (
    /\b(borrar|eliminar|darme\s+de\s+baja|dar\s+de\s+baja|borrame|eliminame|borrá|eliminá)\b/.test(t) &&
    /\b(mi\s+cuenta|mis\s+datos)\b/.test(t) &&
    !/\bsi\s+borro\s+mis\s+datos\b/.test(t)
  ) {
    return "BORRAR MIS DATOS";
  }
  return null;
};

const sugerirComandoPorTexto = (texto = "") => {
  const t = normalizarTexto(texto);
  if (!t) return null;
  if (/(terner|invernada|hacienda|ganado|cria|cría)/.test(t) && /(conviene|vender|esperar|firme|flojo|precio|cuanto|cuánto)/.test(t)) {
    return null;
  }
  const reglas = [
    { re: /(enviar|mandar|quiero).*(resumen)|mi resumen/, cmd: "MI RESUMEN" },
    { re: /(desuscribirme|cancelar suscrip|dar de baja suscrip|cancelar mp|mercado pago)/, cmd: "QUIERO DESUSCRIBIRME" },
    { re: /(plan pro|pasar a pro|subir plan)/, cmd: "QUIERO PLAN PRO" },
    { re: /(plan basico|plan básico|pasar a basico)/, cmd: "QUIERO PLAN BASICO" },
    { re: /(plan gratis|bajar plan)/, cmd: "QUIERO PLAN GRATIS" },
    { re: /(editar perfil|modificar perfil|actualizar perfil|completar perfil)/, cmd: "COMPLETAR PERFIL" },
    { re: /(zona|zonas|lote|lotes)/, cmd: "MI ZONA <provincia>, <partido>" },
    { re: /(cultivo|cultivos)/, cmd: "MIS CULTIVOS <c1, c2, ...>" },
    { re: /(ganado|hacienda|novillo|ternero|vaca)/, cmd: "MI GANADO <cat1, cat2, ...>" },
    { re: /(alerta|avisame|avísame|avisame si|avísame si|avisar si|me avisas|me avises)/, cmd: "ALERTA ... / AVISAME ..." },
    { re: /(gasto|gastos|compre|compré|gaste|gasté)/, cmd: "MIS GASTOS" },
    { re: /(borrar|eliminar|baja).*(cuenta|mis datos)/, cmd: "BORRAR MIS DATOS" },
    { re: /^\s*(mis ventas|mi venta|listar ventas|resumen de ventas)\s*$/i, cmd: "MIS VENTAS" },
    { re: /(margen|rentabilidad)/, cmd: "MI MARGEN" },
    { re: /(comando|comandos|ayuda|menu)/, cmd: "VER COMANDOS" },
    { re: /(nombre)/, cmd: "MI NOMBRE <nombre>" },
  ];
  const hit = reglas.find((r) => r.re.test(t));
  if (!hit) return null;
  return `Detecté una intención de comando.\n👉 Probá con: *${hit.cmd}*\nSi querés ver todos los comandos, escribí: *VER COMANDOS*`;
};

const resolverComandoAlias = (comando = "") => {
  if (
    /^QUIERO DESUSCRIBIRME$/.test(comando) ||
    /^CANCELAR SUSCRIPCION$/.test(comando) ||
    /^CANCELAR SUSCRIPCIÓN$/.test(comando) ||
    /^DAR DE BAJA SUSCRIPCION$/.test(comando) ||
    /^DAR DE BAJA SUSCRIPCIÓN$/.test(comando)
  ) {
    return "QUIERO PLAN GRATIS";
  }
  if (comando === "MI PERFIL" || comando === "MÍ PERFIL") return "VER MI PERFIL";
  if (/^CUALES SON MIS PRODUCTOS$|^CUALES SON MIS CULTIVOS$|^MIS PRODUCTOS$/.test(comando)) {
    return "VER MI PERFIL";
  }
  return comando;
};

/** Evita tomar como saludo mensajes que ya piden mercado, clima, finanzas, etc. */
const tieneTemaOperativoSaludo = (tNorm = "") =>
  /\b(soja|ma[ií]z|trigo|girasol|sorgo|cebada|precio|precios|cotiz|mercado|flete|fletes|d[oó]lar|blue|mep|ccl|matba|rofex|fob|disponible|futuro|futuros|cotizaci[oó]n|usd\s*\/\s*t|tn\b|\bqq\b|tonelad|hect[aá]rea|\bha\b|venta|vend[ií]|vendi|clima|lluvia|helada|pron[oó]stico|hacienda|novillo|terner|invernada|ganado|sembr|siembra|barbecho|rinde|rindes|u\$s|\b(usd|ars)\b|cultivo|insumo|glifosato|urea|fertiliz|log[ií]stica|acopio|silobolsa)\b/.test(
    tNorm
  );

/**
 * Consulta solo de tipo de cambio (sin cultivos ni estructura de mercado).
 * Debe ir antes que heurísticas de saludo: "buenas, ¿cuánto está el dólar?" no es saludo.
 */
const esConsultaDolarRapida = (texto = "") => {
  const raw = String(texto || "").trim();
  if (!raw || raw.length > 160) return false;
  const t = normalizarTexto(raw);
  if (
    !/\b(dolar|tipo\s+de\s+cambio|cotizacion\s+del\s+dolar|blue|mep|ccl|oficial|divisa)\b/.test(t)
  ) {
    return false;
  }
  if (
    /\b(soja|ma[ií]z|trigo|girasol|cebada|sorgo|triticale|hect[aá]rea|\bha\b|flete|matba|rofex|fob|disponible|futuro|barbecho)\b/.test(
      t
    )
  ) {
    return false;
  }
  return true;
};

/**
 * Patrones genéricos de cultura general / geografía sin ancla operativa agro (no listar países).
 * Si el clasificador devuelve consulta_libre por error, se corrige a no_agro.
 */
const esProbableConocimientoGeneralSinAgro = (texto = "") => {
  const raw = String(texto || "").trim();
  if (!raw || raw.length < 12 || raw.length > 260) return false;
  const t = normalizarTexto(raw);
  if (tieneTemaOperativoSaludo(t)) return false;
  if (
    /\b(soja|ma[ií]z|trigo|girasol|sorgo|cebada|hect[aá]rea|\bha\b|flete|matba|rofex|magyp|ganad|hacienda|novillo|terner|feedlot|siembra|cosecha|insumo|urea|fertiliz|campo|lote|acopio|silobolsa|picad|boleta|disponible|exportaci[oó]n|importaci[oó]n|retenci[oó]n)\b/.test(
      t
    )
  ) {
    return false;
  }
  if (/\bcapital\s+de\s+(valores|riesgo|mercado|trabajo|humano|giro|mexico\s+como\s+importador)\b/.test(t)) {
    return false;
  }
  if (/(^|\b)(cual|cu[aá]l)\s+es\s+la\s+capital(\s+de)?\b/.test(t)) return true;
  if (/\bcapital\s+de\s+[a-záéíóúñ.\s-]{2,48}\??$/i.test(t.replace(/\s+/g, " ").trim())) return true;
  if (/\b(cuantos habitantes|cu[aá]ntos habitantes|poblaci[oó]n\s+de)\b/.test(t)) return true;
  if (/\b(en\s+que\s+continente|en\s+qu[eé]\s+continente|continente\s+de)\b/.test(t)) return true;
  return false;
};

/** Frases de apertura sin tema agro; mensaje corto y sin ambigüedad. */
const esFrasePuenteConsulta = (texto = "") => {
  const compact = String(texto || "")
    .trim()
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ");
  if (!compact || compact.length > 80) return false;
  if (/\d/.test(compact)) return false;
  const t = normalizarTexto(compact)
    .replace(/[¿?¡!.,;:]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || tieneTemaOperativoSaludo(t)) return false;
  if (t.split(/\s+/).length > 10) return false;
  return (
    /^tengo\s+una\s+(consulta|duda)$/.test(t) ||
    /^queria\s+preguntar(te)?$/.test(t) ||
    /^queria\s+hacerte\s+una\s+(consulta|pregunta)$/.test(t) ||
    /^puedo\s+hacerte\s+una\s+pregunta$/.test(t) ||
    /^te\s+hago\s+una\s+consulta$/.test(t) ||
    /^solo\s+te\s+consulto$/.test(t)
  );
};

/**
 * Intención clara sin llamar a Gemini (saludar, TC solo, menú, fecha, puente).
 * Orden: ayuda menú → meta fecha → dólar (antes que saludo por "buenas, el dólar…") → saludo/puente.
 */
const intencionHeuristicaRapidaSinGemini = (input = "") => {
  const t = String(input || "").trim();
  if (!t) return null;
  if (esMensajeRuidoOSinSentido(t)) {
    return { tipo: "mensaje_ruido", comando: null, parametros: {} };
  }
  if (esPreguntaAyudaComandosOMenu(t)) {
    return { tipo: "ayuda_uso", comando: null, parametros: { recurso: "comandos" } };
  }
  if (esMetaHoraHeuristica(t)) {
    return { tipo: "meta_hora", comando: null, parametros: {} };
  }
  if (esMetaFechaHeuristica(t)) {
    return { tipo: "meta_fecha", comando: null, parametros: {} };
  }
  if (esActualidadGeopoliticaSinAnclaAgro(t)) {
    return { tipo: "no_agro", comando: null, parametros: {} };
  }
  if (esConsultaDolarRapida(t)) {
    return { tipo: "tipo_cambio", comando: null, parametros: {} };
  }
  const hint = textoParaClasificacionSaludo(t);
  if (esSaludoSocialCorto(hint) || esFrasePuenteConsulta(hint)) {
    return { tipo: "saludo", comando: null, parametros: { saludo_heuristica: true } };
  }
  return null;
};

/**
 * Saludo o cortesía muy corta, opcionalmente con nombre ("Hola Roberto").
 * No reemplaza consultas con datos: si hay números o palabras de mercado, false.
 */
const esSaludoSocialCorto = (texto = "") => {
  const compact = String(texto || "")
    .trim()
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ");
  if (!compact || compact.length > 96) return false;
  if (/\d/.test(compact)) return false;
  const t = normalizarTexto(compact).replace(/[!?¡¿.,;:]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t || tieneTemaOperativoSaludo(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 10) return false;
  if (/^(hola|buenas|buenas tardes|buenas noches|hey|ei|ey|che)\b/.test(t)) return true;
  if (/^(buen(os)?\s+d[ií]as?|muy\s+buen(os)?\s+d[ií]as?|buen\s+d[ií]a)\b/.test(t)) return true;
  // "Cómo te va" y typos frecuentes ("re" por "te"); debe ir antes que solo "como va".
  if (
    /^(que tal|qu[eé] tal|c[oó]mo\s+(te|re|le|les)\s+va|como va|c[oó]mo va|como andas|c[oó]mo and[aá]s|como estas|c[oó]mo est[aá]s)\b/.test(
      t
    )
  ) {
    return true;
  }
  return false;
};

/**
 * WhatsApp suele mandar el mensaje citado + la línea nueva del usuario.
 * Si la última línea es solo saludo y lo anterior es largo o tiene tema operativo, clasificamos solo esa última parte.
 */
const textoParaClasificacionSaludo = (textoRaw = "") => {
  const raw = String(textoRaw || "")
    .trim()
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "");
  if (!raw) return raw;
  const compact = raw.replace(/\s+/g, " ").trim();
  if (esSaludoSocialCorto(compact)) return compact;
  const lines = raw.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return compact;
  const last = lines[lines.length - 1].replace(/\s+/g, " ").trim();
  const prev = lines.slice(0, -1).join("\n");
  const prevNorm = normalizarTexto(prev);
  const lastNorm = normalizarTexto(last);
  const prevSustancial = prev.length > 48 || tieneTemaOperativoSaludo(prevNorm);
  if (prevSustancial && esSaludoSocialCorto(last) && !tieneTemaOperativoSaludo(lastNorm)) {
    return last.replace(/\s+/g, " ").trim();
  }
  return compact;
};

const detectarIntencionIA = async (texto = "") => {
  const input = String(texto || "").trim();
  if (!input) return { tipo: "consulta_libre", comando: null, parametros: {} };
  const rapida = intencionHeuristicaRapidaSinGemini(input);
  if (rapida) return rapida;
  const inputEfectivo = textoParaClasificacionSaludo(input);
  try {
    const system = [
      "Clasificá intención de mensaje WhatsApp (productor agro, Argentina) en JSON estricto.",
      "Responder SOLO JSON válido sin texto extra.",
      "Schema:",
      '{"tipo":"saludo|meta_fecha|ayuda_uso|tipo_cambio|no_agro|comando|consulta_libre","comando":"MI_RESUMEN|MIS_ALERTAS|MI_MARGEN|CREAR_ALERTA|REGISTRAR_GASTO|REGISTRAR_VENTA|ANALIZAR_CULTIVO|PLANES|null","parametros":{"cultivo":null,"valor":null,"recurso":null}}',
      "tipo:",
      "- saludo: interacción social o cortesía (saludar, preguntar cómo estás, desear buen día, charla breve sin pedido). Incluye errores de tipeo, abreviaturas y oralidad si NO hay pedido explícito de datos agro (precio, cultivo, clima, MATBA, dólar, logística, hectáreas, venta, comandos).",
      "- Si además de cortesía pide precio, clima, futuros, logística o cualquier dato operativo → consulta_libre (no saludo).",
      "- meta_fecha: pregunta por el día/fecha de hoy o 'qué día es', sin pedir precios ni mercado.",
      "- tipo_cambio: SOLO cotización del dólar/tipo de cambio (oficial, blue, MEP, CCL) sin mezclar con precios de granos ni cultivos.",
      "- no_agro: conocimiento general o curiosidad SIN ancla al negocio agropecuario argentino operativo (no pide precio de granos, clima de campo, logística de cosecha, MAGYP, MATBA, hacienda, insumos, normativa sectorial ni decisión de venta). Incluye geografía/enciclopedia (p. ej. capital de un país, población, continentes), astronomía recreativa, deportes, historia no ligada al campo, tecnología de consumo. Mencionar otro país (México, Brasil, etc.) por sí solo NO es consulta agro: solo es consulta_libre si pide datos de mercado, logística o política comercial explícitos.",
      "- NO usar no_agro si hay cultivo, precio, clima operativo, flete, dólar para operar, ganado, hectáreas, 'me conviene', exportación/importación de granos, ni onboarding de datos productivos.",
      "- Ante duda entre no_agro y consulta_libre en preguntas de cultura general o geografía sin esos anclas → preferir no_agro.",
      "- ayuda_uso: quiere saber CÓMO usar el bot (registrar venta/gasto, comandos, dónde cargar datos). Sin números de operación para registrar.",
      "- ayuda_uso recurso comandos: 'qué comando puedo usar', 'lista de comandos', 'cómo se usa el bot', 'menú', 'ver comandos', 'qué escribo acá' (sin pedir precio de un cultivo).",
      "- comando: quiere ejecutar un comando explícito o equivalente claro (resumen, alertas, margen, etc.).",
      "- consulta_libre: consulta de precios, clima, decisión de venta, MATBA, logística, u otro tema agro con datos.",
      "parametros.recurso (solo si tipo=ayuda_uso): 'venta'|'gasto'|'comandos'|'otro'.",
      "Si no encaja nada, usar consulta_libre.",
      "REGISTRAR_VENTA: SOLO si anota una venta concreta (montos/cantidades explícitos). NO para 'cómo agrego' ni 'dónde cargo'.",
      "NUNCA REGISTRAR_VENTA si solo pregunta si conviene vender, análisis de mercado, MATBA, spread, carry, FOB, Rosario, o mezcla de fuentes.",
    ].join("\n");
    const user = `Mensaje: ${inputEfectivo}`;
    const out = await generarClasificacionIntencion({ system, user });
    const raw = String(out?.texto || "").trim();
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    const sliced = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw;
    const parsed = JSON.parse(sliced);
    let tipo = normalizarTipoIntencion(parsed?.tipo);
    let comando = parsed?.comando || null;
    let parametros = typeof parsed?.parametros === "object" && parsed?.parametros ? { ...parsed.parametros } : {};
    if (tipo === "comando" && !comando) tipo = "consulta_libre";
    if (
      tipo === "ayuda_uso" ||
      tipo === "meta_fecha" ||
      tipo === "meta_hora" ||
      tipo === "mensaje_ruido" ||
      tipo === "saludo" ||
      tipo === "tipo_cambio" ||
      tipo === "no_agro"
    )
      comando = null;
    if (comando === "REGISTRAR_VENTA" && (esConsultaMercadoExcluyeRegistroVenta(input) || esPreguntaAyudaRegistroVenta(input))) {
      tipo = "consulta_libre";
      comando = null;
    }
    if (tipo === "consulta_libre" && esConsultaDolarRapida(input)) {
      tipo = "tipo_cambio";
      comando = null;
      parametros = {};
    }
    if (tipo === "consulta_libre" && esFrasePuenteConsulta(inputEfectivo)) {
      tipo = "saludo";
      comando = null;
      parametros = { saludo_heuristica: true };
    }
    if (tipo === "consulta_libre" && esSaludoSocialCorto(inputEfectivo)) {
      tipo = "saludo";
      comando = null;
      parametros = { saludo_heuristica: true };
    }
    if (tipo === "consulta_libre" && esPreguntaAyudaComandosOMenu(input)) {
      tipo = "ayuda_uso";
      comando = null;
      parametros = { recurso: "comandos" };
    }
    if (tipo === "consulta_libre" && esProbableConocimientoGeneralSinAgro(input)) {
      tipo = "no_agro";
      comando = null;
      parametros = {};
    }
    if (tipo === "consulta_libre" && esActualidadGeopoliticaSinAnclaAgro(input)) {
      tipo = "no_agro";
      comando = null;
      parametros = {};
    }
    if (tipo === "ayuda_uso") {
      parametros.recurso = normalizarRecursoAyuda(parametros.recurso || parametros.tema || "");
    }
    return { tipo, comando, parametros };
  } catch (_e) {
    const rapidaCatch = intencionHeuristicaRapidaSinGemini(input);
    if (rapidaCatch) return rapidaCatch;
    if (esPreguntaAyudaRegistroVenta(input)) {
      return { tipo: "ayuda_uso", comando: null, parametros: { recurso: "venta" } };
    }
    if (esPreguntaAyudaRegistroGasto(input)) {
      return { tipo: "ayuda_uso", comando: null, parametros: { recurso: "gasto" } };
    }
    const heur = inferirComandoNatural(input);
    if (heur === "MI RESUMEN") return { tipo: "comando", comando: "MI_RESUMEN", parametros: {} };
    if (heur === "MIS ALERTAS") return { tipo: "comando", comando: "MIS_ALERTAS", parametros: {} };
    if (heur === "MI MARGEN") return { tipo: "comando", comando: "MI_MARGEN", parametros: {} };
    if (heur === "MI PLAN") return { tipo: "comando", comando: "PLANES", parametros: {} };
    if (heur === "__ALERTA__") return { tipo: "comando", comando: "CREAR_ALERTA", parametros: {} };
    if (heur === "__GASTO__") return { tipo: "comando", comando: "REGISTRAR_GASTO", parametros: {} };
    if (heur === "__VENTA__") {
      if (esConsultaMercadoExcluyeRegistroVenta(input)) {
        return { tipo: "consulta_libre", comando: null, parametros: {} };
      }
      return { tipo: "comando", comando: "REGISTRAR_VENTA", parametros: {} };
    }
    const compact = inputEfectivo.replace(/\s+/g, " ").trim();
    if (esSaludoSocialCorto(compact) || esFrasePuenteConsulta(compact)) {
      return { tipo: "saludo", comando: null, parametros: { saludo_heuristica: true } };
    }
    if (esProbableConocimientoGeneralSinAgro(input)) {
      return { tipo: "no_agro", comando: null, parametros: {} };
    }
    if (esActualidadGeopoliticaSinAnclaAgro(input)) {
      return { tipo: "no_agro", comando: null, parametros: {} };
    }
    return { tipo: "consulta_libre", comando: null, parametros: {} };
  }
};

module.exports = {
  normalizarTexto,
  inferirComandoNatural,
  sugerirComandoPorTexto,
  resolverComandoAlias,
  detectarIntencionIA,
  esSaludoSocialCorto,
  textoParaClasificacionSaludo,
  esConsultaMercadoExcluyeRegistroVenta,
  esPreguntaAyudaRegistroVenta,
  esPreguntaAyudaRegistroGasto,
  esMetaFechaHeuristica,
  esMetaHoraHeuristica,
  esPreguntaAyudaComandosOMenu,
  esConsultaDolarRapida,
  esFrasePuenteConsulta,
  esProbableConocimientoGeneralSinAgro,
  esMensajeRuidoOSinSentido,
  intencionHeuristicaRapidaSinGemini,
};
