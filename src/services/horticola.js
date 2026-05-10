const { query } = require("../config/database");

const norm = (v = "") =>
  String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const toISO = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const normalizarEnvase = (text = "") => {
  const t = norm(text);
  if (!t) return "s/d";
  if (/\b25\b/.test(t)) return "bolsa_25kg";
  if (/\b20\b/.test(t)) return "bolsa_20kg";
  if (/\b30\b/.test(t)) return "bolsa_30kg";
  if (t.includes("granel")) return "granel";
  return "s/d";
};

const normalizarTratamiento = (text = "") => {
  const t = norm(text);
  if (t.includes("lavad")) return "lavada";
  if (t.includes("cepill")) return "cepillada";
  return "s/d";
};

const inferirZona = (mercado = "") => {
  const m = norm(mercado);
  if (m.includes("sudeste")) return "sudeste";
  if (m.includes("suroeste")) return "suroeste";
  if (m.includes("noroeste")) return "noroeste";
  return "general";
};

const inferirVariedad = () => "s/d";
const inferirCalidad = (raw = "") => {
  const t = norm(raw);
  if (t.includes("primera")) return "primera";
  if (t.includes("segunda")) return "segunda";
  if (t.includes("descarte")) return "descarte";
  return "s/d";
};

const inferirDestino = (mercado = "") => {
  const m = norm(mercado);
  if (m.includes("industr")) return "industria";
  return "mercado_fresco";
};

const normalizarTipoPrecioEstricto = (tipo = "", fuente = "") => {
  const t = norm(tipo);
  const f = norm(fuente);
  if (t === "operacion_real") {
    // Solo permitimos operación real si la fuente declara operaciones explícitas.
    if (f.includes("siogranos") || f.includes("operacion_real")) return "operacion_real";
    return "referencia";
  }
  if (t === "oferta") return "oferta";
  return "referencia";
};

const calcularDispersion = ({ min, max }) => {
  const a = Number(min);
  const b = Number(max);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return "s/d";
  const diff = (b - a) / a;
  if (diff > 0.3) return "alta";
  if (diff > 0.15) return "media";
  return "baja";
};

const detectarOutlier = ({ precioActual, promedioHistorico }) => {
  const p = Number(precioActual);
  const h = Number(promedioHistorico);
  if (!Number.isFinite(p) || !Number.isFinite(h) || h <= 0) return false;
  return p > h * 1.4;
};

const tendenciaPrecio = (serie = []) => {
  if (serie.length < 2) return "estable";
  const s = serie.map(Number).filter(Number.isFinite);
  if (s.length < 2) return "estable";
  if (s.length >= 3 && s[s.length - 1] > s[s.length - 2] && s[s.length - 2] > s[s.length - 3]) {
    return "subiendo";
  }
  if (s[s.length - 1] < s[s.length - 2]) return "bajando";
  return "estable";
};

const presionOfertaPorNivelIngreso = (nivel = "s/d") => {
  const n = norm(nivel);
  if (n === "alto") return "alta";
  if (n === "medio") return "media";
  if (n === "bajo") return "baja";
  return "s/d";
};

const estadoMercado = ({ tendencia, oferta }) => {
  if (tendencia === "subiendo" && oferta === "baja") return "muy_firme";
  if (tendencia === "subiendo") return "firme";
  if (tendencia === "bajando" && oferta === "alta") return "debil";
  return "estable";
};

const upsertPrecioPapaHorticola = async ({
  fecha,
  mercado = "MCBA",
  zona = "general",
  variedad = "s/d",
  calidad = "s/d",
  tratamiento = "s/d",
  lavado = false,
  envase = "s/d",
  unidad = "ARS/tn",
  precioMin,
  precioMax,
  precioPromedio,
  tipoPrecio = "referencia",
  volumenCategoria = "s/d",
  origen = "s/d",
  destino = "mercado_fresco",
  fuente = "desconocida",
  confiabilidad = 0.7,
  metadata = {},
}) => {
  const fechaIso = toISO(fecha);
  if (!fechaIso) return 0;
  const pp = Number(precioPromedio);
  if (!Number.isFinite(pp) || pp <= 0) return 0;
  const pmin = Number.isFinite(Number(precioMin)) ? Number(precioMin) : pp;
  const pmax = Number.isFinite(Number(precioMax)) ? Number(precioMax) : pp;
  const tipoPrecioSafe = normalizarTipoPrecioEstricto(tipoPrecio, fuente);
  const result = await query(
    `
      INSERT INTO precios_horticolas (
        fecha, mercado, zona, producto, variedad, calidad, tratamiento, lavado, envase, unidad,
        precio_min, precio_max, precio_promedio, tipo_precio, volumen_categoria, origen, destino,
        fuente, confiabilidad, metadata
      )
      VALUES ($1,$2,$3,'papa',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
      ON CONFLICT (
        fecha, mercado, zona, producto, variedad, calidad, tratamiento, lavado, envase, tipo_precio, origen, destino
      )
      DO UPDATE SET
        precio_min = EXCLUDED.precio_min,
        precio_max = EXCLUDED.precio_max,
        precio_promedio = EXCLUDED.precio_promedio,
        volumen_categoria = EXCLUDED.volumen_categoria,
        fuente = EXCLUDED.fuente,
        confiabilidad = EXCLUDED.confiabilidad,
        metadata = EXCLUDED.metadata,
        timestamp_ingesta = NOW()
    `,
    [
      fechaIso,
      mercado,
      zona,
      variedad,
      calidad,
      tratamiento,
      Boolean(lavado),
      envase,
      unidad,
      pmin,
      pmax,
      pp,
      tipoPrecioSafe,
      volumenCategoria,
      origen,
      destino,
      fuente,
      Number(confiabilidad) || 0.7,
      JSON.stringify(metadata || {}),
    ]
  );
  return result.rowCount || 0;
};

const upsertIngresoPapaHorticola = async ({
  fecha,
  mercado = "MCBA",
  camiones = null,
  toneladasEstimadas = null,
  nivelIngreso = "s/d",
  tendenciaIngreso = "estable",
  fuente = "desconocida",
  metadata = {},
}) => {
  const fechaIso = toISO(fecha);
  if (!fechaIso) return 0;
  let tendencia = tendenciaIngreso || "estable";
  if (Number.isFinite(Number(camiones))) {
    const prevR = await query(
      `
        SELECT camiones
        FROM ingresos_mercado_horticolas
        WHERE mercado = $1
          AND producto = 'papa'
          AND fecha < $2::date
        ORDER BY fecha DESC
        LIMIT 1
      `,
      [mercado, fechaIso]
    );
    const prevCam = Number(prevR.rows[0]?.camiones);
    if (Number.isFinite(prevCam)) {
      if (Number(camiones) > prevCam) tendencia = "subiendo";
      else if (Number(camiones) < prevCam) tendencia = "bajando";
      else tendencia = "estable";
    }
  }
  const result = await query(
    `
      INSERT INTO ingresos_mercado_horticolas (
        fecha, mercado, producto, camiones, toneladas_estimadas, nivel_ingreso, tendencia_ingreso, fuente, metadata
      )
      VALUES ($1,$2,'papa',$3,$4,$5,$6,$7,$8::jsonb)
      ON CONFLICT (fecha, mercado, producto)
      DO UPDATE SET
        camiones = EXCLUDED.camiones,
        toneladas_estimadas = EXCLUDED.toneladas_estimadas,
        nivel_ingreso = EXCLUDED.nivel_ingreso,
        tendencia_ingreso = EXCLUDED.tendencia_ingreso,
        fuente = EXCLUDED.fuente,
        metadata = EXCLUDED.metadata,
        timestamp_ingesta = NOW()
    `,
    [
      fechaIso,
      mercado,
      Number.isFinite(Number(camiones)) ? Number(camiones) : null,
      Number.isFinite(Number(toneladasEstimadas)) ? Number(toneladasEstimadas) : null,
      nivelIngreso || "s/d",
      tendencia,
      fuente || "desconocida",
      JSON.stringify(metadata || {}),
    ]
  );
  return result.rowCount || 0;
};

const upsertAnalisisPapa = async ({ fecha, mercado = "MCBA" }) => {
  const fechaIso = toISO(fecha);
  if (!fechaIso) return 0;
  const preciosR = await query(
    `
      SELECT fecha, precio_promedio, precio_min, precio_max
      FROM precios_horticolas
      WHERE producto = 'papa'
        AND mercado = $1
        AND fecha >= $2::date - INTERVAL '8 days'
      ORDER BY fecha ASC
    `,
    [mercado, fechaIso]
  );
  const rows = preciosR.rows || [];
  if (!rows.length) return 0;
  const serie = rows.map((r) => Number(r.precio_promedio)).filter(Number.isFinite);
  const last = serie[serie.length - 1];
  const v3 = serie.length >= 3 ? ((last - serie[serie.length - 3]) / serie[serie.length - 3]) * 100 : null;
  const v7 = serie.length >= 7 ? ((last - serie[serie.length - 7]) / serie[serie.length - 7]) * 100 : null;
  const tendencia = tendenciaPrecio(serie);
  const hoy = rows[rows.length - 1];
  const disp = calcularDispersion({ min: hoy.precio_min, max: hoy.precio_max });

  const ingR = await query(
    `
      SELECT nivel_ingreso
      FROM ingresos_mercado_horticolas
      WHERE fecha = $1::date
        AND mercado = $2
        AND producto = 'papa'
      LIMIT 1
    `,
    [fechaIso, mercado]
  );
  const nivelIngreso = ingR.rows[0]?.nivel_ingreso || "s/d";
  const presionOferta = presionOfertaPorNivelIngreso(nivelIngreso);
  const estado = estadoMercado({ tendencia, oferta: presionOferta });
  const promedioHist = serie.length ? serie.reduce((a, b) => a + b, 0) / serie.length : null;
  const outlier = detectarOutlier({ precioActual: last, promedioHistorico: promedioHist });

  const result = await query(
    `
      INSERT INTO analisis_mercado_horticolas (
        fecha, producto, mercado, tendencia_precio, variacion_3d, variacion_7d,
        estado_mercado, presion_oferta, dispersion, outliers_detectados, metadata
      )
      VALUES ($1,'papa',$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      ON CONFLICT (fecha, producto, mercado)
      DO UPDATE SET
        tendencia_precio = EXCLUDED.tendencia_precio,
        variacion_3d = EXCLUDED.variacion_3d,
        variacion_7d = EXCLUDED.variacion_7d,
        estado_mercado = EXCLUDED.estado_mercado,
        presion_oferta = EXCLUDED.presion_oferta,
        dispersion = EXCLUDED.dispersion,
        outliers_detectados = EXCLUDED.outliers_detectados,
        metadata = EXCLUDED.metadata
    `,
    [
      fechaIso,
      mercado,
      tendencia,
      Number.isFinite(v3) ? Number(v3.toFixed(2)) : null,
      Number.isFinite(v7) ? Number(v7.toFixed(2)) : null,
      estado,
      presionOferta,
      disp,
      outlier,
      JSON.stringify({
        nivel_ingreso: nivelIngreso,
        serie_puntos: serie.length,
      }),
    ]
  );
  return result.rowCount || 0;
};

const registrarPrecioPapaDesdeCanon = async (canon = {}, { valor, moneda }) => {
  if (norm(canon.cultivo) !== "papa") return 0;
  const fecha = toISO(canon.fecha);
  if (!fecha) return 0;
  const valorNum = Number(valor);
  if (!Number.isFinite(valorNum) || valorNum <= 0) return 0;
  const zona = inferirZona(canon.mercado);
  const tratamiento = normalizarTratamiento(canon.mercado);
  const envase = normalizarEnvase(canon.presentacion || canon.mercado);
  const calidad = inferirCalidad(canon.calidad);
  const tipoPrecio = normalizarTipoPrecioEstricto(canon.tipo_precio || "referencia", canon.mercado || "");
  const volumenCategoria = canon.volumen_ingreso_nivel || "s/d";
  const unidad = String(moneda || "ARS").toUpperCase() === "ARS" ? "ARS/tn" : "USD/tn";
  const conf = tipoPrecio === "operacion_real" ? 0.9 : tipoPrecio === "oferta" ? 0.65 : 0.75;
  const up = await upsertPrecioPapaHorticola({
    fecha,
    mercado: "MCBA",
    zona,
    variedad: inferirVariedad(),
    calidad,
    tratamiento,
    lavado: tratamiento === "lavada",
    envase,
    unidad,
    precioMin: valorNum,
    precioMax: valorNum,
    precioPromedio: valorNum,
    tipoPrecio,
    volumenCategoria,
    origen: "s/d",
    destino: inferirDestino(canon.mercado),
    fuente: canon.mercado || "papa",
    confiabilidad: conf,
    metadata: {
      mercado_raw: canon.mercado || null,
      referencia_debil: tipoPrecio !== "operacion_real",
    },
  });
  await upsertIngresoPapaHorticola({
    fecha,
    mercado: "MCBA",
    camiones: Number.isFinite(Number(canon.camiones_total)) ? Number(canon.camiones_total) : null,
    toneladasEstimadas: Number.isFinite(Number(canon.toneladas_estimadas))
      ? Number(canon.toneladas_estimadas)
      : null,
    nivelIngreso: volumenCategoria || "s/d",
    tendenciaIngreso: "estable",
    fuente: canon.volumen_ingreso_fuente || canon.mercado || "desconocida",
  });
  await upsertAnalisisPapa({ fecha, mercado: "MCBA" });
  return up;
};

const deduplicarPreciosPapaHorticolas = async ({ fecha = null, mercado = "MCBA" } = {}) => {
  const fechaCond = fecha ? "AND a.fecha = $2::date" : "";
  const params = fecha ? [mercado, fecha] : [mercado];
  const deleted = await query(
    `
      DELETE FROM precios_horticolas a
      USING precios_horticolas b
      WHERE a.id < b.id
        AND a.fecha = b.fecha
        AND a.mercado = b.mercado
        AND a.producto = b.producto
        AND a.zona = b.zona
        AND a.variedad = b.variedad
        AND a.calidad = b.calidad
        AND a.tratamiento = b.tratamiento
        AND a.envase = b.envase
        AND a.tipo_precio = b.tipo_precio
        AND a.mercado = $1
        ${fechaCond}
    `,
    params
  );
  return Number(deleted.rowCount || 0);
};

const crearAlertaHorticola = async ({ usuarioRef, producto = "papa", condicion }) => {
  if (!usuarioRef || !condicion) throw new Error("Faltan usuarioRef o condicion");
  const r = await query(
    `
      INSERT INTO alertas_horticolas (usuario_ref, producto, condicion, activa)
      VALUES ($1, $2, $3, true)
      RETURNING id, usuario_ref, producto, condicion, activa, creado_en
    `,
    [String(usuarioRef).trim(), String(producto).trim().toLowerCase(), String(condicion).trim()]
  );
  return r.rows[0];
};

const correrFetchPapaManual = async ({ fecha = null } = {}) => {
  const { obtenerPreciosPapa: fetchPapa } = require("../scrapers/papa_argenpapa");
  const items = await fetchPapa();
  let insertados = 0;
  for (const it of items) {
    const valor = Number(it.precio_ars ?? it.precio_usd);
    const moneda = Number.isFinite(Number(it.precio_ars)) ? "ARS" : "USD";
    insertados += await registrarPrecioPapaDesdeCanon(it, { valor, moneda });
  }
  const fechaRef = fecha || items[0]?.fecha || null;
  await deduplicarPreciosPapaHorticolas({ fecha: fechaRef || null, mercado: "MCBA" });
  if (fechaRef) await upsertAnalisisPapa({ fecha: fechaRef, mercado: "MCBA" });
  return {
    ok: true,
    fecha: fechaRef,
    items: items.length,
    insertados,
  };
};

const obtenerPreciosPapa = async ({
  mercado = "MCBA",
  variedad = null,
  fecha = null,
}) => {
  const params = [mercado];
  let idx = 2;
  let where = "mercado = $1 AND producto = 'papa'";
  if (variedad) {
    where += ` AND LOWER(variedad) = LOWER($${idx})`;
    params.push(variedad);
    idx += 1;
  }
  if (fecha) {
    where += ` AND fecha = $${idx}::date`;
    params.push(fecha);
    idx += 1;
  } else {
    where += " AND fecha = (SELECT MAX(fecha) FROM precios_horticolas WHERE mercado = $1 AND producto = 'papa')";
  }
  const r = await query(
    `
      SELECT *
      FROM precios_horticolas
      WHERE ${where}
      ORDER BY zona, variedad, calidad, tratamiento, envase
    `,
    params
  );
  return r.rows || [];
};

const obtenerAnalisisPapa = async ({ mercado = "MCBA", fecha = null }) => {
  const r = await query(
    `
      SELECT *
      FROM analisis_mercado_horticolas
      WHERE mercado = $1
        AND producto = 'papa'
        AND fecha = COALESCE($2::date, (
          SELECT MAX(fecha)
          FROM analisis_mercado_horticolas
          WHERE mercado = $1
            AND producto = 'papa'
        ))
      LIMIT 1
    `,
    [mercado, fecha || null]
  );
  return r.rows[0] || null;
};

module.exports = {
  normalizarEnvase,
  normalizarTratamiento,
  upsertPrecioPapaHorticola,
  upsertIngresoPapaHorticola,
  upsertAnalisisPapa,
  registrarPrecioPapaDesdeCanon,
  obtenerPreciosPapa,
  obtenerAnalisisPapa,
  crearAlertaHorticola,
  correrFetchPapaManual,
  deduplicarPreciosPapaHorticolas,
};
