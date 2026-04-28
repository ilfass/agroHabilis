const { query } = require("../config/database");

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const normalizar = (txt = "") =>
  String(txt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const obtenerGasoilActual = async () => {
  const rInsumo = await query(
    `
      SELECT precio
      FROM precios_insumos
      WHERE LOWER(producto) LIKE '%gasoil%'
      ORDER BY fecha DESC, creado_en DESC
      LIMIT 1
    `
  );
  const valInsumo = n(rInsumo.rows[0]?.precio);
  if (Number.isFinite(valInsumo)) return valInsumo;

  const rSnap = await query(
    `
      SELECT msi.precio
      FROM mercado_snapshot_items msi
      JOIN mercado_snapshot ms ON ms.id = msi.snapshot_id
      WHERE msi.categoria = 'insumos'
        AND LOWER(msi.producto) LIKE '%gasoil%'
      ORDER BY ms.fecha DESC, ms.hora DESC, msi.id DESC
      LIMIT 1
    `
  );
  return n(rSnap.rows[0]?.precio);
};

const buscarRuta = async ({ origen, destino, tipoCarga = "granos" }) => {
  const o = normalizar(origen);
  const d = normalizar(destino);
  let r = await query(
    `
      SELECT *
      FROM fletes_referencia
      WHERE activa = true
        AND LOWER(origen_nombre) = LOWER($1)
        AND LOWER(destino_nombre) = LOWER($2)
        AND tipo_carga = $3
      ORDER BY id DESC
      LIMIT 1
    `,
    [origen, destino, tipoCarga]
  );
  if (r.rows[0]) return r.rows[0];

  r = await query(
    `
      SELECT *
      FROM fletes_referencia
      WHERE activa = true
        AND tipo_carga = $1
        AND (
          LOWER(origen_nombre) LIKE '%' || LOWER($2) || '%'
          OR LOWER(origen_provincia) LIKE '%' || LOWER($2) || '%'
        )
        AND LOWER(destino_nombre) LIKE '%' || LOWER($3) || '%'
      ORDER BY distancia_km ASC
      LIMIT 1
    `,
    [tipoCarga, o, d]
  );
  return r.rows[0] || null;
};

const obtenerTarifa = async (tipoCarga = "granos") => {
  const r = await query(
    `
      SELECT *
      FROM fletes_tarifas
      WHERE tipo_carga = $1
      ORDER BY fecha DESC
      LIMIT 1
    `,
    [tipoCarga]
  );
  return r.rows[0] || null;
};

async function calcularFlete(origen, destino, tipo_carga = "granos", toneladas = 1) {
  const ruta = await buscarRuta({ origen, destino, tipoCarga: tipo_carga });
  if (!ruta) {
    return { error: "No se encontró ruta de referencia para ese origen/destino." };
  }
  const tarifa = await obtenerTarifa(tipo_carga);
  if (!tarifa) {
    return { error: `No hay tarifa vigente para tipo_carga=${tipo_carga}.` };
  }

  const gasoilActual = (await obtenerGasoilActual()) || n(tarifa.gasoil_base_ars) || 1050;
  const gasoilBase = n(tarifa.gasoil_base_ars) || gasoilActual;
  const pctGasoil = n(tarifa.porcentaje_gasoil_en_costo) ?? 35;
  const deltaGasoil = gasoilBase > 0 ? (gasoilActual - gasoilBase) / gasoilBase : 0;
  const factorAjuste = Number((1 + deltaGasoil * (pctGasoil / 100)).toFixed(4));

  const tarifaUsdBase = n(tarifa.tarifa_usd_km_tn);
  const tarifaArsBase = n(tarifa.tarifa_ars_km_tn);
  const tarifaUsdAjustada = Number.isFinite(tarifaUsdBase)
    ? Number((tarifaUsdBase * factorAjuste).toFixed(5))
    : null;
  const tarifaArsAjustada = Number.isFinite(tarifaArsBase)
    ? Number((tarifaArsBase * factorAjuste).toFixed(2))
    : null;

  const distanciaKm = n(ruta.distancia_km) || 0;
  const tns = Number.isFinite(n(toneladas)) && n(toneladas) > 0 ? n(toneladas) : 1;
  const peajesArs = ruta.tiene_peajes ? n(ruta.costo_peajes_ars) || 0 : 0;
  const costoUsdTn = Number.isFinite(tarifaUsdAjustada)
    ? Number((distanciaKm * tarifaUsdAjustada).toFixed(2))
    : null;
  const costoTotalUsd = Number.isFinite(costoUsdTn) ? Number((costoUsdTn * tns).toFixed(2)) : null;
  const costoArsTn = Number.isFinite(tarifaArsAjustada)
    ? Number((distanciaKm * tarifaArsAjustada).toFixed(2))
    : null;
  const costoTotalArs = Number.isFinite(costoArsTn)
    ? Number((costoArsTn * tns + peajesArs).toFixed(2))
    : peajesArs;

  return {
    distancia_km: distanciaKm,
    tarifa_usd_km_tn: tarifaUsdAjustada,
    costo_usd_tn: costoUsdTn,
    costo_total_usd: costoTotalUsd,
    costo_total_ars: costoTotalArs,
    peajes_ars: peajesArs,
    gasoil_factor: factorAjuste,
    gasoil_actual_ars: gasoilActual,
    ruta_referencia: ruta.ruta_referencia || `${ruta.origen_nombre} -> ${ruta.destino_nombre}`,
    origen_referencia: ruta.origen_nombre,
    destino_referencia: ruta.destino_nombre,
    nota: `Estimacion basada en tarifa ${tarifa.fuente || "referencia"} (${tipo_carga})`,
  };
}

async function obtenerFletesUsuario(usuario) {
  const origen = usuario?.partido || usuario?.provincia || "Tandil";
  const perfil = normalizar(usuario?.perfil_productivo || usuario?.perfil || "");
  const rutas = [];

  if (perfil.includes("ganad")) {
    rutas.push({ destino: "Mercado Liniers", tipo: "hacienda", toneladas: 20 });
  } else {
    rutas.push({ destino: "Puerto Rosario", tipo: "granos", toneladas: 28 });
    rutas.push({ destino: "Puerto Bahia Blanca", tipo: "granos", toneladas: 28 });
  }

  if (perfil.includes("frut")) {
    rutas.push({ destino: "Mercado Central BA", tipo: "fruta", toneladas: 22 });
  }

  const resultados = [];
  for (const r of rutas) {
    const data = await calcularFlete(origen, r.destino, r.tipo, r.toneladas);
    resultados.push({
      origen,
      destino: r.destino,
      tipo_carga: r.tipo,
      toneladas: r.toneladas,
      ...data,
    });
  }
  return resultados;
}

module.exports = {
  calcularFlete,
  obtenerFletesUsuario,
};
