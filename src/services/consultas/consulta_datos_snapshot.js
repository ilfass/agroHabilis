"use strict";

const createConsultaDatosSnapshot = ({
  queryFn: query,
  axiosHttp: axios,
  ordenarItemsTipoCambioFn: ordenarItemsTipoCambio,
  actualizarUsuarioFn: actualizarUsuario,
  logConsultaFn: logConsulta,
  obtenerClimaFn: obtenerClima,
  extraerZonaTextoFn: extraerZonaTexto,
} = {}) => {
  let _tieneCompraTipoCambio = null;
  let _tieneFuenteTipoCambio = null;

  const tieneCompraTipoCambio = async () => {
    if (_tieneCompraTipoCambio !== null) return _tieneCompraTipoCambio;
    const r = await query(
      `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tipo_cambio'
        AND column_name = 'compra'
      LIMIT 1
    `
    );
    _tieneCompraTipoCambio = Boolean(r.rows[0]);
    return _tieneCompraTipoCambio;
  };

  const tieneFuenteTipoCambio = async () => {
    if (_tieneFuenteTipoCambio !== null) return _tieneFuenteTipoCambio;
    const r = await query(
      `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tipo_cambio'
        AND column_name = 'fuente'
      LIMIT 1
    `
    );
    _tieneFuenteTipoCambio = Boolean(r.rows[0]);
    return _tieneFuenteTipoCambio;
  };

  const obtenerUltimosPreciosPorCultivos = async (cultivos = []) => {
    const cultivosLimpios = cultivos
      .map((c) => String(c || "").trim())
      .filter(Boolean);

    /** MAX(fecha) global puede ser de otro cultivo (ej. trigo 07/05 con soja solo hasta 30/04) → filas vacías. */
    const fechaResult = cultivosLimpios.length
      ? await query(
          `
          SELECT MAX(fecha) AS fecha
          FROM precios
          WHERE LOWER(TRIM(cultivo)) = ANY($1::text[])
        `,
          [cultivosLimpios.map((x) => x.toLowerCase())]
        )
      : await query("SELECT MAX(fecha) AS fecha FROM precios");
    const fecha = fechaResult.rows[0]?.fecha;
    if (!fecha) return { fecha: null, items: [] };

    let preciosResult;
    if (cultivosLimpios.length) {
      preciosResult = await query(
        `
        SELECT cultivo, mercado, precio, moneda, fecha
        FROM precios
        WHERE fecha = $1
          AND LOWER(TRIM(cultivo)) = ANY($2::text[])
        ORDER BY cultivo, mercado
      `,
        [fecha, cultivosLimpios.map((x) => x.toLowerCase())]
      );
    } else {
      preciosResult = await query(
        `
        SELECT cultivo, mercado, precio, moneda, fecha
        FROM precios
        WHERE fecha = $1
        ORDER BY cultivo, mercado
      `,
        [fecha]
      );
    }

    return { fecha, items: preciosResult.rows };
  };

  const obtenerUltimoTipoCambio = async () => {
    const fechaResult = await query("SELECT MAX(fecha) AS fecha FROM tipo_cambio");
    const fecha = fechaResult.rows[0]?.fecha;
    if (!fecha) return { fecha: null, items: [] };
    const usarCompra = await tieneCompraTipoCambio();
    const usarFuente = await tieneFuenteTipoCambio();

    const tcResult = await query(
      `
      SELECT
        tipo,
        valor,
        ${usarCompra ? "compra" : "NULL::numeric AS compra"},
        fecha,
        ${usarFuente ? "fuente" : "NULL::text AS fuente"}
      FROM tipo_cambio
      WHERE fecha = $1
    `,
      [fecha]
    );

    return { fecha, items: ordenarItemsTipoCambio(tcResult.rows) };
  };

  const obtenerPromedio30DiasCultivo = async (cultivo) => {
    const result = await query(
      `
      SELECT AVG(precio)::numeric(12,2) AS promedio
      FROM precios
      WHERE LOWER(cultivo) = LOWER($1)
        AND moneda = 'ARS'
        AND fecha >= CURRENT_DATE - INTERVAL '30 days'
    `,
      [cultivo]
    );
    const v = Number(result.rows[0]?.promedio);
    return Number.isFinite(v) ? v : null;
  };

  const obtenerTendencia7DiasCultivo = async (cultivo) => {
    const result = await query(
      `
      SELECT AVG(precio)::numeric(12,2) AS p, fecha
      FROM precios
      WHERE LOWER(cultivo)=LOWER($1)
        AND moneda='ARS'
        AND fecha >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY fecha
      ORDER BY fecha ASC
    `,
      [cultivo]
    );
    if (result.rows.length < 2) return "estable";
    const first = Number(result.rows[0].p);
    const last = Number(result.rows[result.rows.length - 1].p);
    if (last > first) return "sube";
    if (last < first) return "baja";
    return "estable";
  };

  const obtenerAlertasActivasUsuario = async (usuarioId) => {
    if (!usuarioId) return [];
    const result = await query(
      `
      SELECT id, cultivo, tipo, valor_objetivo
      FROM alertas
      WHERE usuario_id = $1 AND activa = true
      ORDER BY id DESC
      LIMIT 10
    `,
      [usuarioId]
    );
    return result.rows;
  };

  const obtenerFuturosParaCultivos = async (cultivos = []) => {
    if (!cultivos.length) return [];
    const cultivosNorm = cultivos.map((c) => String(c || "").toLowerCase());
    const result = await query(
      `
      SELECT fp.cultivo, fp.posicion, fp.precio_usd, fp.variacion, fp.volumen, fp.fecha
      FROM futuros_posiciones fp
      JOIN (
        SELECT cultivo, MAX(fecha) AS fecha
        FROM futuros_posiciones
        WHERE LOWER(cultivo) = ANY($1::text[])
        GROUP BY cultivo
      ) ult
        ON LOWER(fp.cultivo) = LOWER(ult.cultivo) AND fp.fecha = ult.fecha
      WHERE LOWER(fp.cultivo) = ANY($1::text[])
      ORDER BY fp.cultivo, fp.posicion
    `,
      [cultivosNorm]
    );
    return result.rows;
  };

  const geocodificarZona = async ({ partido, provincia }) => {
    if (!partido || !provincia) return null;
    const q = `${partido}, ${provincia}, Argentina`;
    const response = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q,
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

  const completarGeolocalizacionSiFalta = async (perfil) => {
    if (!perfil) return perfil;
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
      logConsulta({
        level: "warn",
        route: "geocodificacion_zona",
        message: `No se pudo geocodificar zona: ${error.message}`,
      });
      return perfil;
    }
  };

  /** Misma tolerancia que `templates/base.obtenerClimaFresco` (los inserts usan coords del API, no idénticas al perfil). */
  const obtenerClimaZona = async ({ lat, lng }) => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return [];
    }
    const result = await query(
      `
      SELECT fecha, temp_min, temp_max, precipitacion, helada, descripcion
      FROM clima
      WHERE ABS(lat - $1::numeric) < 0.15
        AND ABS(lng - $2::numeric) < 0.15
      ORDER BY fecha ASC
      LIMIT 7
    `,
      [latitude, longitude]
    );
    return result.rows || [];
  };

  const obtenerClimaFresco = async ({ usuario, texto = "" }) => {
    let lat = Number(usuario?.lat);
    let lng = Number(usuario?.lng);
    const zonaTexto = extraerZonaTexto(texto);
    if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && usuario) {
      const perfilGeo = await completarGeolocalizacionSiFalta(usuario);
      lat = Number(perfilGeo?.lat);
      lng = Number(perfilGeo?.lng);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const clima = await obtenerClima(lat, lng);
    for (const c of clima) {
      await query(
        `
        INSERT INTO clima (lat, lng, fecha, temp_min, temp_max, precipitacion, helada, descripcion, creado_en)
        VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (lat, lng, fecha) DO UPDATE SET
          temp_min = EXCLUDED.temp_min,
          temp_max = EXCLUDED.temp_max,
          precipitacion = EXCLUDED.precipitacion,
          helada = EXCLUDED.helada,
          descripcion = EXCLUDED.descripcion,
          creado_en = NOW()
      `,
        [lat, lng, c.fecha, c.temp_min, c.temp_max, c.precipitacion, c.helada, c.descripcion]
      );
    }
    if (zonaTexto && usuario?.id) {
      const geo = await geocodificarZona({ partido: zonaTexto, provincia: usuario.provincia || "Buenos Aires" });
      if (geo?.lat && geo?.lng) {
        const climaZona = await obtenerClima(geo.lat, geo.lng);
        for (const c of climaZona) {
          await query(
            `
            INSERT INTO clima (lat, lng, fecha, temp_min, temp_max, precipitacion, helada, descripcion, creado_en)
            VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (lat, lng, fecha) DO UPDATE SET
              temp_min = EXCLUDED.temp_min,
              temp_max = EXCLUDED.temp_max,
              precipitacion = EXCLUDED.precipitacion,
              helada = EXCLUDED.helada,
              descripcion = EXCLUDED.descripcion,
              creado_en = NOW()
          `,
            [geo.lat, geo.lng, c.fecha, c.temp_min, c.temp_max, c.precipitacion, c.helada, c.descripcion]
          );
        }
      }
    }
    return clima;
  };

  return {
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
  };
};

module.exports = { createConsultaDatosSnapshot };
