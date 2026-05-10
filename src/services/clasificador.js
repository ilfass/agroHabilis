"use strict";

const { generarChatGroq } = require("./groq");
const { generarTextoClasificadorRapido } = require("./gemini");
const { esConsultaDolarRapida, tieneTemaOperativoSaludo } = require("./intent_classifier");
const { esConsultaInsumos } = require("./consultas/precios");
const { esConsultaHaciendaVenta } = require("./consultas/hacienda");
const { parseIntentInventario } = require("./inventario/nl_heuristica");

const INTENCIONES = new Set([
  "precio",
  "analisis_mercado",
  "analisis_interno",
  "clima",
  "registrar",
  "consulta_registros",
  "agro_general",
  "no_agro",
  "saludo",
  "comando",
]);

/** Orden fijo para el prompt: la IA debe elegir UNA de estas cadenas exactas. */
const ETIQUETAS_INTENCION_PROMPT = [
  "precio",
  "analisis_mercado",
  "analisis_interno",
  "clima",
  "registrar",
  "consulta_registros",
  "agro_general",
  "no_agro",
  "saludo",
  "comando",
];

const norm = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const parsearJSON = (textoBruto = "") => {
  const raw = String(textoBruto || "").trim();
  if (!raw) throw new Error("Clasificador: respuesta vacía");
  const sinFence = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const match = sinFence.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : sinFence;
  const obj = JSON.parse(jsonStr);
  return obj;
};

const defaultsClasificacion = () => ({
  intencion: "agro_general",
  cultivo: null,
  producto: null,
  zona_mencionada: null,
  requiere_datos_propios: false,
  confianza: "baja",
  comandoIa: null,
  variante_precio: null,
  ayuda_recurso: null,
  meta_consulta: null,
});

/**
 * Preferencia: Groq llama-3.1-8b-instant → Gemini Flash → fallo.
 */
const llamarIAClasificador = async (promptCompleto) => {
  const system = [
    "Sos el clasificador de intenciones de AgroHabilis (productores argentinos por WhatsApp).",
    "Leé el mensaje del usuario y elegí UNA sola etiqueta de intención entre las que te lista el usuario en el prompt (vocabulario cerrado).",
    "El valor de intencion debe ser literalmente una de las etiquetas listadas en el user (misma cadena; no un sinónimo).",
    "Respondé EXCLUSIVAMENTE un objeto JSON válido (sin markdown, sin texto antes ni después).",
  ].join(" ");

  if (process.env.GROQ_API_KEY?.trim()) {
    try {
      const { texto } = await generarChatGroq({
        system,
        user: promptCompleto,
        maxTokens: Number(process.env.CLASIFICADOR_MAX_TOKENS || 100),
      });
      return String(texto || "").trim();
    } catch (e) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[clasificador] Groq falló, intentando Gemini:", e.message);
      }
    }
  }

  if (process.env.GEMINI_API_KEY?.trim()) {
    const { texto } = await generarTextoClasificadorRapido(`${system}\n\n${promptCompleto}`);
    return String(texto || "").trim();
  }

  throw new Error("Sin GROQ_API_KEY ni GEMINI_API_KEY para clasificador");
};

/**
 * Misma señal que `nl_heuristica` para inventario: si la IA se confunde (p. ej. clima por un nombre de campo),
 * forzamos `registrar` para que `rutaRegistrar` → inventario resuelva lote/categoría.
 * Incluye **consultas** de stock («cuántas vacas tengo en el caimán»), que antes caían en `agro_general`
 * y la IA inventaba «sin datos en base» sin mirar la tabla de inventario.
 */
const aplicarRefuerzoRegistroInventario = (mensaje, clasificacion) => {
  if (!clasificacion || typeof clasificacion !== "object") return clasificacion;
  try {
    const inv = parseIntentInventario(mensaje);
    if (inv?.clase !== "registro" && inv?.clase !== "consulta") return clasificacion;
    if (inv?.clase === "ambiguo") return clasificacion;
    const mal = new Set([
      "clima",
      "agro_general",
      "analisis_mercado",
      "analisis_interno",
      "no_agro",
      "precio",
      "saludo",
      "consulta_registros",
    ]);
    if (!mal.has(clasificacion.intencion)) return clasificacion;
    return {
      ...clasificacion,
      intencion: "registrar",
      confianza: "alta",
      requiere_datos_propios: false,
    };
  } catch (_e) {
    return clasificacion;
  }
};

const clasificarHeuristica = (mensaje = "") => {
  const t = norm(mensaje);
  const u = String(mensaje || "").toUpperCase().trim();
  const out = defaultsClasificacion();

  if (/^(PAUSAR BOT|ACTIVAR BOT|ESTADO BOT)\s*$/i.test(String(mensaje || "").trim())) {
    out.intencion = "comando";
    out.confianza = "alta";
    return out;
  }

  const comandos = [
    "MI RESUMEN",
    "MIS ALERTAS",
    "MI MARGEN",
    "PLANES",
    "VER COMANDOS",
    "COMPLETAR PERFIL",
  ];
  if (comandos.some((c) => u.includes(c))) {
    out.intencion = "comando";
    out.confianza = "alta";
    return out;
  }

  if (/\b(avisame|av[ií]same|avisar\s+cuando)\b/i.test(t) && /\d/.test(t)) {
    out.intencion = "comando";
    out.confianza = "media";
    return out;
  }

  try {
    const invInv = parseIntentInventario(mensaje);
    if (invInv?.clase === "registro" || invInv?.clase === "consulta") {
      out.intencion = "registrar";
      out.confianza = "alta";
      return out;
    }
  } catch (_e) {
    /* seguimos */
  }

  if (esConsultaDolarRapida(mensaje)) {
    out.intencion = "precio";
    out.variante_precio = "dolar";
    out.confianza = "media";
    return out;
  }
  /** No confundir cotización de insumos con alta de gasto/compra con monto explícito */
  if (
    !/\bcu[aá]nto\s+gast/.test(t) &&
    /\b(gast[eé]|compr[eé])\b/.test(t) &&
    /\d/.test(mensaje)
  ) {
    out.intencion = "registrar";
    out.confianza = "media";
    return out;
  }
  if (esConsultaInsumos(mensaje)) {
    out.intencion = "precio";
    out.producto = "insumo";
    out.confianza = "media";
    return out;
  }
  if (esConsultaHaciendaVenta(mensaje)) {
    out.intencion = "precio";
    out.producto = "hacienda";
    out.confianza = "media";
    return out;
  }

  const saludos = /\b(hola|buen[oa]s?|buen\s+d[ií]a|chau|gracias|muchas\s+gracias)\b/;
  if (saludos.test(t) && t.length < 48 && !/\?/.test(mensaje) && !tieneTemaOperativoSaludo(t)) {
    out.intencion = "saludo";
    out.confianza = "media";
    return out;
  }

  if (/\b(con\s+mis\s+costos|mis\s+costos|me\s+da\s+con\s+mis\s+costos)\b/.test(t)) {
    out.intencion = "analisis_interno";
    out.requiere_datos_propios = true;
    out.confianza = "media";
    return out;
  }

  if (/\b(conviene\s+vender|vender\s+o\s+esperar|debo\s+vender)\b/.test(t)) {
    out.intencion = "analisis_mercado";
    out.confianza = "media";
    return out;
  }

  const consultaPropia =
    /\b(cu[aá]nto\s+gast[eé]|cu[aá]ntos\s+animales|cu[aá]ndo\s+vacun[eé]|mis\s+registros|mi\s+inventario)\b/;
  if (consultaPropia.test(t)) {
    out.intencion = "consulta_registros";
    out.requiere_datos_propios = true;
    out.confianza = "media";
    return out;
  }

  const registro =
    /\b(gast[eé]|compr[eé]|vend[ií]|naci[oó]|vacun[eé]|llovi[oó]|apliqu[eé]|sembr[eé])\b/;
  if (registro.test(t)) {
    out.intencion = "registrar";
    out.confianza = "media";
    return out;
  }

  const clima =
    /\b(lluvia|helada|temperatura|tiempo|pron[oó]stico|clima|llovier|llover|mm\b|mil[ií]metros)\b/;
  if (clima.test(t)) {
    out.intencion = "clima";
    out.confianza = "media";
    return out;
  }

  const precio =
    /\b(precio|cu[aá]nto|vale|está|cotizaci[oó]n|d[oó]lar|soja|ma[ií]z|novillo|trigo|cebada|girasol)\b/;
  if (precio.test(t)) {
    out.intencion = "precio";
    out.confianza = "media";
    return out;
  }

  return out;
};

const normalizarClasificacion = (obj) => {
  const base = defaultsClasificacion();
  if (!obj || typeof obj !== "object") return base;
  let intencion = String(obj.intencion || "agro_general").trim();
  if (!INTENCIONES.has(intencion)) intencion = "agro_general";
  const comandoIa =
    obj.comandoIa && typeof obj.comandoIa === "object" && obj.comandoIa.comando
      ? {
          comando: String(obj.comandoIa.comando || "").trim(),
          parametros:
            typeof obj.comandoIa.parametros === "object" && obj.comandoIa.parametros
              ? { ...obj.comandoIa.parametros }
              : {},
        }
      : null;

  return {
    ...base,
    intencion,
    cultivo: obj.cultivo != null ? String(obj.cultivo).trim() || null : null,
    producto: obj.producto != null ? String(obj.producto).trim() || null : null,
    zona_mencionada: obj.zona_mencionada != null ? String(obj.zona_mencionada).trim() || null : null,
    requiere_datos_propios: Boolean(obj.requiere_datos_propios),
    confianza: ["alta", "media", "baja"].includes(obj.confianza) ? obj.confianza : "media",
    comandoIa,
    variante_precio: obj.variante_precio != null ? String(obj.variante_precio).trim() || null : null,
    ayuda_recurso: obj.ayuda_recurso != null ? String(obj.ayuda_recurso).trim() || null : null,
    meta_consulta: obj.meta_consulta != null ? String(obj.meta_consulta).trim() || null : null,
  };
};

const clasificarMensaje = async (mensaje, usuario) => {
  const listaEtiquetas = ETIQUETAS_INTENCION_PROMPT.map((e, i) => `${i + 1}. \`${e}\``).join("\n");
  const prompt = `
## Tarea
Leé el **MENSAJE** del productor y decidí **cuál de las intenciones de la lista cerrada** describe mejor lo que quiere hacer **en este mensaje**. Tenés que elegir **exactamente una** etiqueta: copiá el identificador tal cual (mismo texto, sin mayúsculas inventadas ni sinónimos).

## Contexto del perfil (solo para ayudarte a decidir)
- Cultivos declarados: ${(usuario?.cultivos || []).map((c) => c.cultivo).join(", ") || "no informados"}
- Tiene datos propios cargados (gastos/ventas/movimientos): ${usuario?.tiene_datos ? "sí" : "no"}

## Lista cerrada de intenciones (elegí UNA; el JSON debe llevar esa misma cadena en \`intencion\`)
${listaEtiquetas}

### Categorías posibles (qué significa cada \`intencion\`)
Usá esta guía para mapear el mensaje a **una** etiqueta de la lista de arriba.

- \`precio\`: quiere saber un **precio o cotización puntual hoy** (soja, maíz, otro grano, dólar/MEP/blue, insumo, novillo u otra hacienda en pie como referencia de mercado, “¿cuánto está…?”).
- \`analisis_mercado\`: quiere **interpretar el mercado** o **decidir** (vender/esperar, tendencia, spread, MATBA, logística comercial, etc.) **sin** apoyarse en “mis costos”, “mis hectáreas” ni datos que solo él tiene cargados.
- \`analisis_interno\`: quiere un análisis que **cruza mercado con sus propios datos del campo** (costos por ha, margen con sus gastos/ventas, “con mis números”, “me da con lo que tengo cargado”, etc.).
- \`clima\`: pregunta sobre **tiempo, lluvia esperada, helada, temperatura, pronóstico** para planificar (futuro o “¿va a llover?”). **No** uses esta etiqueta si en realidad está **registrando** un hecho (ej. “llovió 35 mm”, “puse vacas en el campo el caimán”: eso suele ser \`registrar\`).
- \`registrar\`: quiere **cargar o actualizar un dato nuevo** en el sistema: gasto, venta, animal o inventario, lluvia caída, labor/aplicación/siembra, stock, etc. (verbos tipo: gasté, compré, vendí, registrá, puse, agregué, cargué, nació, vacuné, llovió… con contenido concreto).
- \`consulta_registros\`: quiere **consultar datos que él mismo cargó antes** (cuánto gasté, mis ventas, inventario, animales en total, qué hay en un lote, etc.).
- \`agro_general\`: pregunta de **conocimiento agro** (técnica, cultivo, norma, “qué es el FAS”, épocas de siembra en general, etc.) **sin** pedir precio puntual ni análisis de mercado personalizado ni comando del bot.
- \`no_agro\`: pregunta que **no tiene que ver con el agro** operativo del productor (cultura general, deportes, etc.).
- \`saludo\`: **saludo, despedida o agradecimiento** sin un pedido concreto de datos o acción en el mismo mensaje (o el pedido es trivialmente social).
- \`comando\`: pide ejecutar una **función explícita del bot** (MI RESUMEN, MIS ALERTAS, MI MARGEN, PLANES, VER COMANDOS, “avisame cuando la soja supere X”, etc.).

### Desempates (muy importante)
- Si el mensaje **carga o mueve datos** (cantidades, animales, insumos, lluvia ya caída en mm, “puse X vacas en el campo/lote Y”) → preferí **\`registrar\`** sobre \`clima\` o \`agro_general\`, aunque mencione un nombre que suene a localidad geográfica (puede ser nombre de lote).
- Si pide **pronóstico o “va a llover”** sin estar anotando un hecho pasado → \`clima\`.
- Si encajan dos etiquetas, elegí la **más específica** al acto principal (p. ej. registrar > agro_general).

## MENSAJE a clasificar
"""${String(mensaje || "").replace(/"/g, '\\"')}"""

## Respuesta requerida
Armá el objeto según el **MENSAJE a clasificar** (no copies literal el ejemplo si no aplica). En \`intencion\` poné **una sola** cadena **idéntica** a una de la lista numerada del principio.
Devolvé **solo** el JSON (sin markdown, sin texto fuera del objeto):
{
  "intencion": "precio",
  "cultivo": null,
  "producto": null,
  "zona_mencionada": null,
  "requiere_datos_propios": false,
  "confianza": "media",
  "variante_precio": null
}

Campos extra:
- Si la consulta es **solo** tipo de cambio (sin cultivos/granos en la misma pregunta): \`variante_precio\`: "dolar".
- Si pregunta **insumos** (urea, glifosato, semillas, fertilizantes): \`producto\`: "insumo".
- Si pregunta **hacienda en pie** para precio o decisión de compra/venta: \`producto\`: "hacienda".
`.trim();

  try {
    const raw = await llamarIAClasificador(prompt);
    const c = normalizarClasificacion(parsearJSON(raw));
    return aplicarRefuerzoRegistroInventario(mensaje, c);
  } catch (e) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[clasificador] fallback heurístico:", e.message);
    }
    const c = normalizarClasificacion(clasificarHeuristica(mensaje));
    return aplicarRefuerzoRegistroInventario(mensaje, c);
  }
};

module.exports = {
  clasificarMensaje,
  llamarIAClasificador,
  parsearJSON,
  clasificarHeuristica,
  normalizarClasificacion,
  aplicarRefuerzoRegistroInventario,
  INTENCIONES,
  ETIQUETAS_INTENCION_PROMPT,
};
