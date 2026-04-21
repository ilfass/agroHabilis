const cron = require("node-cron");
const { query } = require("../config/database");
const { obtenerPreciosMAGYPFOB } = require("../scrapers/granos_magyp_fob");
const { obtenerPreciosCAC } = require("../scrapers/granos_cac");
const { obtenerTipoCambio } = require("../scrapers/dolar");
const { obtenerClima } = require("../scrapers/clima");

const insertPrecio = async (item) => {
  const precioArs = Number(item.precio_ars);
  const precioUsd = Number(item.precio_usd);

  let precio = null;
  let moneda = null;

  if (Number.isFinite(precioArs)) {
    precio = precioArs;
    moneda = "ARS";
  } else if (Number.isFinite(precioUsd)) {
    precio = precioUsd;
    moneda = "USD";
  }

  if (!precio || !item.cultivo || !item.mercado || !item.fecha) return 0;

  const result = await query(
    `
      INSERT INTO precios (cultivo, mercado, precio, moneda, fecha)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (cultivo, mercado, fecha) DO NOTHING
    `,
    [item.cultivo, item.mercado, precio, moneda, item.fecha]
  );

  return result.rowCount || 0;
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

const obtenerZonasUsuarios = async () => {
  const result = await query(
    `
      SELECT DISTINCT lat, lng
      FROM usuarios
      WHERE lat IS NOT NULL AND lng IS NOT NULL
    `
  );
  return result.rows;
};

const ejecutarRecolectorDiario = async () => {
  const resumen = {
    ok: true,
    precios: {
      fuentePrincipal: "MAGYP_FOB",
      totalFuente: 0,
      insertados: 0,
      fallbackUsado: false,
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
  };

  let precios = [];

  try {
    precios = await obtenerPreciosMAGYPFOB();
    resumen.precios.totalFuente = precios.length;
  } catch (error) {
    resumen.precios.errores.push(`MAGYP: ${error.message}`);
  }

  if (!precios.length) {
    try {
      const preciosCac = await obtenerPreciosCAC();
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
    const tipos = await obtenerTipoCambio();
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
        const pronostico = await obtenerClima(zona.lat, zona.lng);
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

  const totalErrores =
    resumen.precios.errores.length +
    resumen.tipo_cambio.errores.length +
    resumen.clima.errores.length;

  if (totalErrores > 0) {
    resumen.ok = false;
  }

  console.log(
    "[Recolector] Resultado:",
    JSON.stringify(
      {
        precios_insertados: resumen.precios.insertados,
        precios_fuente: resumen.precios.fuentePrincipal,
        tipo_cambio_insertados: resumen.tipo_cambio.insertados,
        clima_insertados: resumen.clima.insertados,
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
  console.log("Cron job de recolección activado - corre L-V a las 7am");
};

module.exports = {
  ejecutarRecolectorDiario,
  iniciarCronRecolector,
};
