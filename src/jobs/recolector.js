const cron = require("node-cron");
const { query } = require("../config/database");
const { obtenerPreciosMAGYPFOB } = require("../scrapers/granos_magyp_fob");
const { obtenerPreciosCAC } = require("../scrapers/granos_cac");
const { obtenerTipoCambio } = require("../scrapers/dolar");
const { obtenerClima } = require("../scrapers/clima");
const { obtenerPreciosHacienda } = require("../scrapers/hacienda");
const { obtenerPreciosInsumos } = require("../scrapers/insumos");
const { obtenerPreciosBcrGix } = require("../scrapers/bcr_gix");
const { obtenerDatosMATba } = require("../scrapers/futuros_matba");
const { obtenerPreciosPapa } = require("../scrapers/papa_argenpapa");
const { obtenerPreciosPapaMagyp } = require("../scrapers/papa_magyp_csv");
const { obtenerNoticiasWeb } = require("../scrapers/noticias_web");
const { obtenerMercadosWeb } = require("../scrapers/mercados_web");
const { verificarAlertas } = require("../services/alertas");
const { generarSnapshotMercado } = require("../services/snapshot");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const esErrorReintentable = (error) => {
  const status = Number(error?.response?.status || 0);
  if (!status) return true; // timeout/red/network
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  return false;
};

const conReintentos = async (fn, { intentos = 3, esperaBaseMs = 1500, etiqueta = "fuente" } = {}) => {
  let ultimoError = null;
  for (let i = 1; i <= intentos; i += 1) {
    try {
      return await fn();
    } catch (error) {
      ultimoError = error;
      if (i >= intentos || !esErrorReintentable(error)) {
        throw error;
      }
      const espera = esperaBaseMs * i;
      console.warn(
        `[Recolector][Retry] ${etiqueta} intento ${i}/${intentos} falló (${error.message}). Reintento en ${espera}ms`
      );
      await sleep(espera);
    }
  }
  throw ultimoError || new Error(`Fallo en ${etiqueta}`);
};

const registrarValidacionPrecio = async ({ item, perfil, resultado, valor, moneda }) => {
  try {
    await query(
      `
        INSERT INTO validaciones_precios (
          cultivo, mercado, moneda, fecha, valor, ok, score_confianza, motivo,
          referencia_valor, desvio_pct, perfil
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        item?.cultivo || null,
        item?.mercado || null,
        moneda || null,
        item?.fecha || null,
        Number.isFinite(valor) ? valor : null,
        Boolean(resultado?.ok),
        Number.isFinite(Number(resultado?.score)) ? Number(resultado.score) : null,
        resultado?.motivo || null,
        Number.isFinite(Number(resultado?.referencia)) ? Number(resultado.referencia) : null,
        Number.isFinite(Number(resultado?.desvioPct)) ? Number(resultado.desvioPct) : null,
        perfil || "general",
      ]
    );
  } catch (_error) {
    // No interrumpir recolección por un fallo de trazabilidad.
  }
};

const obtenerConfianzaMercado = (mercado = "") => {
  const m = String(mercado || "").toUpperCase();
  if (m.includes("MAGYP")) return 0.95;
  if (m.includes("CAC")) return 0.92;
  if (m.includes("BCR_GIX")) return 0.9;
  if (m.includes("MATBA")) return 0.9;
  if (m.includes("WEB")) return 0.7;
  if (m.includes("AFA")) return 0.82;
  return 0.78;
};

const validarPrecioRecolectado = async (item, { perfil = "general" } = {}) => {
  const precioArs = Number(item.precio_ars);
  const precioUsd = Number(item.precio_usd);
  const moneda = Number.isFinite(precioArs) ? "ARS" : Number.isFinite(precioUsd) ? "USD" : null;
  const valor = moneda === "ARS" ? precioArs : precioUsd;
  if (!moneda || !Number.isFinite(valor) || valor <= 0 || !item?.cultivo || !item?.mercado || !item?.fecha) {
    return { ok: false, motivo: "precio_o_campos_invalidos", score: 0, valor, moneda };
  }

  const rangos = {
    ARS: { min: 10_000, max: 2_000_000 },
    USD: { min: 20, max: 1_500 },
  };
  const range = rangos[moneda];
  if (range && (valor < range.min || valor > range.max)) {
    return {
      ok: false,
      motivo: `fuera_de_rango_${moneda.toLowerCase()}`,
      score: 5,
      valor,
      moneda,
    };
  }

  let referencia = null;
  try {
    referencia = await obtenerReferenciaInternaPrecio({
      cultivo: item.cultivo,
      moneda,
      fecha: item.fecha,
    });
  } catch (_error) {
    referencia = null;
  }

  const baseConf = obtenerConfianzaMercado(item.mercado);
  if (!Number.isFinite(referencia) || referencia <= 0) {
    return {
      ok: true,
      motivo: "sin_referencia_interna",
      score: Number((baseConf * 100).toFixed(2)),
      referencia: null,
      desvioPct: null,
      valor,
      moneda,
    };
  }

  const desvio = Math.abs((valor - referencia) / referencia);
  const limiteDesvio = perfil === "web" ? 0.35 : 0.6;
  if (desvio > limiteDesvio) {
    return {
      ok: false,
      motivo: "desvio_excesivo",
      score: 10,
      referencia,
      desvioPct: Number((desvio * 100).toFixed(2)),
      valor,
      moneda,
    };
  }

  const penalidad = desvio > 0.35 ? 0.25 : desvio > 0.2 ? 0.12 : 0;
  const score = Math.max(0, Math.min(1, baseConf - penalidad)) * 100;
  return {
    ok: true,
    motivo: "ok",
    score: Number(score.toFixed(2)),
    referencia,
    desvioPct: Number((desvio * 100).toFixed(2)),
    valor,
    moneda,
  };
};

const insertPrecio = async (item, { perfilValidacion = "general" } = {}) => {
  const validacion = await validarPrecioRecolectado(item, { perfil: perfilValidacion });
  await registrarValidacionPrecio({
    item,
    perfil: perfilValidacion,
    resultado: validacion,
    valor: validacion.valor,
    moneda: validacion.moneda,
  });
  if (!validacion.ok) {
    throw new Error(`Validación de precio fallida (${validacion.motivo})`);
  }

  const precio = Number(item.precio_ars);
  const precioUsd = Number(item.precio_usd);
  const moneda = Number.isFinite(precio) ? "ARS" : "USD";
  const valor = Number.isFinite(precio) ? precio : precioUsd;

  const result = await query(
    `
      INSERT INTO precios (cultivo, mercado, precio, moneda, fecha)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (cultivo, mercado, fecha) DO NOTHING
    `,
    [item.cultivo, item.mercado, valor, moneda, item.fecha]
  );
  return result.rowCount || 0;
};

const obtenerReferenciaInternaPrecio = async ({ cultivo, moneda, fecha }) => {
  if (!cultivo || !moneda || !fecha) return null;
  const result = await query(
    `
      SELECT AVG(precio)::numeric(12,2) AS ref
      FROM precios
      WHERE LOWER(cultivo) = LOWER($1)
        AND moneda = $2
        AND mercado NOT ILIKE '%WEB%'
        AND fecha >= ($3::date - INTERVAL '7 days')
        AND fecha <= $3::date
    `,
    [cultivo, moneda, fecha]
  );
  const ref = Number(result.rows[0]?.ref);
  return Number.isFinite(ref) ? ref : null;
};

const insertTipoCambio = async (item) => {
  if (!item?.tipo || !item?.fecha) return 0;
  const valor = Number(item.venta);
  if (!Number.isFinite(valor)) return 0;

  const result = await query(
    `
      INSERT INTO tipo_cambio (tipo, valor, fecha)
      VALUES ($1, $2, $3)
      ON CONFLICT (tipo, fecha) DO NOTHING
    `,
    [item.tipo, valor, item.fecha]
  );

  return result.rowCount || 0;
};

const insertClima = async (item) => {
  if (!item?.fecha) return 0;

  const result = await query(
    `
      INSERT INTO clima (
        lat, lng, fecha, temp_min, temp_max, precipitacion, helada, descripcion
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (lat, lng, fecha) DO NOTHING
    `,
    [
      item.lat,
      item.lng,
      item.fecha,
      item.temp_min,
      item.temp_max,
      item.precipitacion,
      item.helada,
      item.descripcion,
    ]
  );

  return result.rowCount || 0;
};

const insertHacienda = async (item) => {
  if (!item?.categoria || !item?.fecha) return 0;
  const result = await query(
    `
      INSERT INTO precios_hacienda (categoria, precio_promedio, precio_max, precio_min, unidad, fecha)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (categoria, fecha) DO UPDATE SET
        precio_promedio = EXCLUDED.precio_promedio,
        precio_max = EXCLUDED.precio_max,
        precio_min = EXCLUDED.precio_min,
        unidad = EXCLUDED.unidad
    `,
    [
      item.categoria,
      item.precio_promedio,
      item.precio_max,
      item.precio_min,
      item.unidad || "kg",
      item.fecha,
    ]
  );
  return result.rowCount || 0;
};

const insertInsumo = async (item) => {
  if (!item?.producto || !item?.fecha || !Number.isFinite(Number(item.precio))) return 0;
  const result = await query(
    `
      INSERT INTO precios_insumos (categoria, producto, precio, unidad, moneda, fuente, fecha)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (producto, fecha) DO UPDATE SET
        categoria = EXCLUDED.categoria,
        precio = EXCLUDED.precio,
        unidad = EXCLUDED.unidad,
        moneda = EXCLUDED.moneda,
        fuente = EXCLUDED.fuente
    `,
    [
      item.categoria || "otro",
      item.producto,
      item.precio,
      item.unidad || "unidad",
      item.moneda || "ARS",
      item.fuente || null,
      item.fecha,
    ]
  );
  return result.rowCount || 0;
};

const fechaHoyAr = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

const reusarUltimoDatoValidoInsumos = async () => {
  const fechaHoy = fechaHoyAr();
  const ultimaFecha = await query("SELECT MAX(fecha) AS fecha FROM precios_insumos WHERE fecha < $1", [
    fechaHoy,
  ]);
  const fechaOrigen = ultimaFecha.rows[0]?.fecha;
  if (!fechaOrigen) return 0;
  const result = await query(
    `
      INSERT INTO precios_insumos (categoria, producto, precio, unidad, moneda, fuente, fecha)
      SELECT categoria, producto, precio, unidad, moneda, COALESCE(fuente, 'fallback') || ' (ultimo_valido)', $1::date
      FROM precios_insumos
      WHERE fecha = $2::date
      ON CONFLICT (producto, fecha) DO NOTHING
    `,
    [fechaHoy, fechaOrigen]
  );
  return result.rowCount || 0;
};

const reusarUltimoDatoValidoHacienda = async () => {
  const fechaHoy = fechaHoyAr();
  const ultimaFecha = await query(
    "SELECT MAX(fecha) AS fecha FROM precios_hacienda WHERE fecha < $1",
    [fechaHoy]
  );
  const fechaOrigen = ultimaFecha.rows[0]?.fecha;
  if (!fechaOrigen) return 0;
  const result = await query(
    `
      INSERT INTO precios_hacienda (categoria, precio_promedio, precio_max, precio_min, unidad, fecha)
      SELECT categoria, precio_promedio, precio_max, precio_min, unidad, $1::date
      FROM precios_hacienda
      WHERE fecha = $2::date
      ON CONFLICT (categoria, fecha) DO NOTHING
    `,
    [fechaHoy, fechaOrigen]
  );
  return result.rowCount || 0;
};

const insertFuturoPosicion = async (item) => {
  if (!item?.cultivo || !item?.posicion || !item?.fecha) return 0;
  const result = await query(
    `
      INSERT INTO futuros_posiciones (cultivo, posicion, precio_usd, variacion, volumen, fecha)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (cultivo, posicion, fecha) DO UPDATE SET
        precio_usd = EXCLUDED.precio_usd,
        variacion = EXCLUDED.variacion,
        volumen = EXCLUDED.volumen
    `,
    [
      item.cultivo,
      item.posicion,
      item.precio_usd,
      item.variacion,
      item.volumen,
      item.fecha,
    ]
  );
  return result.rowCount || 0;
};

const insertNoticia = async (item) => {
  if (!item?.fuente || !item?.titulo || !item?.url) return 0;
  const result = await query(
    `
      INSERT INTO noticias_agro (fuente, categoria, titulo, url, resumen, publicado_en, tipo)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (fuente, url) DO UPDATE SET
        categoria = EXCLUDED.categoria,
        titulo = EXCLUDED.titulo,
        resumen = EXCLUDED.resumen,
        publicado_en = EXCLUDED.publicado_en,
        tipo = EXCLUDED.tipo
    `,
    [
      item.fuente,
      item.categoria || "agro_general",
      item.titulo,
      item.url,
      item.resumen || null,
      item.publicado_en || null,
      item.tipo || "noticia",
    ]
  );
  return result.rowCount || 0;
};

const obtenerZonasUsuarios = async () => {
  const result = await query(
    `
      SELECT DISTINCT lat, lng
      FROM (
        SELECT lat, lng
        FROM usuarios
        WHERE lat IS NOT NULL AND lng IS NOT NULL
        UNION
        SELECT lat, lng
        FROM usuario_zonas
        WHERE activa = true
          AND lat IS NOT NULL
          AND lng IS NOT NULL
      ) z
    `
  );
  return result.rows;
};

const recolectarPreciosCACFresco = async () => {
  const resumen = {
    ok: true,
    totalFuente: 0,
    insertados: 0,
    errores: [],
  };

  try {
    const preciosCac = await conReintentos(() => obtenerPreciosCAC(), {
      intentos: 3,
      esperaBaseMs: 1500,
      etiqueta: "CAC",
    });
    resumen.totalFuente = preciosCac.length;
    for (const item of preciosCac) {
      try {
        resumen.insertados += await insertPrecio(item);
      } catch (error) {
        resumen.errores.push(
          `CAC ${item.cultivo || "desconocido"}: ${error.message}`
        );
      }
    }
  } catch (error) {
    resumen.errores.push(error.message);
  }

  if (resumen.errores.length) resumen.ok = false;

  console.log(
    `[Recolector][CAC] fuente=${resumen.totalFuente}, insertados=${resumen.insertados}, errores=${resumen.errores.length}`
  );
  if (resumen.errores.length) {
    console.error("[Recolector][CAC] Errores:", resumen.errores);
  }

  return resumen;
};

const ejecutarRecolectorDiario = async () => {
  const resumen = {
    ok: true,
    precios: {
      fuentePrincipal: "MAGYP_FOB",
      totalFuente: 0,
      insertados: 0,
      fallbackUsado: false,
      cacFuente: 0,
      cacInsertados: 0,
      errores: [],
    },
    tipo_cambio: {
      totalFuente: 0,
      insertados: 0,
      errores: [],
    },
    clima: {
      zonas: 0,
      registrosFuente: 0,
      insertados: 0,
      errores: [],
    },
    alertas: {
      evaluadas: 0,
      disparadas: 0,
      errores: [],
    },
    hacienda: {
      totalFuente: 0,
      insertados: 0,
      errores: [],
    },
    insumos: {
      totalFuente: 0,
      insertados: 0,
      errores: [],
    },
    matba: {
      indicesFuente: 0,
      indicesInsertados: 0,
      posicionesFuente: 0,
      posicionesInsertadas: 0,
      errores: [],
    },
    bcr_gix: {
      totalFuente: 0,
      insertados: 0,
      errores: [],
    },
    papa: {
      totalFuente: 0,
      insertados: 0,
      errores: [],
    },
    noticias_web: {
      totalFuente: 0,
      insertados: 0,
      errores: [],
    },
    mercados_web: {
      totalFuente: 0,
      insertados: 0,
      errores: [],
    },
    snapshot: {
      id: null,
      totalItems: 0,
      fuentesOk: [],
      fuentesError: [],
      datosCompletos: false,
      errores: [],
    },
  };

  let precios = [];

  try {
    precios = await conReintentos(() => obtenerPreciosMAGYPFOB(), {
      intentos: 3,
      esperaBaseMs: 2000,
      etiqueta: "MAGYP_FOB",
    });
    resumen.precios.totalFuente = precios.length;
  } catch (error) {
    resumen.precios.errores.push(`MAGYP: ${error.message}`);
  }

  if (!precios.length) {
    try {
      const preciosCac = await conReintentos(() => obtenerPreciosCAC(), {
        intentos: 3,
        esperaBaseMs: 1500,
        etiqueta: "CAC_FALLBACK",
      });
      resumen.precios.fallbackUsado = true;
      resumen.precios.fuentePrincipal = "CAC_FALLBACK";
      resumen.precios.totalFuente = preciosCac.length;
      precios = preciosCac;
    } catch (error) {
      resumen.precios.errores.push(`CAC fallback: ${error.message}`);
    }
  }

  for (const item of precios) {
    try {
      resumen.precios.insertados += await insertPrecio(item);
    } catch (error) {
      resumen.precios.errores.push(
        `Precio ${item.cultivo || "desconocido"}: ${error.message}`
      );
    }
  }

  try {
    let items = await conReintentos(() => obtenerPreciosPapa(), {
      intentos: 2,
      esperaBaseMs: 1200,
      etiqueta: "PAPA_MCBA",
    });
    if (!items.length) {
      items = await conReintentos(() => obtenerPreciosPapaMagyp(), {
        intentos: 1,
        esperaBaseMs: 800,
        etiqueta: "PAPA_MAGYP_CSV",
      });
    }
    resumen.papa.totalFuente = items.length;
    for (const item of items) {
      try {
        resumen.precios.insertados += await insertPrecio(item);
        resumen.papa.insertados += 1;
      } catch (error) {
        resumen.papa.errores.push(`Papa ${item.mercado || "mcba"}: ${error.message}`);
      }
    }
  } catch (error) {
    resumen.papa.errores.push(error.message);
  }

  const rCac = await recolectarPreciosCACFresco();
  resumen.precios.cacFuente = rCac.totalFuente;
  resumen.precios.cacInsertados = rCac.insertados;
  if (rCac.errores.length) {
    resumen.precios.errores.push(...rCac.errores.map((e) => `CAC paralelo: ${e}`));
  }

  try {
    const tipos = await conReintentos(() => obtenerTipoCambio(), {
      intentos: 3,
      esperaBaseMs: 1500,
      etiqueta: "DOLAR_API",
    });
    resumen.tipo_cambio.totalFuente = tipos.length;
    for (const item of tipos) {
      try {
        resumen.tipo_cambio.insertados += await insertTipoCambio(item);
      } catch (error) {
        resumen.tipo_cambio.errores.push(
          `Tipo ${item.tipo || "desconocido"}: ${error.message}`
        );
      }
    }
  } catch (error) {
    resumen.tipo_cambio.errores.push(`DolarAPI: ${error.message}`);
  }

  try {
    const zonas = await obtenerZonasUsuarios();
    resumen.clima.zonas = zonas.length;
    for (const zona of zonas) {
      try {
        const pronostico = await conReintentos(() => obtenerClima(zona.lat, zona.lng), {
          intentos: 3,
          esperaBaseMs: 1200,
          etiqueta: `CLIMA_${zona.lat},${zona.lng}`,
        });
        resumen.clima.registrosFuente += pronostico.length;
        for (const dia of pronostico) {
          try {
            resumen.clima.insertados += await insertClima(dia);
          } catch (error) {
            resumen.clima.errores.push(
              `Clima insert ${zona.lat},${zona.lng}: ${error.message}`
            );
          }
        }
      } catch (error) {
        resumen.clima.errores.push(
          `Open-Meteo ${zona.lat},${zona.lng}: ${error.message}`
        );
      }
    }
  } catch (error) {
    resumen.clima.errores.push(`Zonas usuarios: ${error.message}`);
  }

  try {
    const items = await conReintentos(() => obtenerPreciosHacienda(), {
      intentos: 3,
      esperaBaseMs: 2000,
      etiqueta: "HACIENDA",
    });
    resumen.hacienda.totalFuente = items.length;
    for (const item of items) {
      resumen.hacienda.insertados += await insertHacienda(item);
    }
  } catch (error) {
    resumen.hacienda.errores.push(error.message);
    try {
      const recuperados = await reusarUltimoDatoValidoHacienda();
      if (recuperados > 0) {
        resumen.hacienda.insertados += recuperados;
        resumen.hacienda.errores.push(
          `Fuente principal falló, se reutilizó último dato válido (${recuperados}).`
        );
      }
    } catch (fallbackError) {
      resumen.hacienda.errores.push(`Fallback ultimo_valido hacienda: ${fallbackError.message}`);
    }
  }

  try {
    const items = await conReintentos(() => obtenerPreciosInsumos(), {
      intentos: 2,
      esperaBaseMs: 1200,
      etiqueta: "INSUMOS",
    });
    resumen.insumos.totalFuente = items.length;
    for (const item of items) {
      resumen.insumos.insertados += await insertInsumo(item);
    }
  } catch (error) {
    resumen.insumos.errores.push(error.message);
    try {
      const recuperados = await reusarUltimoDatoValidoInsumos();
      if (recuperados > 0) {
        resumen.insumos.insertados += recuperados;
        resumen.insumos.errores.push(
          `Fuente principal falló, se reutilizó último dato válido (${recuperados}).`
        );
      }
    } catch (fallbackError) {
      resumen.insumos.errores.push(`Fallback ultimo_valido insumos: ${fallbackError.message}`);
    }
  }

  try {
    const items = await conReintentos(() => obtenerPreciosBcrGix(), {
      intentos: 2,
      esperaBaseMs: 1500,
      etiqueta: "BCR_GIX",
    });
    resumen.bcr_gix.totalFuente = items.length;
    for (const item of items) {
      try {
        resumen.bcr_gix.insertados += await insertPrecio(item);
      } catch (error) {
        resumen.bcr_gix.errores.push(
          `BCR GIX ${item.cultivo || "desconocido"}: ${error.message}`
        );
      }
    }
  } catch (error) {
    resumen.bcr_gix.errores.push(error.message);
  }

  try {
    const matba = await conReintentos(() => obtenerDatosMATba(), {
      intentos: 2,
      esperaBaseMs: 2000,
      etiqueta: "MATBA",
    });
    resumen.matba.indicesFuente = matba.indices.length;
    resumen.matba.posicionesFuente = matba.posiciones.length;
    for (const indice of matba.indices) {
      try {
        resumen.matba.indicesInsertados += await insertPrecio(indice);
      } catch (error) {
        resumen.matba.errores.push(
          `Indice ${indice.cultivo || "desconocido"}: ${error.message}`
        );
      }
    }
    for (const posicion of matba.posiciones) {
      try {
        resumen.matba.posicionesInsertadas += await insertFuturoPosicion(posicion);
      } catch (error) {
        resumen.matba.errores.push(
          `Posicion ${posicion.cultivo || "desconocido"} ${posicion.posicion || ""}: ${error.message}`
        );
      }
    }
    for (const err of matba.errores) {
      resumen.matba.errores.push(
        `${err.symbol}: ${err.status || "sin_status"} ${err.message || "error"}`
      );
    }
    console.log(
      `[Recolector] MATba indices=${matba.indices.length}, posiciones=${matba.posiciones.length}`
    );
  } catch (error) {
    resumen.matba.errores.push(error.message);
  }

  try {
    const rAlertas = await verificarAlertas();
    resumen.alertas.evaluadas = rAlertas.totalEvaluadas;
    resumen.alertas.disparadas = rAlertas.disparadas;
    console.log(
      `[Recolector] Alertas evaluadas=${rAlertas.totalEvaluadas}, disparadas=${rAlertas.disparadas}`
    );
  } catch (error) {
    resumen.alertas.errores.push(error.message);
  }

  try {
    const noticias = await conReintentos(() => obtenerNoticiasWeb(), {
      intentos: 2,
      esperaBaseMs: 1500,
      etiqueta: "NOTICIAS_WEB",
    });
    resumen.noticias_web.totalFuente = noticias.noticias.length;
    for (const item of noticias.noticias) {
      try {
        resumen.noticias_web.insertados += await insertNoticia(item);
      } catch (error) {
        resumen.noticias_web.errores.push(`Noticia ${item.fuente || "n/d"}: ${error.message}`);
      }
    }
    if (Array.isArray(noticias.errores) && noticias.errores.length) {
      resumen.noticias_web.errores.push(...noticias.errores);
    }
    if (Array.isArray(noticias.advertencias) && noticias.advertencias.length) {
      console.warn("[Recolector] Advertencias noticias web:", noticias.advertencias);
    }
  } catch (error) {
    resumen.noticias_web.errores.push(error.message);
  }

  try {
    const mercados = await conReintentos(() => obtenerMercadosWeb(), {
      intentos: 2,
      esperaBaseMs: 1500,
      etiqueta: "MERCADOS_WEB",
    });
    resumen.mercados_web.totalFuente = mercados.items.length;
    for (const item of mercados.items) {
      try {
        resumen.mercados_web.insertados += await insertPrecio(item, {
          perfilValidacion: "web",
        });
      } catch (error) {
        resumen.mercados_web.errores.push(
          `MercadoWeb ${item.cultivo || "n/d"} ${item.mercado || "n/d"}: ${error.message}`
        );
      }
    }
    if (Array.isArray(mercados.errores) && mercados.errores.length) {
      resumen.mercados_web.errores.push(...mercados.errores);
    }
  } catch (error) {
    resumen.mercados_web.errores.push(error.message);
  }

  try {
    const snap = await generarSnapshotMercado(resumen);
    resumen.snapshot.id = snap.snapshotId;
    resumen.snapshot.totalItems = snap.totalItems;
    resumen.snapshot.fuentesOk = snap.fuentesOk;
    resumen.snapshot.fuentesError = snap.fuentesError;
    resumen.snapshot.datosCompletos = snap.datosCompletos;
  } catch (error) {
    resumen.snapshot.errores.push(error.message);
  }

  const totalErrores =
    resumen.precios.errores.length +
    resumen.tipo_cambio.errores.length +
    resumen.clima.errores.length +
    resumen.alertas.errores.length +
    resumen.hacienda.errores.length +
    resumen.insumos.errores.length +
    resumen.matba.errores.length +
    resumen.bcr_gix.errores.length +
    resumen.papa.errores.length +
    resumen.noticias_web.errores.length +
    resumen.mercados_web.errores.length +
    resumen.snapshot.errores.length;

  if (totalErrores > 0) {
    resumen.ok = false;
  }

  console.log(
    "[Recolector] Resultado:",
    JSON.stringify(
      {
        precios_insertados: resumen.precios.insertados,
        precios_cac_insertados: resumen.precios.cacInsertados,
        precios_fuente: resumen.precios.fuentePrincipal,
        tipo_cambio_insertados: resumen.tipo_cambio.insertados,
        clima_insertados: resumen.clima.insertados,
        bcr_gix_insertados: resumen.bcr_gix.insertados,
        matba_indices_insertados: resumen.matba.indicesInsertados,
        matba_posiciones_insertadas: resumen.matba.posicionesInsertadas,
        noticias_web_insertadas: resumen.noticias_web.insertados,
        mercados_web_insertados: resumen.mercados_web.insertados,
        snapshot_id: resumen.snapshot.id,
        snapshot_items: resumen.snapshot.totalItems,
        errores: totalErrores,
      },
      null,
      2
    )
  );

  if (resumen.precios.errores.length) {
    console.error("[Recolector] Errores precios:", resumen.precios.errores);
  }
  if (resumen.tipo_cambio.errores.length) {
    console.error(
      "[Recolector] Errores tipo_cambio:",
      resumen.tipo_cambio.errores
    );
  }
  if (resumen.clima.errores.length) {
    console.error("[Recolector] Errores clima:", resumen.clima.errores);
  }
  if (resumen.matba.errores.length) {
    console.error("[Recolector] Errores MATba:", resumen.matba.errores);
  }
  if (resumen.bcr_gix.errores.length) {
    console.error("[Recolector] Errores BCR GIX:", resumen.bcr_gix.errores);
  }
  if (resumen.noticias_web.errores.length) {
    console.error("[Recolector] Errores noticias web:", resumen.noticias_web.errores);
  }
  if (resumen.mercados_web.errores.length) {
    console.error("[Recolector] Errores mercados web:", resumen.mercados_web.errores);
  }

  return resumen;
};

const iniciarCronRecolector = () => {
  const tz = "America/Argentina/Buenos_Aires";
  cron.schedule(
    "0 7 * * 1-5",
    async () => {
      try {
        await ejecutarRecolectorDiario();
      } catch (error) {
        console.error("[Recolector] Error inesperado en cron:", error.message);
      }
    },
    { timezone: tz }
  );
  cron.schedule(
    "15 10-18 * * 1-5",
    async () => {
      try {
        await recolectarPreciosCACFresco();
      } catch (error) {
        console.error("[Recolector][CAC] Error inesperado en cron intradiario:", error.message);
      }
    },
    { timezone: tz }
  );
  console.log(
    "Cron recolector activado: diario L-V 7am + CAC intradiario cada hora (10:15 a 18:15 AR)."
  );
};

module.exports = {
  ejecutarRecolectorDiario,
  recolectarPreciosCACFresco,
  iniciarCronRecolector,
};
