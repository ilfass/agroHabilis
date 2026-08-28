"use strict";

/**
 * tool_first_turn.js — Pipeline donde el LLM actúa directamente como router.
 *
 * Diferencia con unified_turn_loop.js:
 * - No requiere un clasificador previo.
 * - Expone solo las tools `domain.*` (rutas de negocio directas).
 * - El LLM lee el mensaje + perfil + historial y llama la tool correcta.
 * - No hay switch de intenciones en código: el LLM decide.
 *
 * Activar: AGENT_TOOL_FIRST_MODE=1 (requiere OPENROUTER_API_KEY).
 * El pipeline principal usa esto como primer camino y cae al clásico si falla.
 */

const { listTools, invokeTool } = require("../tools");
const { postOpenRouterChat, parseToolArgs, toOpenAiToolDefinitions } = require("./openrouter_chat");
const { scoutMaxTurns, scoutMaxToolCalls, defaultOnUnlessOff } = require("../cursor_mode");
const { obtenerReglasAprendidasActivas } = require("../auto_evaluador");

const PREGUNTA_MARCADOR_BROADCAST =
  "[AgroHabilis — mensaje del equipo por WhatsApp; no ingresó una consulta del productor. Las respuestas siguientes suelen ser feedback a esta campaña (aunque antes haya ido un recordatorio corto, p. ej. solo un saludo con el nombre).]";

/**
 * Habilitado si hay OPENROUTER_API_KEY y AGENT_TOOL_FIRST_MODE no está explícitamente apagado.
 * Por defecto OFF hasta validación (solo se activa con AGENT_TOOL_FIRST_MODE=1).
 */
const toolFirstModeHabilitado = () => {
  if (!process.env.OPENROUTER_API_KEY?.trim()) return false;
  const raw = String(process.env.AGENT_TOOL_FIRST_MODE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
};

/**
 * Formatea el historial reciente para el system prompt.
 * @param {object[]} historial
 * @returns {string}
 */
const formatearHistorial = (historial = []) => {
  if (!Array.isArray(historial) || !historial.length) return "";
  const lineas = historial
    .slice(-10) // últimas 10 interacciones max en el prompt
    .map((h) => {
      const q = String(h.pregunta || "").trim().slice(0, 180);
      const r = String(h.respuesta || "").trim().slice(0, 300);
      return `Productor: ${q}\nAsistente: ${r}`;
    })
    .join("\n\n");
  return `\n\n--- Conversación reciente ---\n${lineas}`;
};

/**
 * Formatea el perfil del usuario para el system prompt.
 * @param {object|null} usuario
 * @returns {string}
 */
const formatearPerfil = (usuario) => {
  if (!usuario?.id) return "Usuario: sin perfil registrado (posible onboarding).";
  const nombre = String(usuario.nombre || "").trim() || "Productor";
  const zona = String(usuario.localidad || usuario.provincia || "").trim() || "zona no especificada";
  const cultivos = Array.isArray(usuario.cultivos) && usuario.cultivos.length
    ? usuario.cultivos.map(c => c.cultivo).join(", ")
    : "no especificados";
  const plan = String(usuario.plan || "free").trim();

  let perfilStr = `Usuario (Dueño/Establecimiento): ${nombre} · Zona: ${zona} · Cultivos: ${cultivos} · Plan: ${plan}`;

  if (usuario.es_delegado) {
    perfilStr += `\n⚠️ OPERARIO CHATEANDO: El mensaje proviene de un operario delegado/autorizado.`;
    perfilStr += `\n- Nombre del operario: ${usuario.nombre_operario}`;
    perfilStr += `\n- Rol del operario: ${usuario.rol_operario}`;
    perfilStr += `\n- Instrucción crítica: Cuando le respondas a este operario, saludalo por su nombre (${usuario.nombre_operario}) y aclará que las acciones se registran a nombre del establecimiento/dueño principal (${nombre}).`;
  }

  return perfilStr;
};

/**
 * System prompt para el modo tool-first.
 * Explica al LLM cuándo usar cada domain tool.
 */
const buildSystemPrompt = ({ usuario, historialReciente, reglasAprendidas = [] }) => {
  const perfil = formatearPerfil(usuario);
  const hist = formatearHistorial(historialReciente);
  return [
    "Sos AgroHabilis, asistente agropecuario por WhatsApp para productores argentinos.",
    "Respondé siempre en español rioplatense, tono directo, práctico y cercano.",
    "",
    "REGLA CRÍTICA GENERAL: No inventes precios, cotizaciones, cifras de clima ni datos de campo del productor.",
    "Para cualquier dato concreto (precios, clima, registros, análisis) tenés tools. Siempre llamalas antes de responder.",
    "",
    perfil,
    hist,
    "",
    "═══════════════════════════════════════",
    "REGLAS CRÍTICAS DE ROUTING (leer antes de elegir tool)",
    "═══════════════════════════════════════",
    "",
    "1. PREGUNTAS SOBRE CAPACIDADES DEL SISTEMA → domain.agro_general",
    "   Si el mensaje pregunta qué PUEDE HACER el sistema, si algo ES POSIBLE, si SE PUEDE hacer algo,",
    "   usá SIEMPRE domain.agro_general. Ejemplos que deben ir a agro_general:",
    "   - \"¿Puedo registrar los cerdos que tengo en cinco chiqueros?\"",
    "   - \"¿Puedo cargar varios lotes a la vez?\"",
    "   - \"¿Se puede identificar cada novillo individualmente?\"",
    "   - \"¿El bot permite seguimiento por animal?\"",
    "   - \"quiero saber si puedo agregar de varios lotes a la vez\"",
    "   Estas son PREGUNTAS, no comandos de registro. No llamés domain.register_movement para ellas.",
    "",
    "2. REGISTRO REAL → domain.register_movement",
    "   Solo usá register_movement cuando el productor DA datos concretos para cargar, incluyendo reportes de estado de pasturas.",
    "   Ejemplos:",
    "   - \"registrá 120 novillos en el lote Norte\" ✅",
    "   - \"gasté 50000 en semilla\" ✅",
    "   - \"vendí 80 tn de soja\" ✅",
    "   - \"el potrero 4 ya tiene rebrote, 3 semanas de descanso\" ✅ (Registro de estado de pastura)",
    "   - \"ingresaron 80 animales al lote sur\" ✅ (Registro de movimiento)",
    "   Sin datos numéricos ni reporte de estado accionable → NO es registro.",
    "",
    "3. PREGUNTAS AMBIGUAS SIN DATOS → respondé directo o usá domain.agro_general",
    "   Si el mensaje es claramente una pregunta (termina en ?, incluye ¿, o empieza con",
    "   'puedo', 'se puede', 'es posible', 'cómo', 'cuánto', 'qué') pero no trae datos",
    "   concretos para cargar → NO llamés register_movement.",
    "",
    "4. MENSAJES AMBIGUOS O COMENTARIOS SIN ACCIÓN CLARA (Repregunta Aclaratoria / Doble Opción):",
    "   Si el productor envía un mensaje escueto o un comentario (ej. 'Stock ganadero 100 vacas', 'Urea 1200kg', o 'el lote 2 viene lindo') sin un verbo de acción claro, NO intentes adivinar ni lo ignores.",
    "   Si menciona temas de campo (lotes, pasturas, animales, insumos) pero no estás seguro si quiere registrarlo o solo es un comentario, respondé con una repregunta interactiva (Doble Opción).",
    "   Ej: '¡Hola Cristian! Mencionás 100 vacas. ¿Querés que las registre en el inventario o estás queriendo consultar la cotización?'",
    "   Ej: '¡Hola! Me comentás sobre el lote 2. ¿Querés que anote este estado en tus registros de pasturas o solo me lo estabas contando?'",
    "   NUNCA asumas que un mensaje de campo es solo charla sin antes darle la opción de registrarlo.",
    "",
    "5. AGREGAR O AUTORIZAR INTEGRANTE DE EQUIPO → domain.authorize_team_member",
    "   Siempre que el productor solicite agregar, autorizar o invitar a un operario, encargado o integrante a su equipo de campo,",
    "   debes llamar obligatoriamente a la herramienta `domain.authorize_team_member`.",
    "   NUNCA respondas que agregaste al integrante o que le enviaste la invitación sin haber llamado exitosamente a la herramienta.",
    "   Si te faltan datos (como el nombre, el rol o el número de WhatsApp), solicítalos cordialmente al productor antes de llamar a la herramienta.",
    "   Asegúrate de extraer el número de WhatsApp del historial si el productor lo mencionó en el mensaje anterior, y limpia el número para pasar solo los dígitos (ej: 5492281548505) a la herramienta.",
    "",
    "6. CREAR O DAR DE ALTA UN CAMPO O LOTE NUEVO → domain.register_lote",
    "   Si el productor te pide registrar, dar de alta o crear un lote o campo nuevo (ej: 'cargame el Lote 1 y Lote 2 en Don Martín de la firma Daedaz'), usá esta tool.",
    "   Estructura la jerarquía de 3 niveles según corresponda:",
    "   - Si se pide un lote dentro de un campo/establecimiento (ej: 'Lote 1 en Don Martín de la firma Daedaz'): mapeá `nombre: 'Lote 1'`, `cliente: 'Don Martín'` (el campo), y `firma: 'Daedaz Sociedad Anónima'` (la razón social/titular).",
    "   - Si se pide dar de alta un campo completo directamente para un cliente (ej: 'quiero dar de alta el campo Don Martín para la firma Daedaz'): mapeá `nombre: 'Don Martín'`, `cliente: 'Daedaz Sociedad Anónima'` (el cliente/titular), y `firma: null`.",
    "",
    "═══════════════════════════════════════",
    "CUÁNDO USAR CADA TOOL:",
    "═══════════════════════════════════════",
    "- domain.get_prices: precios de granos (soja, maíz, trigo...), hacienda (novillo, vaca...), insumos, dólar.",
    "- domain.get_weather: clima, lluvia, temperatura, pronóstico, alertas climáticas.",
    "- domain.register_lote: para crear o dar de alta campos o lotes nuevos.",
    "- domain.register_movement: el productor DA datos concretos para cargar (cantidad+categoría o monto+concepto).",
    "- domain.get_records: consultar sus propios datos ya cargados (mis gastos, mis ventas, inventario, lotes).",
    "- domain.get_machinery_telemetry: obtiene datos de telemetría o zonas de productividad de lotes, y sirve también para conectar, vincular, enlazar o configurar cuentas de maquinaria (John Deere, Climate FieldView, Case, etc.).",
    "- domain.market_analysis: análisis de mercado, tendencias, perspectivas, noticias del agro.",
    "- domain.my_analysis: análisis personalizado de valor agregado cruzando datos internos del productor (costos, hectáreas) con mercado externo.",
    "- domain.get_technical_ratios: relaciones de intercambio y ratios técnicos (Insumo-Producto, Novillo/Maíz). Para uso profesional.",
    "- domain.get_market_structure: análisis de Carry, Basis, Inverso y TC Implícito. Para optimizar timing de venta.",
    "- domain.run_command: comandos del bot (MI RESUMEN, VER COMANDOS, MIS ALERTAS, PLANES, etc.).",
    "- domain.authorize_team_member: autoriza, agrega o invita a un integrante del equipo de campo (delegado/operario) al establecimiento. Requiere nombre, número de WhatsApp (solo dígitos) y rol.",
    "- domain.agro_general: DEFAULT. Consultas generales, dudas técnicas o cuando no encaje otra tool.",
    "",
    "REGLA DE VISIÓN Y VOZ Y PLANILLAS:",
    "- Si el mensaje contiene '[Análisis de archivo: ...]', es contexto visual (fotos/PDF).",
    "- Si contiene '[Audio transcrito: ...]', es lo que el productor dijo por mensaje de voz.",
    "- Si el mensaje es una planilla de planificación, tabla de siembra o listado multi-lote (visual o texto), debés llamar a domain.register_movement si el objetivo es registrar siembras/movimientos, o a domain.register_lote si el objetivo es crear/dar de alta los lotes en el sistema. Jamás llames a tools de precios, clima o análisis general de flete para planillas.",
    "Tratalos como entrada directa para responder o ejecutar herramientas.",
    "",
    "Si el mensaje es claramente conversacional (saludo simple, agradecimiento, 'sí', 'no') respondé directo sin tool.",
    "EXCEPCIÓN AL PUNTO ANTERIOR: Si el turno previo del historial incluye una lista de lotes de un plano catastral y termina preguntando si el productor quiere registrarlos (ej: '¿Querés que los registre todos en tu perfil?'), y el productor responde 'Sí' o afirmativamente, NO respondas directo. Llamá a domain.register_lote con los lotes listados en el historial, extrayendo nombre y hectáreas de cada bullet.",
    "Ante la mínima duda entre register_movement y agro_general → elegí agro_general.",
    "",
    "═══════════════════════════════════════",
    "REGLAS DE RESPUESTA Y RAZONAMIENTO:",
    "═══════════════════════════════════════",
    "1. Las herramientas `domain.*` devuelven un objeto con un campo `texto`. ",
    "   Este texto es solo un borrador técnico. Tu tarea es actuar como un agente humano,",
    "   AgroHabilis, que está ayudando al productor. No te limites a copiar el borrador.",
    "",
    "2. Integrá los datos en una respuesta conversacional:",
    "   - Saludá si corresponde, contextualizá el dato y cerrá amablemente.",
    "   - Mantené los bloques con ━━━━━━━━ si ayudan a leer los precios o el clima o la telemetría.",
    "   - El objetivo es que el productor sienta que habla con un asistente, no con un buscador.",
    "",
    "3. Si una herramienta devuelve un error, no lo menciones técnicamente.",
    "   Explicá qué faltó y pedí los datos de forma cercana.",
    "",
    "4. Podés llamar a múltiples herramientas si es necesario para completar la tarea.",
    "",
    "5. PRECISIÓN DE TELEMETRÍA: Cuando consulten por la siembra, pulverización o 'cómo viene' un lote:",
    "   - Saborizá la respuesta cruzando la telemetría real (hectáreas reales, dosis de monitor) con los datos manuales (lotes/gastos).",
    "   - Traducí datos complejos a lógica de negocio simple: si preguntan por el galpón, restá las bolsas/dosis reales sembradas (ha reales * dosis real) del total comprado en gastos.",
    "",
    "6. FLUJOS DE CONFIRMACIÓN O PENDIENTES (SÍ/NO):",
    "   Si el resultado de una herramienta de dominio (como `domain.register_movement`) indica que hay un borrador o plan guardado esperando confirmación,",
    "   o contiene instrucciones de flujo interactivo como 'Respondé SI para confirmar o NO para cancelar' o '¿Confirmás la siembra...?',",
    "   el productor está en medio de un proceso de validación paso a paso. BAJO NINGUNA CIRCUNSTANCIA debes generar una respuesta afirmando",
    "   que los datos ya fueron guardados definitivamente con éxito en la base de datos si la herramienta indica que está pendiente.",
    "   Debes mantener intacto el flujo conversacional de la herramienta, presentando la información tal cual y pidiendo la confirmación correspondiente.",
  ];

  // ── Inyección dinámica de reglas aprendidas ──
  if (Array.isArray(reglasAprendidas) && reglasAprendidas.length > 0) {
    base.push("");
    base.push("═══════════════════════════════════════");
    base.push("REGLAS DINÁMICAS APRENDIDAS");
    base.push("═══════════════════════════════════════");
    for (const regla of reglasAprendidas) {
      const cat = String(regla.categoria || "general").trim();
      const texto = String(regla.regla_texto || "").trim();
      if (texto) {
        base.push(`- [${cat}] ${texto}`);
      }
    }
  }

  return base.join("\n");
};

/**
 * Ejecuta un turno completo usando solo tools `domain.*`.
 * El LLM actúa como router sin clasificador previo.
 *
 * @param {{
 *   usuario: object|null,
 *   numeroWhatsapp: string,
 *   mensaje: string,
 *   historialReciente?: object[],
 * }} input
 * @returns {Promise<{ texto: string, toolTrace: object[], domainToolUsed: string|null }>}
 */
const ejecutarToolFirstTurn = async ({
  usuario,
  numeroWhatsapp,
  mensaje,
  historialReciente = [],
}) => {
  const mensajeTrim = String(mensaje || "").trim();
  const trace = [];

  // Solo ofrecemos las tools domain.* + agent.turn_step (observabilidad)
  const allTools = listTools().filter(
    (t) =>
      String(t.name || "").startsWith("domain.") ||
      t.name === "agent.turn_step"
  );

  if (!allTools.some((t) => t.name.startsWith("domain."))) {
    return {
      texto: "",
      toolTrace: trace,
      domainToolUsed: null,
      error: "sin_domain_tools_registradas",
    };
  }

  const toolCtx = {
    // clasificacion placeholder — las domain tools lo ignorarán o usarán su propio patch
    clasificacion: { intencion: "agro_general", confianza: "media" },
    usuario: usuario || null,
    numeroWhatsapp,
    mensaje: mensajeTrim,
    historialReciente: Array.isArray(historialReciente) ? historialReciente : [],
  };

  // Cargar reglas aprendidas activas para inyectar en el prompt
  let reglasAprendidas = [];
  try {
    reglasAprendidas = await obtenerReglasAprendidasActivas();
  } catch (e) {
    console.warn("[agent] tool_first_turn: error cargando reglas aprendidas:", e.message);
  }

  const system = buildSystemPrompt({ usuario, historialReciente, reglasAprendidas });
  const tools = toOpenAiToolDefinitions(allTools);
  const maxTurns = scoutMaxTurns();
  const maxToolCalls = scoutMaxToolCalls();

  const messages = [
    { role: "system", content: system },
  ];

  if (Array.isArray(historialReciente) && historialReciente.length) {
    const histOrdenado = [...historialReciente].reverse();
    for (const h of histOrdenado) {
      const q = String(h.pregunta || "").trim();
      const r = String(h.respuesta || "").trim();
      if (q && r && q !== PREGUNTA_MARCADOR_BROADCAST) {
        messages.push({ role: "user", content: q });
        messages.push({ role: "assistant", content: r });
      }
    }
  }

  messages.push({ role: "user", content: mensajeTrim });

  let toolCallsEjecutados = 0;
  let domainToolUsed = null;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    let data;
    try {
      data = await postOpenRouterChat(
        {
          messages,
          tools,
          tool_choice: "auto",
          temperature: 0.18, // más determinista que el loop unificado
        },
        { xTitle: "AgroHabilis-tool-first", temperature: 0.18 }
      );
    } catch (err) {
      trace.push({ turn, error: `openrouter_error: ${err?.message || err}` });
      break;
    }

    const msg = data?.choices?.[0]?.message;
    if (!msg) {
      trace.push({ turn, error: "sin_message" });
      break;
    }
    
    // Cleanup non-standard fields that cause validation errors in some providers
    if (msg.reasoning_details !== undefined) {
      delete msg.reasoning_details;
    }
    
    messages.push(msg);

    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

    if (calls.length) {
      for (const tc of calls) {
        if (toolCallsEjecutados >= maxToolCalls) break;

        const name = String(tc?.function?.name || "").trim();
        const args = parseToolArgs(tc?.function?.arguments);
        const id = String(tc?.id || "").trim() || `call_${toolCallsEjecutados}`;

        const inv = await invokeTool(name, args, toolCtx);
        toolCallsEjecutados += 1;
        trace.push({ turn, tool: name, args, ok: inv.ok, error: inv.error || null });

        messages.push({
          role: "tool",
          tool_call_id: id,
          content: JSON.stringify(
            inv.ok ? inv.result ?? { ok: true } : { ok: false, error: inv.error }
          ),
        });

        // Marcamos que se usó una domain tool para observabilidad
        const resolvedName = inv.tool || name;
        if (resolvedName.startsWith("domain.") && inv.ok) {
          domainToolUsed = resolvedName;
        }
      }

      if (toolCallsEjecutados >= maxToolCalls) break;
      continue;
    }

    // El LLM respondió en texto directo (sin tool call) — válido para saludos, etc.
    const textoAsistente = String(msg.content || "").trim();
    if (textoAsistente) {
      // Validar si es una alucinación de escritura sin tool
      const patronesConfirmacion = [
        /\b(ya\s+)?(registré|registre|guardé|guarde|cargué|cargue|agregué|agregue|anoté|anote|confirmamos|cargamos|registramos)\b/i,
        /\b(guardado|cargado|registrado|agregado|enviado)s?\b.*\b(éxito|exito|correcto|correctamente|hecho)\b/i,
        /\b(éxito|exito|correcto|correctamente|hecho)\b.*\b(guardado|cargado|registrado|agregado|enviado)s?\b/i,
        /\binvitación enviada\b/i,
        /\binvitacion enviada\b/i,
        /\bhecho,?\s+fabian\b/i,
        /\b¡listo,?\s+fabian!\b/i,
        /\b¡perfecto! ya\b/i
      ];

      const noToolDeEscritura = !domainToolUsed || 
        (!domainToolUsed.includes("register_movement") && !domainToolUsed.includes("authorize_team_member"));

      if (noToolDeEscritura) {
        for (const pattern of patronesConfirmacion) {
          if (pattern.test(textoAsistente)) {
            console.warn(`[agent] tool_first_turn: detectada posible alucinación de escritura en texto directo sin tool calls: "${textoAsistente.slice(0, 100)}...". Forzando fallback.`);
            trace.push({ turn, error: "posible_alucinacion_escritura_sin_tool" });
            return {
              texto: "",
              toolTrace: trace,
              domainToolUsed: null,
            };
          }
        }
      }

      // Validar si es una respuesta directa sin tool call para una pregunta que requiere datos/precios/clima/registros
      const tienePalabrasData = /\b(precio|cotizacion|cotización|margen|márgenes|clima|pronostico|pronóstico|lluvia|flete|fletes|novillo|vaca|vaquillona|ternero|toro|soja|maiz|maíz|trigo|girasol|cebada|sorgo|stock|inventario|gasto|venta|hectarea|ha)\b/i;
      if (!domainToolUsed && tienePalabrasData.test(mensajeTrim)) {
        console.warn(`[agent] tool_first_turn: detectada respuesta directa sin tool call para una pregunta de datos ("${textoAsistente.slice(0, 100)}..."). Forzando fallback.`);
        trace.push({ turn, error: "respuesta_directa_sin_tool_para_datos" });
        return {
          texto: "",
          toolTrace: trace,
          domainToolUsed: null,
        };
      }

      trace.push({ turn, direct_text: true });
      return {
        texto: textoAsistente,
        toolTrace: trace,
        domainToolUsed,
      };
    }

    trace.push({ turn, error: "contenido_vacio" });
    break;
  }

  // Sin resultado → el llamador hace fallback al pipeline clásico
  return {
    texto: "",
    toolTrace: trace,
    domainToolUsed: null,
  };
};

module.exports = {
  toolFirstModeHabilitado,
  ejecutarToolFirstTurn,
};
