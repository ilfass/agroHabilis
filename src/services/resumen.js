const axios = require("axios");
const { query } = require("../config/database");
const { generarConPromptLibre } = require("./gemini");
const { actualizarUsuario, obtenerPerfil, normalizarWhatsapp } = require("../models/usuario");

const toISODate = (d) => new Date(d).toISOString().slice(0, 10);

const geocodificarZona = async ({ partido, provincia }) => {
  if (!partido || !provincia) return null;
  const response = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: {
      q: `${partido}, ${provincia}, Argentina`,
      format: "json",
      limit: 1,
    },
    timeout: 30_000,
    headers: {
      "User-Agent": "AgroHabilis/1.0 (soporte@agrohabilis.com)",
    },
    validateStatus: (s) => s === 200,
  });

  const row = Array.isArray(response.data) ? response.data[0] : null;
  if (!row) return null;
  const lat = Number(row.lat);
  const lng = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const asegurarGeolocalizacion = async (perfil) => {
  if (!perfil) return null;
  if (perfil.lat !== null && perfil.lng !== null) return perfil;

  try {
    const geo = await geocodificarZona({
      partido: perfil.partido,
      provincia: perfil.provincia,
    });
    if (!geo) return perfil;
    const actualizado = await actualizarUsuario(perfil.id, geo);
    return { ...perfil, lat: actualizado?.lat ?? geo.lat, lng: actualizado?.lng ?? geo.lng };
  } catch (error) {
    console.warn("[Resumen] No se pudo geocodificar zona:", error.message);
    return perfil;
  }
};

const obtenerPreciosCultivosUsuario = async (cultivos = []) => {
  if (!cultivos.length) return { fecha: null, items: [], variaciones: {} };

  const fechaRows = await query(
    `
      SELECT DISTINCT fecha
      FROM precios
      ORDER BY fecha DESC
      LIMIT 2
    `
  );
  const fechas = fechaRows.rows.map((r) => r.fecha).filter(Boolean);
  if (!fechas.length) return { fecha: null, items: [], variaciones: {} };

  const cultivosNorm = cultivos.map((c) => c.toLowerCase());
  const preciosRows = await query(
    `
      SELECT cultivo, moneda, fecha, AVG(precio)::numeric(12,2) AS precio_promedio
      FROM precios
      WHERE fecha = ANY($1::date[])
        AND LOWER(cultivo) = ANY($2::text[])
      GROUP BY cultivo, moneda, fecha
      ORDER BY cultivo, moneda, fecha DESC
    `,
    [fechas, cultivosNorm]
  );

  const latest = fechas[0];
  const prev = fechas[1] || null;
  const byCultivo = {};

  for (const row of preciosRows.rows) {
    const cultivo = row.cultivo;
    const moneda = row.moneda;
    if (!byCultivo[cultivo]) byCultivo[cultivo] = { cultivo };
    if (toISODate(row.fecha) === toISODate(latest)) {
      if (moneda === "ARS") byCultivo[cultivo].precio_ars = Number(row.precio_promedio);
      if (moneda === "USD") byCultivo[cultivo].precio_usd = Number(row.precio_promedio);
    }
    if (prev && toISODate(row.fecha) === toISODate(prev) && moneda === "ARS") {
      byCultivo[cultivo].precio_ars_ayer = Number(row.precio_promedio);
    }
  }

  const items = Object.values(byCultivo).map((item) => {
    const hoy = Number(item.precio_ars);
    const ayer = Number(item.precio_ars_ayer);
    const variacion =
      Number.isFinite(hoy) && Number.isFinite(ayer) ? Number((hoy - ayer).toFixed(2)) : null;
    const tieneDatoPrevio = Number.isFinite(ayer);
    const variacionTexto = tieneDatoPrevio
      ? variacion > 0
        ? `▲ ${variacion}`
        : variacion < 0
        ? `▼ ${Math.abs(variacion)}`
        : "▲ 0"
      : "▲ sin dato prev.";
    return {
      ...item,
      variacion_ars: variacion,
      tiene_dato_previo: tieneDatoPrevio,
      variacion_texto: variacionTexto,
    };
  });

  const variaciones = {};
  for (const item of items) variaciones[item.cultivo] = item.variacion_ars;

  return { fecha: latest, items, variaciones };
};

const obtenerTipoCambioDia = async () => {
  const fechaResult = await query("SELECT MAX(fecha) AS fecha FROM tipo_cambio");
  const fecha = fechaResult.rows[0]?.fecha;
  if (!fecha) return { fecha: null, items: [] };

  const result = await query(
    `
      SELECT tipo, valor, fecha
      FROM tipo_cambio
      WHERE fecha = $1
      ORDER BY tipo
    `,
    [fecha]
  );
  return { fecha, items: result.rows };
};

const obtenerClimaZona = async ({ lat, lng }) => {
  if (lat === null || lng === null || lat === undefined || lng === undefined) {
    return [];
  }
  const result = await query(
    `
      SELECT fecha, temp_min, temp_max, precipitacion, helada, descripcion
      FROM clima
      WHERE lat = $1 AND lng = $2
      ORDER BY fecha ASC
      LIMIT 7
    `,
    [lat, lng]
  );
  return result.rows;
};

const calcularMetricaCultivos = (cultivos, preciosHoy) => {
  const precioByCultivo = new Map(
    preciosHoy.map((p) => [String(p.cultivo || "").toLowerCase(), p])
  );

  return cultivos.map((c) => {
    const key = String(c.cultivo || "").toLowerCase();
    const precio = precioByCultivo.get(key);
    const precioArs = Number(precio?.precio_ars);
    const costo = Number(c.costo_por_ha);
    const margen =
      Number.isFinite(precioArs) && Number.isFinite(costo)
        ? Number((precioArs - costo).toFixed(2))
        : null;
    return {
      cultivo: c.cultivo,
      hectareas: c.hectareas,
      costo_por_ha: c.costo_por_ha,
      precio_ars: Number.isFinite(precioArs) ? precioArs : null,
      precio_usd: Number.isFinite(Number(precio?.precio_usd))
        ? Number(precio.precio_usd)
        : null,
      variacion_ars: Number.isFinite(Number(precio?.variacion_ars))
        ? Number(precio.variacion_ars)
        : null,
      margen_estimado: margen,
    };
  });
};

const guardarResumen = async ({ usuarioId, texto, tokensUsados }) => {
  const result = await query(
    `
      INSERT INTO resumenes (usuario_id, fecha, contenido, tokens_usados, enviado_wp)
      VALUES ($1, CURRENT_DATE, $2, $3, false)
      ON CONFLICT (usuario_id, fecha)
      DO UPDATE SET
        contenido = EXCLUDED.contenido,
        tokens_usados = EXCLUDED.tokens_usados,
        enviado_wp = false,
        enviado_en = NULL,
        creado_en = NOW()
      RETURNING id, usuario_id, fecha, contenido, tokens_usados, enviado_wp, enviado_en
    `,
    [usuarioId, texto, tokensUsados]
  );
  return result.rows[0];
};

const marcarResumenEnviado = async (resumenId) => {
  await query(
    `
      UPDATE resumenes
      SET enviado_wp = true, enviado_en = NOW()
      WHERE id = $1
    `,
    [resumenId]
  );
};

const obtenerPerfilPorId = async (usuarioId) => {
  const usuarioResult = await query(
    `
      SELECT id, nombre, whatsapp, provincia, partido, lat, lng, plan, activo
      FROM usuarios
      WHERE id = $1
      LIMIT 1
    `,
    [usuarioId]
  );
  const usuario = usuarioResult.rows[0];
  if (!usuario) return null;

  const cultivosResult = await query(
    `
      SELECT cultivo, hectareas, costo_por_ha
      FROM usuario_cultivos
      WHERE usuario_id = $1 AND activo = true
      ORDER BY cultivo
    `,
    [usuarioId]
  );

  return { ...usuario, cultivos: cultivosResult.rows };
};

const armarPromptResumen = ({ perfil, fecha, cultivos, precios, tipoCambio, clima }) => {
  const cultivosTexto = cultivos.map((c) => c.cultivo).join(", ") || "sin cultivos cargados";
  const hectareasTotales = cultivos.reduce((acc, c) => acc + (Number(c.hectareas) || 0), 0);

  const system = `Generá un resumen diario agropecuario para ${perfil.nombre}, 
productor de ${perfil.provincia}, partido de ${perfil.partido}.
Trabajás con ${cultivosTexto} en ${hectareasTotales || "N/D"} hectáreas.

El resumen debe tener este formato exacto:

🌾 *Buenos días, ${perfil.nombre}!*
📅 Resumen AgroHabilis - ${fecha}

💰 *PRECIOS DEL DÍA*
(listar cada cultivo con precio ARS y USD. Si hay dato de ayer, mostrar variación con ▲ o ▼. Si no hay dato previo, mostrar "▲ sin dato prev.")

💵 *TIPO DE CAMBIO*
(oficial, blue, MEP)

🌤️ *CLIMA EN ${perfil.partido || "tu zona"}*
(próximos 3 días, alertas de helada si corresponde)

📊 *TU SITUACIÓN*
(análisis breve y concreto basado en sus cultivos y costos)

💡 *CONSEJO DEL DÍA*
(una sola recomendación accionable y concreta)

Usá lenguaje simple y directo. Máximo 300 palabras.`;

  const user = [
    "Datos para el resumen (JSON):",
    JSON.stringify(
      {
        perfil_usuario: {
          nombre: perfil.nombre,
          provincia: perfil.provincia,
          partido: perfil.partido,
          lat: perfil.lat,
          lng: perfil.lng,
          cultivos,
        },
        precios_cultivos: precios,
        tipo_cambio: tipoCambio,
        clima_7_dias: clima,
      },
      null,
      2
    ),
  ].join("\n\n");

  return { system, user };
};

const generarResumen = async (usuarioOrId) => {
  let perfil = null;
  if (typeof usuarioOrId === "object" && usuarioOrId?.id) {
    perfil = await obtenerPerfilPorId(usuarioOrId.id);
  } else if (typeof usuarioOrId === "number") {
    perfil = await obtenerPerfilPorId(usuarioOrId);
  } else {
    perfil = await obtenerPerfil(normalizarWhatsapp(usuarioOrId));
  }

  if (!perfil) {
    throw new Error("No existe usuario para generar resumen");
  }

  const perfilGeo = await asegurarGeolocalizacion(perfil);
  const cultivos = perfilGeo.cultivos || [];
  const precios = await obtenerPreciosCultivosUsuario(cultivos.map((c) => c.cultivo));
  const tipoCambio = await obtenerTipoCambioDia();
  const clima = await obtenerClimaZona(perfilGeo);
  const metricas = calcularMetricaCultivos(cultivos, precios.items);
  const fechaResumen = toISODate(new Date());
  const { system, user } = armarPromptResumen({
    perfil: perfilGeo,
    fecha: fechaResumen,
    cultivos: metricas,
    precios,
    tipoCambio,
    clima,
  });

  const ia = await generarConPromptLibre({ system, user });
  const guardado = await guardarResumen({
    usuarioId: perfilGeo.id,
    texto: ia.texto,
    tokensUsados: ia.tokensUsados,
  });

  return {
    resumenId: guardado.id,
    usuario: perfilGeo,
    texto: ia.texto,
    model: ia.model,
    tokensUsados: ia.tokensUsados,
    contexto: {
      precios,
      tipoCambio,
      clima,
      metricas,
    },
  };
};

module.exports = {
  generarResumen,
  marcarResumenEnviado,
};
