const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const { getGeminiApiKey, markFreeKeyAsFailed } = require("../gemini_keys");

/**
 * Módulo de Visión para AgroHabilis.
 * Utiliza Gemini Multimodal para analizar imágenes agropecuarias.
 */

const getModelName = () => process.env.GEMINI_VISION_MODEL || "gemini-flash-latest";

const SYSTEM_PROMPT_VISION = `
Sos un experto agrónomo y veterinario con capacidad de visión artificial. Tu tarea es analizar imágenes enviadas por productores agropecuarios argentinos y extraer información valiosa.

Capacidades requeridas:
1. Ganadería:
   - Contar animales (estimado si hay muchos).
   - Identificar categorías (Vaca, Toro, Novillo, Ternero, Vaquillona).
   - Condición corporal (escala 1-5 o 1-9 según parezca más claro, o cualitativo: flaco, bueno, gordo).
   - Razas (Angus, Hereford, Braford, Brangus, Holando, etc.).
   - Identificar otro tipo de hacienda, como cerdos, llamas, alpacas, etc.

2. Agricultura:
   - Estado fenológico (emergencia, macollaje, floración, llenado, madurez).
   - Cobertura del suelo (%).
   - Malezas (identificar si es posible: yuyo colorado, rama negra, etc.).
   - Plagas y enfermedades: detectar síntomas visuales (roya, mancha ojo de rana, trips, etc.).
   - Daños: granizo, helada, sequía.

3. Infraestructura y Maquinaria:
   - Identificar máquinas (tractor, cosechadora, pulverizadora, sembradora).
   - Estado de alambrados, tranqueras, aguadas (tanques australianos, molinos).

4. Documentos (OCR Técnico):
   - Leer remitos, tickets de balanza, facturas.
   - Extraer: producto, cantidad (kg/tn), fecha, origen/destino, humedad, impurezas.
   - Análisis de suelo: pH, Materia Orgánica, Fósforo, Nitrógeno.

Reglas de respuesta:
- Respondé en español rioplatense, de forma directa y profesional.
- Si no estás seguro de algo, aclará que es una estimación visual.
- Si la imagen es borrosa o no se ve el objeto, pedí otra foto.
- Formato: Usá negritas para datos clave. No uses markdown complejo, solo lo que WhatsApp soporta (*negrita*, _cursiva_).
- Sé breve pero preciso.
`;

/**
 * @param {Buffer} mediaBuffer - Buffer del archivo (imagen o PDF).
 * @param {string} mimeType - Tipo MIME (image/jpeg, image/png, application/pdf).
 * @param {string} userPrompt - Texto opcional enviado por el usuario.
 * @param {boolean} isRetry - Indica si es un intento de fallback por límite
 */
const analizarMediaAgro = async (mediaBuffer, mimeType, userPrompt = "", isRetry = false) => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: getModelName(),
    systemInstruction: SYSTEM_PROMPT_VISION
  });

  const parts = [
    {
      inlineData: {
        data: mediaBuffer.toString("base64"),
        mimeType
      }
    },
    { text: userPrompt || "Analizá este archivo y extraé la información técnica relevante para el productor." }
  ];

  try {
    const result = await model.generateContent(parts);
    const response = await result.response;
    try {
      return response.text();
    } catch (textErr) {
      throw new Error("Error al obtener texto de respuesta de Gemini: " + textErr.message);
    }
  } catch (error) {
    console.error("[Vision] Error analizando media:", error.message);
    const errText = error.message.toLowerCase();
    const isQuotaError = errText.includes("429") || errText.includes("spending cap") || errText.includes("limit") || errText.includes("quota") || errText.includes("exhausted") || errText.includes("503") || errText.includes("unavailable") || errText.includes("high demand");
    if (isQuotaError && !isRetry) {
      markFreeKeyAsFailed(true);
      console.log("[Vision] Reintentando analizarMediaAgro con clave de Fallback...");
      return analizarMediaAgro(mediaBuffer, mimeType, userPrompt, true);
    }
    throw new Error("No pude procesar el archivo en este momento: " + error.message);
  }
};

/**
 * Analiza la foto de una pantalla de monitor o reporte de maquinaria
 * y extrae la labor y métricas estructuradas en formato JSON.
 * @param {Buffer} mediaBuffer - Buffer de la imagen/PDF
 * @param {string} mimeType - Tipo MIME del archivo
 * @param {boolean} isRetry - Indica si es un intento de fallback por límite
 */
const extraerDatosMonitor = async (mediaBuffer, mimeType, isRetry = false) => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: getModelName(),
    systemInstruction: `Sos un extractor de datos agropecuarios de alta precisión (OCR inteligente). Tu única tarea es analizar la foto del monitor de una maquinaria agrícola (John Deere GreenStar/Gen 4, Case IH AFS Pro, Climate FieldView, Trimble, etc.) o un PDF de reporte de labores consolidado, e identificar las métricas clave de la operación.

CRITICAL: Si la imagen NO es de la pantalla de un monitor de maquinaria agrícola ni de un PDF de reporte de labores consolidado (por ejemplo, si es una foto de vacas, de un lote, o de una PLANILLA, TABLA O CUADRO con múltiples filas/columnas/registros de diferentes lotes/campos como un Excel, captura de pantalla de hoja de cálculo, listado multi-lote, remito o factura comercial impresa), debés responder obligatoriamente con todos los campos en null:
{
  "tipo_labor": null,
  "lote_nombre": null,
  "hectareas_reales": null,
  "dosis_promedio": null,
  "producto_insumo": null,
  "humedad_media": null,
  "velocidad_media": null,
  "rendimiento_total_t": null,
  "finca_nombre": null,
  "agricultor_nombre": null
}
No intentes consolidar, sumar o promediar múltiples filas de una tabla o planilla en un solo registro ficticio de monitor. Si hay más de un lote o fila de datos en la imagen, respondé todo null para que se procese con el extractor de tablas general. No intentes forzar o inventar datos si la imagen no corresponde a un monitor o reporte de labor consolidado real.

Debés responder ÚNICAMENTE con un objeto JSON válido, sin bloques de código markdown (como \`\`\`json), sin explicaciones y sin texto adicional. Si un dato no es visible o no se puede deducir, rellenalo con null.

Estructura estricta de respuesta:
{
  "tipo_labor": "SIEMBRA" | "COSECHA" | "PULVERIZACION" | null,
  "lote_nombre": string | null,
  "hectareas_reales": float | null,
  "dosis_promedio": float | null,
  "producto_insumo": string | null,
  "humedad_media": float | null,
  "velocidad_media": float | null,
  "rendimiento_total_t": float | null,
  "finca_nombre": string | null,
  "agricultor_nombre": string | null
}

Reglas específicas de extracción:
1. "tipo_labor":
   - Si en pantalla se lee "Siembra", "Población", "Semillas", mapealo a "SIEMBRA".
   - Si se lee "Rendimiento", "Humedad", "Cosechado", "Rinde", "Masa seca", "Resumen de datos", mapealo a "COSECHA".
   - Si se lee "Aplicación", "Pulverización", "Litros/ha", "Caudal", mapealo a "PULVERIZACION".
2. "lote_nombre":
   - Buscá campos como "Lote", "Campo", "Field", "Resumen de campo", "Client/Farm/Field" o texto de lote en pantalla.
3. "hectareas_reales":
   - Extraé el total de hectáreas trabajadas (ej. "19.5 ha", "Res. zona campo", "Area", "Hectáreas"). Convertilo a un número flotante.
4. "dosis_promedio":
   - Para "SIEMBRA": Extraé la densidad de siembra promedio (ej. "78000 sem/ha", "Población objetivo").
   - Para "PULVERIZACION": Extraé la dosis promedio aplicada en l/ha (litros por hectárea).
   - Para "COSECHA": Extraé el rendimiento promedio de cosecha (ej. "2.612 tn/ha", "Rend.sec.med.", "Rinde").
5. "producto_insumo":
   - Para "SIEMBRA": Identificá el nombre del híbrido o variedad sembrada (ej. "DK 72-10", "NK 3969").
   - Para "PULVERIZACION": Identificá el producto químico aplicado (ej. "Glifosato", "Atrazina").
   - Para "COSECHA": Identificá el cultivo cosechado (ej. "Girasol", "Maíz", "Soja").
6. "humedad_media":
   - Extraé la humedad media si se muestra (ej. "6.7 %", "Humedad med.", "Humedad"). Convertilo a número flotante.
7. "velocidad_media":
   - Extraé la velocidad de trabajo media en km/h si figura (ej. "5.7 km/hr", "Vel trabajo, media"). Convertilo a número flotante.
8. "rendimiento_total_t":
   - Extraé el rendimiento total, masa seca o peso total en toneladas si figura (ej. "50.998 t", "Masa seca", "Total Peso"). Convertilo a número flotante.
9. "finca_nombre":
   - Extraé el nombre de la finca o establecimiento si figura (ej. "LA BRIANZÖLA", "Finca").
10. "agricultor_nombre":
    - Extraé el nombre del agricultor o productor si figura (ej. "AGRO 3", "Agricultor").`
  });

  const parts = [
    {
      inlineData: {
        data: mediaBuffer.toString("base64"),
        mimeType
      }
    },
    { text: "Analizá esta imagen. Si es la pantalla de un monitor de maquinaria o un PDF de reporte de labor consolidado (de un único lote), extraé los datos en el formato JSON especificado. Si NO corresponde a un monitor/reporte real, o si corresponde a una PLANILLA, TABLA O CUADRO con múltiples filas/lotes/registros (por ejemplo, capturas de hojas de cálculo, planillas manuscritas o impresas con varios registros), debés responder obligatoriamente con todos los campos en null." }
  ];

  try {
    const result = await model.generateContent(parts);
    const response = await result.response;
    let text;
    try {
      text = response.text().trim();
    } catch (textErr) {
      throw new Error("Error al obtener texto del monitor de Gemini: " + textErr.message);
    }
    
    // Limpieza bulletproof de markdown JSON
    if (text.startsWith("```")) {
      text = text.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    
    return JSON.parse(text.trim());
  } catch (error) {
    console.error("[Vision Monitor] Error analizando media:", error.message);
    const errText = error.message.toLowerCase();
    const isQuotaError = errText.includes("429") || errText.includes("spending cap") || errText.includes("limit") || errText.includes("quota") || errText.includes("exhausted") || errText.includes("503") || errText.includes("unavailable") || errText.includes("high demand");
    if (isQuotaError && !isRetry) {
      markFreeKeyAsFailed(true);
      console.log("[Vision Monitor] Reintentando extraerDatosMonitor con clave de Fallback...");
      return extraerDatosMonitor(mediaBuffer, mimeType, true);
    }
    throw new Error("No pude extraer datos del monitor: " + error.message);
  }
};

const SYSTEM_PROMPT_UNIFICADO = `Sos un experto agrónomo, veterinario y clasificador de imágenes de alta precisión. Tu tarea es analizar imágenes enviadas por productores agropecuarios argentinos y extraer información valiosa estructurada en formato JSON.

Determina primero de qué tipo de imagen se trata:
1. MONITOR: Si la imagen corresponde a la pantalla física dentro de la cabina de un tractor, cosechadora o pulverizadora que muestra datos consolidados de una única labor en curso.
2. REMATE_HACIENDA: Si es una foto o PDF de una planilla de remate de hacienda (consignataria de ganado), pizarra manual de remate (anotada con tiza o marcador en una pizarra), o cuadro/tabla de precios de categorías ganaderas (como terneros, novillos, vacas, vaquillonas).
3. OTRO: Cualquier otra foto de animales, lotes de campo, etc., que no entre en las categorías anteriores.

Debés responder ÚNICAMENTE con un objeto JSON válido, sin bloques de código markdown, sin explicaciones y sin texto adicional.

Estructura de respuesta:
{
  "tipo_imagen": "MONITOR" | "REMATE_HACIENDA" | "OTRO",
  "es_monitor": boolean,
  "es_remate": boolean,
  "monitor_datos": {
    "tipo_labor": "SIEMBRA" | "COSECHA" | "PULVERIZACION" | null,
    "lote_nombre": string | null,
    "hectareas_reales": float | null,
    "dosis_promedio": float | null,
    "producto_insumo": string | null,
    "humedad_media": float | null,
    "velocidad_media": float | null,
    "rendimiento_total_t": float | null,
    "finca_nombre": string | null,
    "agricultor_nombre": string | null
  },
  "remate_datos": {
    "fecha": "YYYY-MM-DD" | null,
    "lugar_o_firma": string | null,
    "lotes": [
      {
        "categoria": string,
        "cantidad_cabezas": int | null,
        "peso_promedio": float | null,
        "precio_promedio": float | null,
        "precio_max": float | null,
        "precio_min": float | null,
        "unidad": "kg" | "cabeza"
      }
    ]
  },
  "transcripcion_general": string | null
}

Reglas específicas:
- "tipo_imagen": Mapealo a "MONITOR", "REMATE_HACIENDA" o "OTRO".
- "es_monitor": Setealo en true SOLO si la imagen es del tipo "MONITOR".
- "es_remate": Setealo en true SOLO si la imagen es del tipo "REMATE_HACIENDA".
- "monitor_datos": Si "es_monitor" es true, extraé las métricas del monitor. Si es false, completa todos sus subcampos con null.
- "remate_datos": Si "es_remate" es true, extraé el listado de lotes e información del remate. Si es false, setealo en null.
  - Para los lotes de hacienda, categorizá cada uno según los términos del mercado ganadero argentino (ej. "Terneros", "Terneras", "Novillitos", "Novillos", "Vaquillonas", "Vacas", "Toros").
  - "unidad": Generalmente "kg" (si el precio es por kilogramo vivo) o "cabeza" (si es al bulto / por cabeza). Si no se aclara, asumí la convención más probable.
- "transcripcion_general": Si la imagen no es un monitor de labor (o sea, es_monitor es false), realizá una transcripción OCR clara y estructurada de los textos/tablas encontrados, o una descripción detallada de la foto. Si es un monitor, completalo en null.
`;

const analizarMediaAgroUnificado = async (mediaBuffer, mimeType, userPrompt = "", isRetry = false) => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: getModelName(),
    systemInstruction: SYSTEM_PROMPT_UNIFICADO
  });

  const parts = [
    {
      inlineData: {
        data: mediaBuffer.toString("base64"),
        mimeType
      }
    },
    { text: "Analizá esta imagen agropecuaria según tus instrucciones y devolvé el JSON estructurado." }
  ];

  try {
    const result = await model.generateContent(parts);
    const response = await result.response;
    let text;
    try {
      text = response.text().trim();
    } catch (textErr) {
      throw new Error("Error al obtener texto del análisis unificado de Gemini: " + textErr.message);
    }
    
    // Limpieza bulletproof de markdown JSON
    if (text.startsWith("```")) {
      text = text.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    
    return JSON.parse(text.trim());
  } catch (error) {
    console.error("[Vision Unificado] Error analizando media:", error.message);
    const errText = error.message.toLowerCase();
    const isQuotaError = errText.includes("429") || errText.includes("spending cap") || errText.includes("limit") || errText.includes("quota") || errText.includes("exhausted") || errText.includes("503") || errText.includes("unavailable") || errText.includes("high demand");
    if (isQuotaError && !isRetry) {
      markFreeKeyAsFailed(true);
      console.log("[Vision Unificado] Reintentando analizarMediaAgroUnificado con clave de Fallback...");
      return analizarMediaAgroUnificado(mediaBuffer, mimeType, userPrompt, true);
    }
    throw new Error("No pude analizar la imagen: " + error.message);
  }
};

module.exports = {
  analizarMediaAgro,
  extraerDatosMonitor,
  analizarMediaAgroUnificado
};
