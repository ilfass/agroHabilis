const crypto = require("crypto");
const { query } = require("../config/database");
const {
  obtenerEstadoWhatsapp,
  obtenerEstadoWhatsappDetalle,
  client,
} = require("../config/whatsapp");
const { obtenerEstadoFuentes } = require("./fuentes_monitor");
const { inferCalidadDesdeFuenteTexto } = require("../utils/data_quality");
const { interpolarMensajeMasivo } = require("../utils/interpolar_mensaje_masivo");
const { WHATSAPP_SISTEMA, obtenerUsuarioSistemaId } = require("./resumenes");
const { registrarEnvioMasivoEnHistorial } = require("./broadcast_historial");

const buildAgentRuntimeSnapshot = () => {
  try {
    const {
      cursorMode,
      clasificadorHistorialLimite,
      historialHiloPromptTurnos,
      dominioHistorialLimite,
      scoutMaxTurns,
      scoutMaxToolCalls,
      verifyRouterMaxAttempts,
      oavStepMaxAttemptsCap,
      inventarioSoloLlm,
      dialogoHiloSinAtajoHeuristico,
      agentIaTotal,
    } = require("./agent/cursor_mode");
    const {
      unifiedTurnLoopHabilitado,
      clasificadorDeferidoAlBucleUnificado,
    } = require("./agent/ia/unified_turn_loop");
    const { scoutLoopHabilitado } = require("./agent/ia/tool_loop_scout");
    return {
      cursorMode: cursorMode(),
      agentIaTotal: agentIaTotal(),
      inventarioSoloLlm: inventarioSoloLlm(),
      dialogoHiloSinAtajoHeuristico: dialogoHiloSinAtajoHeuristico(),
      unifiedTurnLoop: unifiedTurnLoopHabilitado(),
      clasificadorEnBucleUnificado: clasificadorDeferidoAlBucleUnificado(),
      scoutLoop: scoutLoopHabilitado(),
      limits: {
        historialClasificador: clasificadorHistorialLimite(),
        historialHiloIaTurnos: historialHiloPromptTurnos(),
        historialDominio: dominioHistorialLimite(),
        scoutMaxTurns: scoutMaxTurns(),
        scoutMaxToolCalls: scoutMaxToolCalls(),
        verifyRouterMaxAttempts: verifyRouterMaxAttempts(),
        oavStepMaxAttemptsCap: oavStepMaxAttemptsCap(),
      },
      apiKeysPresent: {
        OPENROUTER: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
        GROQ: Boolean(process.env.GROQ_API_KEY?.trim()),
        GEMINI: Boolean(process.env.GEMINI_API_KEY?.trim()),
      },
      models: {
        OPENROUTER_MODEL: String(process.env.OPENROUTER_MODEL || "openrouter/free").trim(),
        GEMINI_MODEL: String(process.env.GEMINI_MODEL || "gemini-flash-latest").trim(),
      },
      docEnvRef: ".env.example (sección modo agente / AGENT_*)",
    };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
};

/** No tumbar todo el panel si una métrica secundaria falla (SQL, datos raros, tabla ausente). */
const queryDashboardSeguro = async (etiqueta, text, params = []) => {
  try {
    return await query(text, params);
  } catch (err) {
    console.error(`[getAdminDashboard] consulta "${etiqueta}":`, err.message);
    return { rows: [] };
  }
};

/** Distribución de `ia_provider` en consultas (ventana móvil en días, máx. 90). */
const getIaProveedorMixDias = async (dias = 7) => {
  const d = Math.min(90, Math.max(1, Math.floor(Number(dias) || 7)));
  return queryDashboardSeguro(
    "ia_proveedor_mix_dias",
    `
      SELECT
        COALESCE(NULLIF(TRIM(ia_provider), ''), '(sin etiqueta)') AS proveedor,
        COUNT(*)::int AS n
      FROM historial_consultas
      WHERE creado_en >= NOW() - ($1::int * INTERVAL '1 day')
      GROUP BY COALESCE(NULLIF(TRIM(ia_provider), ''), '(sin etiqueta)')
      ORDER BY n DESC
      LIMIT 32
    `,
    [d]
  );
};

/**
 * Snapshot liviano para admin: flags del agente + mix `ia_provider` (sin el resto del dashboard).
 * @param {{ dias?: number }} [opts]
 */
const getAgentRuntimeAdmin = async ({ dias = 7 } = {}) => {
  const d = Math.min(90, Math.max(1, Math.floor(Number(dias) || 7)));
  const mix = await getIaProveedorMixDias(d);
  return {
    dias: d,
    runtime: buildAgentRuntimeSnapshot(),
    proveedorMix: mix.rows || [],
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolverDestinoWhatsappUsuario = (u) => {
  const jid = String(u?.whatsapp_jid || "").trim();
  if (jid.includes("@")) return jid;
  const raw = String(u?.whatsapp_real || u?.whatsapp || "").trim();
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits || null;
};

const IA_PROVIDERS = [
  {
    nombre: "OpenRouter",
    apiKeyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    modelDefault: "openrouter/free",
  },
  {
    nombre: "Groq",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    modelDefault: "llama-3.1-8b-instant",
  },
  {
    nombre: "Gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    modelDefault: "gemini-flash-latest",
  },
];

const minutosDesde = (fechaIso) => {
  if (!fechaIso) return null;
  const diffMs = new Date().getTime() - new Date(fechaIso).getTime();
  if (!Number.isFinite(diffMs)) return null;
  return Math.max(Math.floor(diffMs / 60000), 0);
};

const estadoCobertura = ({ total, ultimaActualizacion, umbralMinutos }) => {
  const count = Number(total || 0);
  if (count <= 0 || !ultimaActualizacion) {
    return { estado: "sin_datos", label: "Sin datos", minutosDesde: null };
  }
  const mins = minutosDesde(ultimaActualizacion);
  if (mins === null) {
    return { estado: "sin_datos", label: "Sin datos", minutosDesde: null };
  }
  if (mins <= umbralMinutos) {
    return { estado: "ok", label: "Actualizado", minutosDesde: mins };
  }
  return { estado: "desactualizado", label: "Desactualizado", minutosDesde: mins };
};

const getIaConfig = () => {
  const proveedores = IA_PROVIDERS.map((p, index) => {
    const configurado = Boolean(process.env[p.apiKeyEnv]?.trim());
    return {
      prioridad: index + 1,
      nombre: p.nombre,
      model: process.env[p.modelEnv] || p.modelDefault,
      configurado,
    };
  });
  const activos = proveedores.filter((p) => p.configurado);
  return {
    proveedores,
    ordenFallback: activos.map((p) => `${p.nombre}(${p.model})`),
    proveedorPrincipal: activos[0] || null,
    estado: activos.length ? "operativa" : "sin_proveedores_configurados",
  };
};

const getAdminDashboard = async () => {
  const [
    dbNow,
    ultimaRecoleccion,
    ultimaCotizacion,
    ultimaConsulta,
    ultimaActualizacionClima,
    usuarios,
    planes,
    onboarding,
    resumenesHoy,
    resumenesGratisHoy,
    iaHoy,
    iaCalidadHoy,
    interacciones,
    interaccionesPorUsuario,
    tokensPorUsuario,
    tokensGlobal,
    saludFuentes,
    alertasResumen,
    alertasPorUsuario,
    coberturaRaw,
    iaProveedoresHoy,
    iaRateLimitHoy,
    iaRateLimit7d,
    matbaFuentesHoy,
    iaHealthCheckResult,
  ] = await Promise.all([
    query("SELECT NOW() AS now"),
    query("SELECT MAX(creado_en) AS ts FROM precios"),
    query("SELECT MAX(fecha) AS fecha FROM tipo_cambio"),
    query("SELECT MAX(creado_en) AS ts FROM historial_consultas"),
    query("SELECT MAX(creado_en) AS ts FROM clima"),
    query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE activo = true)::int AS activos
        FROM usuarios
      `
    ),
    query(
      `
        SELECT COALESCE(plan, 'sin_plan') AS plan, COUNT(*)::int AS total
        FROM usuarios
        GROUP BY COALESCE(plan, 'sin_plan')
        ORDER BY total DESC
      `
    ),
    query(
      `
        SELECT
          COUNT(*)::int AS en_curso
        FROM onboarding_estado
        WHERE completado = false
      `
    ),
    query(
      `
        SELECT
          COUNT(*)::int AS generados,
          COUNT(*) FILTER (WHERE enviado_wp = true)::int AS enviados
        FROM resumenes
        WHERE fecha = CURRENT_DATE
      `
    ),
    query(
      `
        WITH ctx AS (
          SELECT
            (timezone('America/Argentina/Buenos_Aires', NOW()))::date AS hoy_ar,
            EXTRACT(ISODOW FROM timezone('America/Argentina/Buenos_Aires', NOW())::date)::int AS dow_ar
        ),
        base AS (
          SELECT
            r.id,
            (timezone('America/Argentina/Buenos_Aires', r.enviado_en))::date AS envio_ar,
            (timezone('America/Argentina/Buenos_Aires', u.creado_en))::date AS registro_ar,
            c.hoy_ar,
            c.dow_ar
          FROM resumenes r
          JOIN usuarios u ON u.id = r.usuario_id
          CROSS JOIN ctx c
          WHERE COALESCE(u.plan, 'gratis') = 'gratis'
            AND r.tipo = 'diario'
            AND r.enviado_wp = true
            AND r.enviado_en IS NOT NULL
            AND (timezone('America/Argentina/Buenos_Aires', r.enviado_en))::date = c.hoy_ar
        )
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE registro_ar = (hoy_ar - 1))::int AS post_registro,
          COUNT(*) FILTER (
            WHERE registro_ar <> (hoy_ar - 1)
              AND dow_ar IN (1, 4)
          )::int AS lunes_jueves
        FROM base
      `
    ),
    query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE tokens_usados IS NOT NULL OR NULLIF(TRIM(ia_provider), '') IS NOT NULL
          )::int AS con_ia,
          COUNT(*) FILTER (
            WHERE tokens_usados IS NULL AND (ia_provider IS NULL OR TRIM(ia_provider) = '')
          )::int AS fallback_local
        FROM historial_consultas
        WHERE creado_en::date = CURRENT_DATE
      `
    ),
    query(
      `
        SELECT
          COUNT(*) FILTER (WHERE ia_sin_contexto = true AND creado_en::date = CURRENT_DATE)::int AS sin_contexto_hoy,
          COUNT(*) FILTER (WHERE ia_sin_contexto = true AND creado_en >= NOW() - INTERVAL '7 days')::int AS sin_contexto_7d
        FROM historial_consultas
      `
    ),
    query(
      `
        SELECT
          COUNT(*)::int AS total_consultas,
          COUNT(*) FILTER (WHERE creado_en::date = CURRENT_DATE)::int AS consultas_hoy,
          COUNT(*) FILTER (WHERE creado_en >= NOW() - INTERVAL '7 days')::int AS consultas_7d
        FROM historial_consultas
      `
    ),
    query(
      `
        SELECT
          u.id AS usuario_id,
          u.nombre,
          COALESCE(NULLIF(u.whatsapp_real, ''), u.whatsapp) AS whatsapp,
          u.whatsapp_real,
          u.whatsapp_jid,
          COUNT(h.id)::int AS consultas_total,
          COUNT(h.id) FILTER (WHERE h.creado_en::date = CURRENT_DATE)::int AS consultas_hoy,
          MAX(h.creado_en) AS ultima_consulta
        FROM usuarios u
        LEFT JOIN historial_consultas h ON h.usuario_id = u.id
        GROUP BY u.id, u.nombre, u.whatsapp, u.whatsapp_real, u.whatsapp_jid
        ORDER BY consultas_total DESC, ultima_consulta DESC NULLS LAST
        LIMIT 20
      `
    ),
    query(
      `
        SELECT
          u.id AS usuario_id,
          u.nombre,
          COALESCE(NULLIF(u.whatsapp_real, ''), u.whatsapp) AS whatsapp,
          u.whatsapp_real,
          u.whatsapp_jid,
          COALESCE(SUM(h.tokens_usados), 0)::int
            + COALESCE((
              SELECT SUM(r.tokens_usados)::int
              FROM resumenes r
              WHERE r.usuario_id = u.id
            ), 0)::int AS tokens_totales
        FROM usuarios u
        LEFT JOIN historial_consultas h ON h.usuario_id = u.id
        GROUP BY u.id, u.nombre, u.whatsapp, u.whatsapp_real, u.whatsapp_jid
        ORDER BY tokens_totales DESC, u.id DESC
        LIMIT 20
      `
    ),
    query(
      `
        SELECT
          COALESCE(SUM(tokens_usados), 0)::int AS tokens_consultas_total,
          COALESCE(SUM(tokens_usados) FILTER (WHERE creado_en::date = CURRENT_DATE), 0)::int AS tokens_consultas_hoy
        FROM historial_consultas
      `
    ),
    query(
      `
        SELECT
          COALESCE((SELECT MAX(creado_en) FROM precios), NULL) AS ts_precios,
          COALESCE((SELECT MAX(fecha) FROM tipo_cambio), NULL) AS ts_tipo_cambio,
          COALESCE((SELECT MAX(creado_en) FROM clima), NULL) AS ts_clima
      `
    ),
    query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE activa = true)::int AS activas,
          COUNT(*) FILTER (WHERE disparada = true)::int AS disparadas
        FROM alertas
      `
    ),
    query(
      `
        SELECT
          u.id AS usuario_id,
          u.nombre,
          COALESCE(NULLIF(u.whatsapp_real, ''), u.whatsapp) AS whatsapp,
          u.whatsapp_real,
          u.whatsapp_jid,
          COUNT(a.id)::int AS total,
          COUNT(a.id) FILTER (WHERE a.activa = true)::int AS activas,
          COUNT(a.id) FILTER (WHERE a.disparada = true)::int AS disparadas
        FROM usuarios u
        LEFT JOIN alertas a ON a.usuario_id = u.id
        GROUP BY u.id, u.nombre, u.whatsapp, u.whatsapp_real, u.whatsapp_jid
        ORDER BY activas DESC, total DESC, u.id DESC
        LIMIT 20
      `
    ),
    query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM tipo_cambio) AS tc_total,
          (SELECT MAX(fecha) FROM tipo_cambio) AS tc_ultima,
          (SELECT COUNT(*)::int FROM precios) AS precios_total,
          (SELECT MAX(creado_en) FROM precios) AS precios_ultima,
          (SELECT COUNT(*)::int FROM futuros_posiciones) AS futuros_total,
          (SELECT MAX(fecha) FROM futuros_posiciones) AS futuros_ultima,
          (SELECT COUNT(*)::int FROM clima) AS clima_total,
          (SELECT MAX(creado_en) FROM clima) AS clima_ultima,
          (SELECT COUNT(*)::int FROM precios_insumos) AS insumos_total,
          (SELECT MAX(fecha) FROM precios_insumos) AS insumos_ultima,
          (SELECT COUNT(*)::int FROM precios_hacienda) AS hacienda_total,
          (SELECT MAX(fecha) FROM precios_hacienda) AS hacienda_ultima
      `
    ),
    query(
      `
        SELECT
          COALESCE(NULLIF(ia_provider, ''), 'fallback_local') AS proveedor,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE ia_sin_contexto = true)::int AS sin_contexto
        FROM historial_consultas
        WHERE creado_en::date = CURRENT_DATE
        GROUP BY COALESCE(NULLIF(ia_provider, ''), 'fallback_local')
        ORDER BY total DESC
      `
    ),
    queryDashboardSeguro(
      "iaRateLimitHoy",
      `
        SELECT
          x.provider AS proveedor,
          COUNT(*)::int AS total_rate_limit
        FROM historial_consultas h
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE jsonb_typeof(COALESCE(h.ia_provider_trace, '[]'::jsonb))
            WHEN 'array' THEN COALESCE(h.ia_provider_trace, '[]'::jsonb)
            ELSE '[]'::jsonb
          END
        ) AS xraw(elem)
        CROSS JOIN LATERAL (
          SELECT
            COALESCE(NULLIF(xraw.elem->>'provider', ''), 'desconocido') AS provider,
            LOWER(COALESCE(xraw.elem->>'error', '')) AS err
        ) x
        WHERE h.creado_en::date = CURRENT_DATE
          AND (
            x.err LIKE '%rate limit%'
            OR x.err LIKE '%429%'
            OR x.err LIKE '%quota exceeded%'
            OR x.err LIKE '%too many requests%'
          )
        GROUP BY x.provider
        ORDER BY total_rate_limit DESC
      `
    ),
    queryDashboardSeguro(
      "iaRateLimit7d",
      `
        WITH dias AS (
          SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day')::date AS dia
        ),
        consultas AS (
          SELECT creado_en::date AS dia, COUNT(*)::int AS total_consultas
          FROM historial_consultas
          WHERE creado_en::date >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY creado_en::date
        ),
        rate_limits AS (
          SELECT
            h.creado_en::date AS dia,
            COUNT(*)::int AS total_rate_limit
          FROM historial_consultas h
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE jsonb_typeof(COALESCE(h.ia_provider_trace, '[]'::jsonb))
              WHEN 'array' THEN COALESCE(h.ia_provider_trace, '[]'::jsonb)
              ELSE '[]'::jsonb
            END
          ) AS xraw(elem)
          CROSS JOIN LATERAL (
            SELECT LOWER(COALESCE(xraw.elem->>'error', '')) AS err
          ) x
          WHERE h.creado_en::date >= CURRENT_DATE - INTERVAL '6 days'
            AND (
              x.err LIKE '%rate limit%'
              OR x.err LIKE '%429%'
              OR x.err LIKE '%quota exceeded%'
              OR x.err LIKE '%too many requests%'
            )
          GROUP BY h.creado_en::date
        )
        SELECT
          d.dia,
          COALESCE(c.total_consultas, 0)::int AS total_consultas,
          COALESCE(r.total_rate_limit, 0)::int AS total_rate_limit
        FROM dias d
        LEFT JOIN consultas c ON c.dia = d.dia
        LEFT JOIN rate_limits r ON r.dia = d.dia
        ORDER BY d.dia ASC
      `
    ),
    query(
      `
        SELECT
          COALESCE(NULLIF(fuente, ''), 'sin_fuente') AS fuente,
          COUNT(*)::int AS total,
          MAX(fecha) AS ultima_fecha
        FROM futuros_posiciones
        WHERE fecha = CURRENT_DATE
        GROUP BY COALESCE(NULLIF(fuente, ''), 'sin_fuente')
        ORDER BY total DESC, fuente ASC
      `
    ),
    query(
      `
        SELECT status, verificado_en, error_msg
        FROM fuentes_estado
        WHERE fuente_id = 'ia_health'
        ORDER BY verificado_en DESC
        LIMIT 1
      `
    ),
  ]);

  const iaProveedorMix7d = await getIaProveedorMixDias(7);

  const iaConfig = getIaConfig();
  const conIAHoy = Number(iaHoy.rows[0]?.con_ia || 0);
  const fallbackHoy = Number(iaHoy.rows[0]?.fallback_local || 0);
  const sinContextoHoy = Number(iaCalidadHoy.rows[0]?.sin_contexto_hoy || 0);
  const sinContexto7d = Number(iaCalidadHoy.rows[0]?.sin_contexto_7d || 0);
  const totalHoy = conIAHoy + fallbackHoy;
  const porcentajeIAHoy = totalHoy > 0 ? Number(((conIAHoy / totalHoy) * 100).toFixed(1)) : null;
  const porcentajeFallbackHoy =
    totalHoy > 0 ? Number(((fallbackHoy / totalHoy) * 100).toFixed(1)) : null;
  const tsPrecios = saludFuentes.rows[0]?.ts_precios || null;
  const tsTipoCambio = saludFuentes.rows[0]?.ts_tipo_cambio || null;
  const tsClima = saludFuentes.rows[0]?.ts_clima || null;
  let fuentesEstado;
  try {
    fuentesEstado = await obtenerEstadoFuentes();
  } catch (err) {
    console.error("[getAdminDashboard] obtenerEstadoFuentes:", err.message);
    fuentesEstado = {
      resumen: { total: 0, ok: 0, lento: 0, error: 0, sinVerificar: 0 },
      activas: [],
      agrupadas: {},
    };
  }
  const fuentes = fuentesEstado.activas.map((f) => ({
    codigo: f.id,
    nombre: f.nombre,
    categoria: f.categoria,
    grupo: f.grupo,
    tipo: f.oficial ? "oficial" : "no_oficial",
    endpoint: f.url,
    region: f.region,
    productos: f.productos,
    estado: f.status,
    ultimaActualizacion: f.verificadoEn,
    minutosDesdeUltAct: minutosDesde(f.verificadoEn),
    tiempoMs: f.tiempoMs,
    errorMsg: f.errorMsg,
  }));

  const estadoFuente = (id) => fuentes.find((f) => f.codigo === id)?.estado || null;
  const inferirCalidadInsumos = async () => {
    const q = await query(
      `
        SELECT fuente, fecha
        FROM precios_insumos
        WHERE fecha = (SELECT MAX(fecha) FROM precios_insumos)
        ORDER BY id DESC
        LIMIT 1
      `
    );
    const row = q.rows[0];
    return inferCalidadDesdeFuenteTexto(row?.fuente);
  };

  const calidadInsumos = await inferirCalidadInsumos();
  const estadoMag = estadoFuente("liniers");
  const estadoFallbackMag = estadoFuente("mercadodeliniers_web");
  let calidadHacienda = { tipo: "sin_datos", detalle: "Sin verificación reciente" };
  if (estadoMag === "ok") {
    calidadHacienda = { tipo: "directa", detalle: "Mercado Agroganadero" };
  } else if (estadoFallbackMag === "ok") {
    calidadHacienda = { tipo: "proxy", detalle: "Fallback web Mercado de Liniers" };
  } else if (estadoMag || estadoFallbackMag) {
    calidadHacienda = { tipo: "sin_datos", detalle: "Fuentes con error/lentitud" };
  }

  const c = coberturaRaw.rows[0] || {};
  const temas = [
    {
      id: "dolar",
      nombre: "Dólar",
      total: c.tc_total || 0,
      ultimaActualizacion: c.tc_ultima || null,
      umbralMinutos: 24 * 60,
    },
    {
      id: "granos",
      nombre: "Granos",
      total: c.precios_total || 0,
      ultimaActualizacion: c.precios_ultima || null,
      umbralMinutos: 24 * 60,
    },
    {
      id: "futuros",
      nombre: "Futuros",
      total: c.futuros_total || 0,
      ultimaActualizacion: c.futuros_ultima || null,
      umbralMinutos: 3 * 24 * 60,
    },
    {
      id: "clima",
      nombre: "Clima",
      total: c.clima_total || 0,
      ultimaActualizacion: c.clima_ultima || null,
      umbralMinutos: 36 * 60,
    },
    {
      id: "insumos",
      nombre: "Insumos",
      total: c.insumos_total || 0,
      ultimaActualizacion: c.insumos_ultima || null,
      umbralMinutos: 7 * 24 * 60,
      calidad: calidadInsumos.tipo,
      calidadDetalle: calidadInsumos.detalle,
    },
    {
      id: "hacienda",
      nombre: "Hacienda",
      total: c.hacienda_total || 0,
      ultimaActualizacion: c.hacienda_ultima || null,
      umbralMinutos: 7 * 24 * 60,
      calidad: calidadHacienda.tipo,
      calidadDetalle: calidadHacienda.detalle,
    },
  ].map((t) => ({ ...t, ...estadoCobertura(t) }));
  const temasOk = temas.filter((t) => t.estado === "ok").length;
  const coberturaPct = temas.length ? Math.round((temasOk / temas.length) * 100) : 0;
  const { getGeminiApiKeyStatus } = require("./gemini_keys");
  const iaStatus = getGeminiApiKeyStatus();

  const iaPorProveedorHoy = iaProveedoresHoy.rows.map((r) => ({
    proveedor: r.proveedor,
    total: Number(r.total || 0),
    sinContexto: Number(r.sin_contexto || 0),
  }));

  const rateLimitPorProveedorHoy = iaRateLimitHoy.rows.map((r) => ({
    proveedor: r.proveedor,
    total: Number(r.total_rate_limit || 0),
  }));

  const rateLimitTotalHoy = rateLimitPorProveedorHoy.reduce((acc, x) => acc + x.total, 0);

  const rateLimitSerie7d = iaRateLimit7d.rows.map((r) => {
    const totalConsultas = Number(r.total_consultas || 0);
    const totalRateLimit = Number(r.total_rate_limit || 0);
    const porcentaje = totalConsultas > 0 ? Number(((totalRateLimit / totalConsultas) * 100).toFixed(1)) : 0;
    const nivel = totalRateLimit === 0 ? "ok" : porcentaje <= 5 ? "warn" : "bad";
    return {
      dia: r.dia,
      totalConsultas,
      totalRateLimit,
      porcentaje,
      nivel,
    };
  });

  // Definir las 7 IAs objetivo
  const targetProviders = [
    { id: "gemini_gratis", name: "Gemini gratis", quotaLimit: "15 RPM" },
    { id: "gemini_pago", name: "Gemini pago", quotaLimit: "Ilimitado" },
    { id: "gemini_vision", name: "Gemini vision", quotaLimit: "15 RPM" },
    { id: "groq", name: "Groq", quotaLimit: "Ilimitado" },
    { id: "openrouter", name: "Openroute", quotaLimit: "Ilimitado" },
    { id: "ollama", name: "Ollama (VPS local)", quotaLimit: "Ilimitado" },
    { id: "heuristica", name: "Heuristica", quotaLimit: "Ilimitado" }
  ];

  // Normalizar la lista de proveedores que vino de la DB para retrocompatibilidad
  const iaPorProveedorHoyNormalizado = [];
  iaPorProveedorHoy.forEach((r) => {
    let provId = r.proveedor;
    
    if (provId === "gemini") {
      provId = iaStatus.activeKeyType === "paga" ? "gemini_pago" : "gemini_gratis";
    } else if (provId === "dialogo_hilo" || provId === "registrar_inventario_pendiente" || provId === "tool_first" || provId === "fallback_local") {
      provId = "heuristica";
    } else if (provId === "precio_agent" || provId === "agent_unified" || provId === "agent_turn" || provId === "agent_gate") {
      provId = iaStatus.activeKeyType === "paga" ? "gemini_pago" : "gemini_gratis";
    }

    const exist = iaPorProveedorHoyNormalizado.find(x => x.proveedor === provId);
    if (exist) {
      exist.total += r.total;
      exist.sinContexto += r.sinContexto;
    } else {
      iaPorProveedorHoyNormalizado.push({
        proveedor: provId,
        total: r.total,
        sinContexto: r.sinContexto
      });
    }
  });

  // Compilar el breakdown completo garantizando que existan las 7 IAs
  const breakdownIAs = targetProviders.map((p) => {
    const provData = iaPorProveedorHoyNormalizado.find(x => x.proveedor === p.id);
    const hasRateLimitErr = rateLimitPorProveedorHoy.some(x => {
      const provClean = String(x.proveedor).toLowerCase();
      if (p.id === "gemini_gratis" && provClean === "gemini") {
        return iaStatus.activeKeyType === "paga" || x.total > 0;
      }
      return provClean === p.id || provClean === p.id.replace("gemini_", "");
    });

    const quotaExceeded = p.id === "gemini_gratis" 
      ? iaStatus.activeKeyType === "paga"
      : hasRateLimitErr;

    return {
      id: p.id,
      nombre: p.name,
      totalHoy: provData ? provData.total : 0,
      sinContextoHoy: provData ? provData.sinContexto : 0,
      limiteCuota: p.quotaLimit,
      cuotaExcedida: quotaExceeded
    };
  });

  const alertasCuotaActiva = breakdownIAs.some(x => x.cuotaExcedida);

  return {
    iaStatus,
    estado: {
      whatsapp: obtenerEstadoWhatsapp(),
      whatsappDetalle: obtenerEstadoWhatsappDetalle(),
      db: dbNow.rows[0]?.now ? "ok" : "error",
      cronRecolector: "activo",
      cronEnviador: "activo",
    },
    actualizacion: {
      dbNow: dbNow.rows[0]?.now || null,
      ultimaRecoleccion: ultimaRecoleccion.rows[0]?.ts || null,
      ultimaCotizacion: ultimaCotizacion.rows[0]?.fecha || null,
      ultimaConsulta: ultimaConsulta.rows[0]?.ts || null,
      ultimaActualizacionClima: ultimaActualizacionClima.rows[0]?.ts || null,
    },
    usuarios: {
      registrados: usuarios.rows[0]?.total || 0,
      activos: usuarios.rows[0]?.activos || 0,
      onboardingEnCurso: onboarding.rows[0]?.en_curso || 0,
      porPlan: planes.rows,
    },
    resumenesHoy: {
      generados: resumenesHoy.rows[0]?.generados || 0,
      enviados: resumenesHoy.rows[0]?.enviados || 0,
      gratis: {
        total: resumenesGratisHoy.rows[0]?.total || 0,
        postRegistro: resumenesGratisHoy.rows[0]?.post_registro || 0,
        lunesJueves: resumenesGratisHoy.rows[0]?.lunes_jueves || 0,
      },
    },
    alertas: {
      total: alertasResumen.rows[0]?.total || 0,
      activas: alertasResumen.rows[0]?.activas || 0,
      disparadas: alertasResumen.rows[0]?.disparadas || 0,
      porUsuario: alertasPorUsuario.rows,
    },
    consultasHoy: {
      conIA: conIAHoy,
      fallbackLocal: fallbackHoy,
    },
    interacciones: {
      consultasTotal: interacciones.rows[0]?.total_consultas || 0,
      consultasHoy: interacciones.rows[0]?.consultas_hoy || 0,
      consultas7d: interacciones.rows[0]?.consultas_7d || 0,
      porUsuario: interaccionesPorUsuario.rows,
    },
    ia: {
      ...iaConfig,
      healthCheck: iaHealthCheckResult.rows[0] ? {
        status: iaHealthCheckResult.rows[0].status,
        verificadoEn: iaHealthCheckResult.rows[0].verificado_en,
        errorMsg: iaHealthCheckResult.rows[0].error_msg
      } : null,
      metricas: {
        consultasConIAHoy: conIAHoy,
        consultasFallbackHoy: fallbackHoy,
        porcentajeIAHoy,
        porcentajeFallbackHoy,
        respuestasIASinContextoHoy: sinContextoHoy,
        respuestasIASinContexto7d: sinContexto7d,
        porProveedorHoy: iaPorProveedorHoy,
        breakdownIAs,
        alertasCuotaActiva,
        rateLimit: {
          totalHoy: rateLimitTotalHoy,
          porProveedorHoy: rateLimitPorProveedorHoy,
          serie7d: rateLimitSerie7d,
        },
        proveedorMix7d: iaProveedorMix7d.rows || [],
      },
      tokens: {
        consultasTotal: tokensGlobal.rows[0]?.tokens_consultas_total || 0,
        consultasHoy: tokensGlobal.rows[0]?.tokens_consultas_hoy || 0,
        porUsuario: tokensPorUsuario.rows,
      },
    },
    datos: {
      frescura: {
        precios: {
          ultimaActualizacion: tsPrecios,
          minutosDesde: minutosDesde(tsPrecios),
        },
        tipoCambio: {
          ultimaActualizacion: tsTipoCambio,
          minutosDesde: minutosDesde(tsTipoCambio),
        },
        clima: {
          ultimaActualizacion: tsClima,
          minutosDesde: minutosDesde(tsClima),
        },
      },
      fuentes,
      fuentesEstado: fuentesEstado.agrupadas,
      cobertura: {
        porcentaje: coberturaPct,
        temas,
      },
      futuros: {
        matbaFuentesHoy: matbaFuentesHoy.rows,
      },
    },
    agentRuntime: buildAgentRuntimeSnapshot(),
  };
};

/**
 * Obtiene candidatos para campañas de outreach (usuarios que no hablan hace X días).
 */
const getOutreachCandidatos = async ({ diasInactividad = 7, limit = 100 } = {}) => {
  const dRaw = Number(diasInactividad);
  const d = Number.isFinite(dRaw) ? Math.max(0, Math.min(365, dRaw)) : 7;
  const lim = Math.max(1, Math.min(1000, Number(limit) || 100));

  const result = await queryDashboardSeguro(
    "outreach_candidatos",
    `
      WITH ult_con AS (
        SELECT usuario_id, MAX(creado_en) AS fecha
        FROM historial_consultas
        GROUP BY usuario_id
      )
      SELECT
        u.id, u.nombre,
        COALESCE(NULLIF(u.whatsapp_real, ''), u.whatsapp) AS whatsapp,
        u.whatsapp_jid,
        u.provincia, u.partido, u.plan, u.activo, u.creado_en,
        uc.fecha AS ultima_interaccion,
        EXTRACT(DAY FROM (NOW() - uc.fecha))::int AS dias_inactivo
      FROM usuarios u
      LEFT JOIN ult_con uc ON uc.usuario_id = u.id
      WHERE u.activo = true
        AND ($1::int = 0 OR uc.fecha < NOW() - ($1::int * INTERVAL '1 day'))
        AND u.id NOT IN (1, (SELECT id FROM usuarios WHERE whatsapp = $2))
      ORDER BY uc.fecha DESC NULLS LAST, u.creado_en DESC
      LIMIT $3
    `,
    [d, WHATSAPP_SISTEMA, lim]
  );

  return result.rows || [];
};

const getUltimosUsuarios = async (limit = 20) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 2000);
  const result = await query(
    `
      SELECT
        u.id, u.nombre,
        COALESCE(NULLIF(u.whatsapp_real, ''), u.whatsapp) AS whatsapp,
        u.whatsapp_real, u.whatsapp_jid,
        u.provincia, u.partido, u.plan, u.activo, u.creado_en,
        (
          SELECT pp.tipo
          FROM perfil_productivo pp
          WHERE pp.usuario_id = u.id AND pp.activo = true
          ORDER BY pp.id DESC
          LIMIT 1
        ) AS perfil_productivo,
        COUNT(h.id)::int AS consultas_total,
        COALESCE(SUM(h.tokens_usados), 0)::int AS tokens_consultas,
        MAX(h.creado_en) AS ultima_consulta,
        (
          SELECT COUNT(*)::int
          FROM usuario_cultivos uc
          WHERE uc.usuario_id = u.id AND uc.activo = true
        ) AS cultivos_activos,
        (
          SELECT COUNT(*)::int
          FROM stock_ganadero sg
          WHERE sg.usuario_id = u.id
        ) AS movimientos_stock_ganadero
      FROM usuarios u
      LEFT JOIN historial_consultas h ON h.usuario_id = u.id
      GROUP BY u.id
      ORDER BY u.creado_en DESC
      LIMIT $1
    `,
    [safeLimit]
  );
  return result.rows;
};

const BROADCAST_JOB_TTL_MS = 60 * 60 * 1000;
const broadcastJobs = new Map();

const limpiarBroadcastJobsViejos = () => {
  const now = Date.now();
  for (const [id, j] of broadcastJobs) {
    const ref = j.finishedAt || j.startedAt || now;
    if (now - ref > BROADCAST_JOB_TTL_MS) broadcastJobs.delete(id);
  }
  if (broadcastJobs.size > 400) {
    const entries = [...broadcastJobs.entries()].sort((a, b) => (a[1].startedAt || 0) - (b[1].startedAt || 0));
    while (entries.length > 250) {
      const [oldId] = entries.shift();
      broadcastJobs.delete(oldId);
    }
  }
};

/**
 * Encola el envío y devuelve jobId al toque (evita timeouts de proxy/nginx en POST largos).
 * El progreso se consulta con obtenerEstadoEnvioMasivoJob.
 */
const iniciarEnvioMasivoAdminAsync = ({ usuarioIds, mensaje }) => {
  const texto = String(mensaje || "").trim();
  if (!texto) throw new Error("Mensaje vacío");
  const ids = [...new Set((usuarioIds || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) throw new Error("Sin destinatarios");

  limpiarBroadcastJobsViejos();
  const jobId = crypto.randomUUID();
  const startedAt = Date.now();
  broadcastJobs.set(jobId, {
    estado: "running",
    startedAt,
    total: ids.length,
    enviados: null,
    fallidos: null,
    resultados: null,
    error: null,
  });

  setImmediate(() => {
    enviarMensajesMasivosAdmin({ usuarioIds: ids, mensaje: texto })
      .then((out) => {
        broadcastJobs.set(jobId, {
          estado: "listo",
          startedAt,
          finishedAt: Date.now(),
          total: out.total,
          enviados: out.enviados,
          fallidos: out.fallidos,
          resultados: out.resultados,
          error: null,
        });
      })
      .catch((e) => {
        broadcastJobs.set(jobId, {
          estado: "error",
          startedAt,
          finishedAt: Date.now(),
          total: ids.length,
          enviados: 0,
          fallidos: 0,
          resultados: [],
          error: e?.message || String(e),
        });
      });
  });

  return { jobId, total: ids.length };
};

const obtenerEstadoEnvioMasivoJob = (jobId) => {
  const id = String(jobId || "").trim();
  if (!id) return null;
  return broadcastJobs.get(id) || null;
};

/** Envío masivo desde admin: uno a uno con delay; registra en envios_whatsapp (resumen_id NULL). */
const enviarMensajesMasivosAdmin = async ({ usuarioIds, mensaje }) => {
  const texto = String(mensaje || "").trim();
  if (!texto) throw new Error("Mensaje vacío");
  const ids = [...new Set((usuarioIds || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) throw new Error("Sin destinatarios");

  const { esperarClienteListo } = require("../config/whatsapp");
  const readyMs = Math.min(
    Math.max(Number(process.env.ADMIN_BROADCAST_WHATSAPP_READY_MS) || 180_000, 30_000),
    600_000
  );
  try {
    await esperarClienteListo(readyMs);
  } catch (e) {
    const msg = e?.message || String(e);
    throw new Error(
      `WhatsApp no está listo para el envío masivo (${msg}). En el VPS: sesión conectada, \`pm2 logs agrohabilis\` o escanear QR si corresponde.`
    );
  }

  const sistemaId = await obtenerUsuarioSistemaId();
  
  // Safe default: random delay between 30 and 60 seconds (user-configurable in .env)
  const delayMin = Number(process.env.ADMIN_BROADCAST_DELAY_MIN_MS) || 30000;
  const delayMax = Number(process.env.ADMIN_BROADCAST_DELAY_MAX_MS) || 60000;

  const resultados = [];
  for (let i = 0; i < ids.length; i++) {
    const usuarioId = ids[i];
    if (usuarioId === 1 || (sistemaId && usuarioId === sistemaId)) {
      resultados.push({ usuarioId, ok: false, error: "omitido_sistema" });
      continue;
    }
    const uRes = await query(
      `
        SELECT id, nombre, whatsapp, whatsapp_jid, whatsapp_real
        FROM usuarios
        WHERE id = $1
        LIMIT 1
      `,
      [usuarioId]
    );
    const u = uRes.rows[0];
    if (!u) {
      resultados.push({ usuarioId, ok: false, error: "no_encontrado" });
      continue;
    }
    if (u.whatsapp === WHATSAPP_SISTEMA) {
      resultados.push({ usuarioId, ok: false, error: "omitido_sistema" });
      continue;
    }
    const destino = resolverDestinoWhatsappUsuario(u);
    if (!destino) {
      await query(
        `
          INSERT INTO envios_whatsapp (usuario_id, resumen_id, estado, error_msg)
          VALUES ($1, NULL, 'error', $2)
        `,
        [usuarioId, "sin_destino_whatsapp"]
      );
      resultados.push({ usuarioId, ok: false, error: "sin_destino_whatsapp" });
      continue;
    }
    try {
      const { sendMessage } = require("../config/whatsapp");
      const textoFinal = interpolarMensajeMasivo(texto, u);
      
      // Typing effect (Escribiendo...)
      try {
        const chat = await client.getChatById(destino);
        if (chat) {
          await chat.sendStateTyping();
          // Simulate typing for a few seconds based on the message length (15ms per character), min 2s, max 7s
          const typingMs = Math.min(7000, Math.max(2000, textoFinal.length * 15));
          await sleep(typingMs);
        }
      } catch (typingErr) {
        console.warn(`[Broadcast] No se pudo activar el estado Escribiendo para ${destino}:`, typingErr.message);
      }

      await sendMessage(destino, textoFinal);
      await query(
        `
          INSERT INTO envios_whatsapp (usuario_id, resumen_id, estado, error_msg)
          VALUES ($1, NULL, 'ok', NULL)
        `,
        [usuarioId]
      );
      await registrarEnvioMasivoEnHistorial({
        usuarioId,
        whatsappRaw: u.whatsapp_real || u.whatsapp || "",
        textoFinal,
      });
      resultados.push({ usuarioId, ok: true });
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 2000);
      await query(
        `
          INSERT INTO envios_whatsapp (usuario_id, resumen_id, estado, error_msg)
          VALUES ($1, NULL, 'error', $2)
        `,
        [usuarioId, msg]
      );
      resultados.push({ usuarioId, ok: false, error: msg });
    }
    
    // Random delay between delayMin and delayMax for human-like intervals
    if (i < ids.length - 1) {
      const randomDelay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
      await sleep(randomDelay);
    }
  }

  const enviados = resultados.filter((r) => r.ok).length;
  return {
    enviados,
    fallidos: resultados.length - enviados,
    total: resultados.length,
    resultados,
  };
};

const getAdminUserDetail = async ({ usuarioId, whatsapp }) => {
  let usuarioResult;
  if (usuarioId) {
    usuarioResult = await query(
      `
        SELECT id, nombre, whatsapp, whatsapp_jid, whatsapp_real, provincia, partido, plan, activo, lat, lng, creado_en
        FROM usuarios
        WHERE id = $1
        LIMIT 1
      `,
      [usuarioId]
    );
  } else if (whatsapp) {
    usuarioResult = await query(
      `
        SELECT id, nombre, whatsapp, whatsapp_jid, whatsapp_real, provincia, partido, plan, activo, lat, lng, creado_en
        FROM usuarios
        WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
           OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = $1
           OR regexp_replace(COALESCE(whatsapp_jid, ''), '\\D', '', 'g') = $1
        LIMIT 1
      `,
        [String(whatsapp).replace(/\D/g, "")]
    );
  } else {
    throw new Error("Falta usuarioId o whatsapp");
  }

  const usuario = usuarioResult.rows[0];
  if (!usuario) return null;

  const [
    cultivos,
    actividad,
    ultConsultas,
    ultResumenes,
    ultEnvios,
    onboardingEstado,
    alertasUsuario,
    perfilProductivo,
    stockGanadero,
  ] =
    await Promise.all([
      query(
        `
          SELECT cultivo, hectareas, costo_por_ha, activo
          FROM usuario_cultivos
          WHERE usuario_id = $1
          ORDER BY cultivo
        `,
        [usuario.id]
      ),
      query(
        `
          SELECT
            COUNT(*)::int AS consultas_total,
            COUNT(*) FILTER (WHERE creado_en::date = CURRENT_DATE)::int AS consultas_hoy,
            COALESCE(SUM(tokens_usados), 0)::int AS tokens_consultas_total,
            COALESCE(SUM(tokens_usados) FILTER (WHERE creado_en::date = CURRENT_DATE), 0)::int AS tokens_consultas_hoy,
            MAX(creado_en) AS ultima_consulta
          FROM historial_consultas
          WHERE usuario_id = $1
        `,
        [usuario.id]
      ),
      query(
        `
          SELECT pregunta, respuesta, tokens_usados, creado_en
          FROM historial_consultas
          WHERE usuario_id = $1
          ORDER BY creado_en DESC
          LIMIT 20
        `,
        [usuario.id]
      ),
      query(
        `
          SELECT fecha, contenido, enviado_wp, enviado_en, tokens_usados, creado_en
          FROM resumenes
          WHERE usuario_id = $1
          ORDER BY fecha DESC
          LIMIT 20
        `,
        [usuario.id]
      ),
      query(
        `
          SELECT estado, error_msg, creado_en
          FROM envios_whatsapp
          WHERE usuario_id = $1
          ORDER BY creado_en DESC
          LIMIT 20
        `,
        [usuario.id]
      ),
      query(
        `
          SELECT paso_actual, completado, actualizado_en, datos_temporales
          FROM onboarding_estado
          WHERE whatsapp = $1
          LIMIT 1
        `,
        [usuario.whatsapp]
      ),
      query(
        `
          SELECT
            id, cultivo, tipo, valor_objetivo, activa, disparada, disparada_en, creado_en
          FROM alertas
          WHERE usuario_id = $1
          ORDER BY id DESC
          LIMIT 30
        `,
        [usuario.id]
      ),
      query(
        `
          SELECT tipo, activo
          FROM perfil_productivo
          WHERE usuario_id = $1
          ORDER BY id DESC
          LIMIT 1
        `,
        [usuario.id]
      ),
      query(
        `
          SELECT categoria, cantidad, fecha
          FROM stock_ganadero
          WHERE usuario_id = $1
            AND fecha = (
              SELECT MAX(fecha)
              FROM stock_ganadero
              WHERE usuario_id = $1
            )
          ORDER BY categoria
        `,
        [usuario.id]
      ),
    ]);

  return {
    usuario,
    cultivos: cultivos.rows,
    actividad: actividad.rows[0] || {},
    onboarding: onboardingEstado.rows[0] || null,
    perfilProductivo: perfilProductivo.rows[0] || null,
    stockGanadero: stockGanadero.rows || [],
    historialConsultas: ultConsultas.rows,
    resumenes: ultResumenes.rows,
    enviosWhatsapp: ultEnvios.rows,
    alertas: alertasUsuario.rows,
  };
};

const getPendientesRegistro = async (limit = 50) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 300);
  const result = await query(
    `
      SELECT
        o.whatsapp,
        o.paso_actual,
        o.completado,
        o.actualizado_en,
        COALESCE(
          (
            SELECT h.creado_en
            FROM historial_consultas h
            WHERE regexp_replace(COALESCE(h.whatsapp,''), '\\D', '', 'g') =
                  regexp_replace(COALESCE(o.whatsapp,''), '\\D', '', 'g')
            ORDER BY h.creado_en DESC
            LIMIT 1
          ),
          NULL
        ) AS ultima_interaccion,
        COALESCE(
          (
            SELECT b.bot_activo
            FROM whatsapp_bot_control b
            WHERE regexp_replace(COALESCE(b.whatsapp,''), '\\D', '', 'g') =
                  regexp_replace(COALESCE(o.whatsapp,''), '\\D', '', 'g')
            LIMIT 1
          ),
          true
        ) AS bot_activo
      FROM onboarding_estado o
      LEFT JOIN usuarios u
        ON regexp_replace(COALESCE(u.whatsapp,''), '\\D', '', 'g') =
           regexp_replace(COALESCE(o.whatsapp,''), '\\D', '', 'g')
      WHERE u.id IS NULL
      ORDER BY o.actualizado_en DESC
      LIMIT $1
    `,
    [safeLimit]
  );
  return result.rows;
};

const getClienteDashboard = async ({ usuarioId }) => {
  const id = Number(usuarioId);
  if (!id) throw new Error("Usuario invalido");
  const usuarioResult = await query(
    `
      SELECT
        u.id,
        u.nombre,
        u.email,
        u.whatsapp,
        u.whatsapp_jid,
        u.whatsapp_real,
        u.provincia,
        u.partido,
        u.plan,
        u.activo,
        u.lat,
        u.lng,
        u.creado_en,
        u.tipo_comercializacion,
        u.noticias_cantidad_pref,
        u.plan_activo_hasta,
        COALESCE(b.bot_activo, true) AS bot_whatsapp_activo
      FROM usuarios u
      LEFT JOIN whatsapp_bot_control b
        ON regexp_replace(COALESCE(b.whatsapp, ''), '\\D', '', 'g') =
           regexp_replace(COALESCE(u.whatsapp_real, u.whatsapp, ''), '\\D', '', 'g')
      WHERE u.id = $1
      LIMIT 1
    `,
    [id]
  );
  const usuario = usuarioResult.rows[0];
  if (!usuario) return null;

  const [
    cultivos,
    lotes,
    zonas,
    ultConsultas,
    ultResumenes,
    actividad,
    preciosHoy,
    tipoCambio,
    climaZona,
    enviosWhatsapp,
    alertas,
    ganaderiaPerfil,
    perfilesProductivos,
    gastosRecientes,
    ventasRecientes,
    suscripcionMp,
    animalesIndividuales,
    animalesEventos,
    telemetriaConexiones,
    telemetriaLabores,
    eventosPastura,
  ] = await Promise.all([
    query(
      `
        SELECT 
          l.id,
          l.nombre AS lote_nombre,
          l.cliente,
          l.firma,
          l.provincia,
          l.partido,
          l.tipo,
          l.cultivo,
          l.hectareas,
          l.variedad,
          l.fecha_siembra,
          l.densidad,
          l.rinde_esperado,
          l.arrendado,
          true AS activo,
          (
            SELECT m.payload->>'lote_semilla'
            FROM inventario_movimiento m
            WHERE m.lote_id = l.id AND m.dominio = 'cultivo' AND m.estado = 'confirmado'
            ORDER BY m.creado_en DESC LIMIT 1
          ) AS lote_semilla,
          (
            SELECT (m.payload->>'humedad')::numeric
            FROM inventario_movimiento m
            WHERE m.lote_id = l.id AND m.dominio = 'cultivo' AND m.estado = 'confirmado'
            ORDER BY m.creado_en DESC LIMIT 1
          ) AS humedad,
          (
            SELECT (m.payload->>'costo_arrendamiento')::numeric
            FROM inventario_movimiento m
            WHERE m.lote_id = l.id AND m.dominio = 'cultivo' AND m.estado = 'confirmado'
            ORDER BY m.creado_en DESC LIMIT 1
          ) AS costo_arrendamiento
        FROM lotes l
        WHERE l.usuario_id = $1 AND l.cultivo IS NOT NULL AND l.cultivo <> ''
        ORDER BY l.nombre
      `,
      [usuario.id]
    ),
    query(
      `SELECT id, nombre, hectareas, cultivo, arrendado, cliente, firma, provincia, partido, tipo FROM lotes WHERE usuario_id = $1 ORDER BY nombre`,
      [usuario.id]
    ),
    query(
      `SELECT id, provincia, partido, lat, lng, prioridad, activa FROM usuario_zonas WHERE usuario_id = $1 ORDER BY prioridad ASC`,
      [usuario.id]
    ),
    query(
      `
        SELECT pregunta, respuesta, tokens_usados, creado_en
        FROM historial_consultas
        WHERE usuario_id = $1
        ORDER BY creado_en DESC
        LIMIT 10
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT fecha, enviado_wp, creado_en, tokens_usados
        FROM resumenes
        WHERE usuario_id = $1
        ORDER BY fecha DESC
        LIMIT 10
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT
          COUNT(*)::int AS consultas_total,
          COUNT(*) FILTER (WHERE creado_en::date = CURRENT_DATE)::int AS consultas_hoy,
          COALESCE(SUM(tokens_usados), 0)::int AS tokens_total,
          COALESCE(SUM(tokens_usados) FILTER (WHERE creado_en::date = CURRENT_DATE), 0)::int AS tokens_hoy,
          MAX(creado_en) AS ultima_consulta
        FROM historial_consultas
        WHERE usuario_id = $1
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT cultivo, mercado, precio, moneda, fecha
        FROM precios
        WHERE fecha = (SELECT MAX(fecha) FROM precios)
          AND LOWER(cultivo) IN (
            SELECT LOWER(cultivo)
            FROM usuario_cultivos
            WHERE usuario_id = $1 AND activo = true
          )
        ORDER BY cultivo, mercado
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT tipo, valor, fecha
        FROM tipo_cambio
        WHERE fecha = (SELECT MAX(fecha) FROM tipo_cambio)
        ORDER BY tipo
      `
    ),
    (async () => {
      if (usuario.lat != null && usuario.lng != null) {
        const { obtenerClimaFresco } = require("../templates/base");
        try {
          const res = await obtenerClimaFresco(usuario.lat, usuario.lng);
          return res?.items || [];
        } catch (e) {
          console.error("Fallo obtenerClimaFresco en dashboard cliente:", e.message);
        }
      }
      return [];
    })(),
    query(
      `
        SELECT estado, error_msg, creado_en
        FROM envios_whatsapp
        WHERE usuario_id = $1
        ORDER BY creado_en DESC
        LIMIT 10
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT id, cultivo, tipo, valor_objetivo, activa, disparada, disparada_en, creado_en
        FROM alertas
        WHERE usuario_id = $1
        ORDER BY activa DESC, creado_en DESC
        LIMIT 30
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT 
          s.lote_id,
          l.nombre AS lote_nombre,
          l.firma,
          l.cliente,
          l.provincia,
          l.partido,
          l.tipo AS lote_tipo,
          split_part(s.item_clave, ':', 2) AS especie,
          COALESCE(NULLIF(s.etiqueta, ''), split_part(s.item_clave, ':', 3)) AS categoria,
          SUM(s.cantidad)::numeric AS cantidad_estimada,
          true AS activo,
          MAX(m.payload->>'raza') AS raza,
          MAX((m.payload->>'peso_promedio')::numeric) AS peso_promedio,
          MAX(m.payload->>'sanidad_tratamiento') AS sanidad_tratamiento,
          MAX((m.payload->>'dias_carencia')::numeric) AS dias_carencia
        FROM inventario_saldo s
        LEFT JOIN inventario_movimiento m ON m.id = s.ultimo_movimiento_id
        LEFT JOIN lotes l ON l.id = s.lote_id
        WHERE s.usuario_id = $1 AND s.dominio = 'ganado'
        GROUP BY s.lote_id, l.nombre, l.firma, l.cliente, l.provincia, l.partido, l.tipo, s.item_clave, s.etiqueta
        ORDER BY especie, categoria
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT tipo, activo
        FROM perfil_productivo
        WHERE usuario_id = $1
        ORDER BY tipo
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT g.id, g.perfil, g.categoria, g.descripcion, g.monto, g.moneda, g.fecha, g.creado_en, g.lote_id,
               l.nombre AS lote_nombre, l.firma, l.cliente, l.provincia, l.partido, l.tipo AS lote_tipo
        FROM gastos g
        LEFT JOIN lotes l ON l.id = g.lote_id
        WHERE g.usuario_id = $1
        ORDER BY g.fecha DESC, g.creado_en DESC
        LIMIT 20
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT id, perfil, producto, cantidad, unidad, precio_unitario, monto_total, moneda, fecha, creado_en
        FROM ventas
        WHERE usuario_id = $1
        ORDER BY fecha DESC, creado_en DESC
        LIMIT 20
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT mp_status, plan_objetivo, actualizado_en
        FROM suscripciones
        WHERE usuario_id = $1
        ORDER BY creado_en DESC
        LIMIT 1
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT a.id, a.caravana, a.categoria, a.estado, a.peso, a.raza, a.fecha_ingreso, a.lote_id,
               l.nombre AS lote_nombre, l.firma, l.cliente, l.provincia, l.partido, l.tipo AS lote_tipo
        FROM animales_individuales a
        LEFT JOIN lotes l ON l.id = a.lote_id
        WHERE a.usuario_id = $1
        ORDER BY a.actualizado_en DESC
        LIMIT 50
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT e.id, e.animal_id, a.caravana, e.tipo_evento, e.fecha, e.valor_numerico, e.valor_texto, e.observaciones,
               a.lote_id, l.nombre AS lote_nombre, l.firma, l.cliente, l.provincia, l.partido, l.tipo AS lote_tipo
        FROM animales_eventos e
        JOIN animales_individuales a ON a.id = e.animal_id
        LEFT JOIN lotes l ON l.id = a.lote_id
        WHERE e.usuario_id = $1
        ORDER BY e.fecha DESC, e.creado_en DESC
        LIMIT 50
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT id, proveedor, estado, creado_en, actualizado_en
        FROM telemetria_conexiones
        WHERE usuario_id = $1
      `,
      [usuario.id]
    ),
    query(
      `
        SELECT 
          id, 
          tipo_labor, 
          creado_en AS fecha_inicio, 
          creado_en AS fecha_fin, 
          hectareas_reales, 
          0.0 AS velocidad_promedio,
          producto_insumo AS insumo_nombre, 
          dosis_promedio,
          CASE 
            WHEN tipo_labor = 'SIEMBRA' THEN 'sem/ha'
            WHEN tipo_labor = 'PULVERIZACION' THEN 'l/ha'
            ELSE 'tn/ha'
          END AS unidad_dosis,
          'Visión Asistente' AS marca_maquinaria,
          'WhatsApp OCR' AS modelo_maquinaria,
          lote_nombre
        FROM registro_labores_maquinaria
        WHERE usuario_id = $1
        ORDER BY creado_en DESC
        LIMIT 50
      `,
      [usuario.id]
    ),
    (async () => {
      try {
        const { obtenerUltimosEventosPastura } = require("./rutas/pasturas");
        const res = await obtenerUltimosEventosPastura(usuario.id);
        return res || [];
      } catch (e) {
        return [];
      }
    })(),
  ]);

  const { getGeminiApiKeyStatus } = require("./gemini_keys");
  const iaStatus = getGeminiApiKeyStatus();

  return {
    usuario,
    iaStatus,
    actividad: actividad.rows[0] || {},
    cultivos: cultivos.rows,
    lotes: lotes.rows,
    zonas: zonas.rows,
    precios: preciosHoy.rows,
    tipoCambio: tipoCambio.rows,
    clima: climaZona,
    historialConsultas: ultConsultas.rows,
    resumenes: ultResumenes.rows,
    enviosWhatsapp: enviosWhatsapp.rows,
    alertas: alertas.rows,
    ganaderiaPerfil: ganaderiaPerfil.rows,
    perfilesProductivos: perfilesProductivos.rows,
    gastos: gastosRecientes.rows,
    ventas: ventasRecientes.rows,
    suscripcionMp: suscripcionMp.rows[0] || null,
    animalesIndividuales: animalesIndividuales.rows,
    animalesEventos: animalesEventos.rows,
    telemetriaConexiones: telemetriaConexiones.rows,
    telemetriaLabores: telemetriaLabores.rows,
    eventosPastura: eventosPastura,
    ia: {
      estado: [
        process.env.OPENROUTER_API_KEY?.trim(),
        process.env.GROQ_API_KEY?.trim(),
        process.env.GEMINI_API_KEY?.trim(),
      ].some(Boolean)
        ? "operativa"
        : "sin_proveedores",
      ordenFallback: [
        process.env.OPENROUTER_API_KEY?.trim()
          ? `OpenRouter(${process.env.OPENROUTER_MODEL || "openrouter/free"})`
          : null,
        process.env.GROQ_API_KEY?.trim()
          ? `Groq(${process.env.GROQ_MODEL || "llama-3.1-8b-instant"})`
          : null,
        process.env.GEMINI_API_KEY?.trim()
          ? `Gemini(${process.env.GEMINI_MODEL || "gemini-flash-latest"})`
          : null,
      ].filter(Boolean),
    },
  };
};

/** Últimas consultas con bloque `agent_plan` en ia_provider_trace (solo admin). */
const getUltimosPlanesAgente = async (limit = 40) => {
  const lim = Math.min(200, Math.max(1, Math.floor(Number(limit) || 40)));
  const r = await queryDashboardSeguro(
    "agent_plan",
    `
      SELECT id, whatsapp, usuario_id, creado_en, ia_provider, ia_provider_trace
      FROM historial_consultas
      WHERE jsonb_typeof(COALESCE(ia_provider_trace, '[]'::jsonb)) = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(ia_provider_trace, '[]'::jsonb)) AS elem
          WHERE elem->>'type' = 'agent_plan'
            AND jsonb_typeof(elem->'steps') = 'array'
            AND jsonb_array_length(elem->'steps') > 0
        )
      ORDER BY id DESC
      LIMIT $1
    `,
    [lim]
  );
  const rows = [];
  for (const row of r.rows || []) {
    let trace = row.ia_provider_trace;
    if (typeof trace === "string") {
      try {
        trace = JSON.parse(trace);
      } catch {
        trace = null;
      }
    }
    let plan = null;
    if (Array.isArray(trace)) {
      const block = trace.find((x) => x && x.type === "agent_plan" && Array.isArray(x.steps));
      if (block) plan = block.steps;
    }
    if (plan && plan.length) {
      rows.push({
        id: row.id,
        whatsapp: row.whatsapp,
        usuario_id: row.usuario_id,
        creado_en: row.creado_en,
        ia_provider: row.ia_provider,
        pasos: plan,
      });
    }
  }
  return rows;
};

/** Resumen tabla `agent_tarea_fila` (cola consulta async). Si la tabla no existe, devuelve vacío. */
const getAgentColaResumen = async () => {
  const counts = await queryDashboardSeguro(
    "agent_cola_counts",
    `
      SELECT estado, COUNT(*)::int AS n
      FROM agent_tarea_fila
      GROUP BY estado
    `
  );
  const recent = await queryDashboardSeguro(
    "agent_cola_recent",
    `
      SELECT id, tipo, estado, intentos, creado_en, iniciado_en, terminado_en,
             LEFT(COALESCE(payload->>'jid',''), 36) AS jid_preview,
             LEFT(COALESCE(payload->>'consulta',''), 72) AS consulta_preview,
             LEFT(COALESCE(error_text,''), 100) AS error_preview
      FROM agent_tarea_fila
      ORDER BY id DESC
      LIMIT 25
    `
  );
  const byEstado = {};
  for (const row of counts.rows || []) {
    byEstado[row.estado] = row.n;
  }
  return { byEstado, rows: recent.rows || [] };
};

module.exports = {
  getAdminDashboard,
  getUltimosUsuarios,
  getAdminUserDetail,
  getPendientesRegistro,
  getClienteDashboard,
  enviarMensajesMasivosAdmin,
  iniciarEnvioMasivoAdminAsync,
  obtenerEstadoEnvioMasivoJob,
  getUltimosPlanesAgente,
  getAgentColaResumen,
  getAgentRuntimeAdmin,
  getIaProveedorMixDias,
  getOutreachCandidatos,
};
