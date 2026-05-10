const { query } = require("../config/database");

const sqlPlanEfectivo = `
  CASE
    WHEN LOWER(COALESCE(u.plan, 'gratis')) = 'pro' THEN 'pro'
    WHEN LOWER(COALESCE(u.plan, 'gratis')) IN ('basico','básico') THEN 'basico'
    WHEN LOWER(COALESCE(u.plan, 'gratis')) = 'gratis'
      AND u.plan_activo_hasta IS NOT NULL
      AND u.plan_activo_hasta >= NOW() THEN 'basico'
    ELSE 'gratis'
  END
`;

const sqlRegion = `
  CASE
    WHEN LOWER(COALESCE(u.provincia,'')) IN (
      'buenos aires','la pampa','rio negro','río negro','neuquen','neuquén',
      'chubut','santa cruz','tierra del fuego'
    ) THEN 'sur'
    WHEN LOWER(COALESCE(u.provincia,'')) IN (
      'cordoba','córdoba','santa fe','entre rios','entre ríos','mendoza','san luis'
    ) THEN 'centro'
    WHEN LOWER(COALESCE(u.provincia,'')) IN (
      'chaco','formosa','santiago del estero','catamarca','tucuman','tucumán',
      'salta','jujuy','misiones','corrientes','la rioja'
    ) THEN 'norte'
    ELSE 'sin_region'
  END
`;

const getConsultasPorPlan = async () => {
  const result = await query(
    `
      WITH base AS (
        SELECT
          h.creado_en,
          h.pregunta,
          h.respuesta,
          u.nombre,
          ${sqlPlanEfectivo} AS plan_efectivo,
          ROW_NUMBER() OVER (
            PARTITION BY ${sqlPlanEfectivo}
            ORDER BY h.creado_en DESC
          ) AS rn
        FROM historial_consultas h
        JOIN usuarios u ON u.id = h.usuario_id
        WHERE u.whatsapp <> 'ahbl:sistema'
      )
      SELECT plan_efectivo, nombre, pregunta, respuesta, creado_en
      FROM base
      WHERE rn = 1 AND plan_efectivo IN ('gratis','basico','pro')
      ORDER BY plan_efectivo
    `
  );
  return result.rows;
};

const getResumenesPorPerfilRegion = async () => {
  const result = await query(
    `
      WITH base AS (
        SELECT
          r.creado_en,
          r.contenido,
          u.nombre,
          ${sqlRegion} AS region,
          p.tipo AS perfil,
          ROW_NUMBER() OVER (
            PARTITION BY p.tipo, ${sqlRegion}
            ORDER BY r.creado_en DESC
          ) AS rn
        FROM resumenes r
        JOIN usuarios u ON u.id = r.usuario_id
        JOIN perfil_productivo p ON p.usuario_id = u.id AND p.activo = true
        WHERE u.whatsapp <> 'ahbl:sistema'
      )
      SELECT perfil, region, nombre, contenido, creado_en
      FROM base
      WHERE rn = 1
        AND perfil IN ('agricultura','ganaderia')
        AND region IN ('sur','centro','norte')
      ORDER BY perfil, region
    `
  );
  return result.rows;
};

const getAlertasReales = async () => {
  const result = await query(
    `
      SELECT
        a.id,
        u.nombre,
        u.whatsapp,
        a.cultivo,
        a.tipo,
        a.valor_objetivo,
        a.activa,
        a.disparada,
        a.disparada_en,
        a.creado_en
      FROM alertas a
      JOIN usuarios u ON u.id = a.usuario_id
      WHERE u.whatsapp <> 'ahbl:sistema'
      ORDER BY COALESCE(a.disparada_en, a.creado_en) DESC
      LIMIT 12
    `
  );
  return result.rows;
};

const getConversacionesReales = async () => {
  const result = await query(
    `
      SELECT
        h.creado_en,
        u.nombre,
        ${sqlPlanEfectivo} AS plan_efectivo,
        h.pregunta,
        h.respuesta
      FROM historial_consultas h
      JOIN usuarios u ON u.id = h.usuario_id
      WHERE u.whatsapp <> 'ahbl:sistema'
      ORDER BY h.creado_en DESC
      LIMIT 8
    `
  );
  return result.rows;
};

const getCasosReales = async () => {
  const [consultasPorPlan, resumenesPorPerfilRegion, alertas, conversaciones] =
    await Promise.all([
      getConsultasPorPlan(),
      getResumenesPorPerfilRegion(),
      getAlertasReales(),
      getConversacionesReales(),
    ]);

  return {
    generadoEn: new Date().toISOString(),
    consultasPorPlan,
    resumenesPorPerfilRegion,
    alertas,
    conversaciones,
  };
};

module.exports = { getCasosReales };
