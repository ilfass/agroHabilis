const { query } = require("../config/database");
const { obtenerFletesUsuario } = require("./fletes");
const CATALOGO = require("../config/productos");

const normalizarMercado = (txt = "") =>
  String(txt)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();

const inferirCategoria = (mercado = "") => {
  const m = normalizarMercado(mercado);
  if (m.includes("matba") || m.includes("futuro")) return { categoria: "futuros", subcategoria: "futuro" };
  if (m.includes("dolar") || m.includes("blue") || m.includes("mep") || m.includes("ccl")) {
    return { categoria: "tipo_cambio", subcategoria: "spot" };
  }
  if (m.includes("hacienda") || m.includes("novillo") || m.includes("liniers")) {
    return { categoria: "ganaderia", subcategoria: "vacunos" };
  }
  return { categoria: "granos", subcategoria: "disponible" };
};

const normalizar = (txt = "") =>
  String(txt || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const limitar = (txt, max) => {
  if (txt === null || txt === undefined) return null;
  return String(txt).trim().slice(0, max);
};

const construirCatalogoProductos = () => {
  const out = [];
  const agregar = (categoria, subcategoria, producto) => {
    if (!producto) return;
    out.push({ categoria, subcategoria, producto: normalizar(producto) });
  };

  const granos = CATALOGO?.granos || {};
  for (const [region, productos] of Object.entries(granos)) {
    for (const p of productos || []) agregar("granos", region, p);
  }
  const gan = CATALOGO?.ganaderia || {};
  for (const [sub, productos] of Object.entries(gan)) {
    for (const p of productos || []) agregar("ganaderia", sub, p);
  }
  for (const tc of CATALOGO?.tipo_cambio || []) agregar("tipo_cambio", "spot", tc);
  return out;
};

async function generarSnapshotMercado(resumenRecolector = {}) {
  const fuentesError = [];
  const fuentesOk = [];
  const fechaRes = await query("SELECT CURRENT_DATE AS fecha");
  const horaRes = await query("SELECT CURRENT_TIME::time(0) AS hora");
  const fecha = fechaRes.rows[0].fecha;
  const hora = horaRes.rows[0].hora;

  const cab = await query(
    `
      INSERT INTO mercado_snapshot (fecha, hora, fuentes_ok, fuentes_error, total_items, datos_completos)
      VALUES ($1, $2, '{}'::text[], '{}'::text[], 0, false)
      ON CONFLICT (fecha, hora) DO UPDATE SET creado_en = NOW()
      RETURNING id
    `,
    [fecha, hora]
  );
  const snapshotId = cab.rows[0].id;

  const precios = await query(
    `
      SELECT p.*
      FROM precios p
      JOIN (
        SELECT LOWER(cultivo) AS cultivo, LOWER(mercado) AS mercado, MAX(fecha) AS fecha
        FROM precios
        GROUP BY LOWER(cultivo), LOWER(mercado)
      ) u
      ON LOWER(p.cultivo) = u.cultivo
     AND LOWER(p.mercado) = u.mercado
     AND p.fecha = u.fecha
    `
  );

  for (const p of precios.rows) {
    const { categoria, subcategoria } = inferirCategoria(p.mercado);
    await query(
      `
        INSERT INTO mercado_snapshot_items (
          snapshot_id, categoria, subcategoria, producto, plaza, region, precio, precio_usd,
          moneda, unidad, fuente, confiabilidad
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `,
      [
        snapshotId,
        categoria,
        subcategoria,
        p.cultivo,
        p.mercado,
        "nacional",
        p.moneda === "ARS" ? p.precio : null,
        p.moneda === "USD" ? p.precio : null,
        p.moneda || "ARS",
        "tn",
        p.mercado,
        "media",
      ]
    );
  }
  fuentesOk.push("precios");

  try {
    const hacienda = await query(
      `
        SELECT h.*
        FROM precios_hacienda h
        JOIN (
          SELECT LOWER(categoria) categoria, MAX(fecha) fecha
          FROM precios_hacienda
          GROUP BY LOWER(categoria)
        ) u ON LOWER(h.categoria)=u.categoria AND h.fecha=u.fecha
      `
    );
    for (const h of hacienda.rows) {
      await query(
        `
          INSERT INTO mercado_snapshot_items (
            snapshot_id, categoria, subcategoria, producto, plaza, region, precio, precio_min, precio_max,
            moneda, unidad, fuente, confiabilidad
          )
          VALUES ($1,'ganaderia','vacunos',$2,'liniers','nacional',$3,$4,$5,'ARS',$6,'precios_hacienda','media')
        `,
        [
          snapshotId,
          h.categoria,
          h.precio_promedio,
          h.precio_min,
          h.precio_max,
          h.unidad || "kg",
        ]
      );
    }
    fuentesOk.push("hacienda");
  } catch (e) {
    fuentesError.push(`hacienda:${e.message}`);
  }

  try {
    const insumos = await query(
      `
        SELECT i.*
        FROM precios_insumos i
        JOIN (
          SELECT LOWER(producto) producto, MAX(fecha) fecha
          FROM precios_insumos
          GROUP BY LOWER(producto)
        ) u ON LOWER(i.producto)=u.producto AND i.fecha=u.fecha
      `
    );
    for (const i of insumos.rows) {
      await query(
        `
          INSERT INTO mercado_snapshot_items (
            snapshot_id, categoria, subcategoria, producto, plaza, region, precio, moneda, unidad,
            fuente, confiabilidad
          )
          VALUES ($1,'insumos',$2,$3,'nacional','nacional',$4,$5,$6,$7,'media')
        `,
        [
          snapshotId,
          limitar(i.categoria || "general", 50),
          limitar(i.producto, 100),
          i.precio,
          limitar(i.moneda || "ARS", 5),
          limitar(i.unidad || "unidad", 30),
          limitar(i.fuente || "precios_insumos", 50),
        ]
      );
    }
    fuentesOk.push("insumos");
  } catch (e) {
    fuentesError.push(`insumos:${e.message}`);
  }

  try {
    const tipos = await query(
      `
        SELECT t.*
        FROM tipo_cambio t
        JOIN (
          SELECT LOWER(tipo) tipo, MAX(fecha) fecha
          FROM tipo_cambio
          GROUP BY LOWER(tipo)
        ) u ON LOWER(t.tipo)=u.tipo AND t.fecha=u.fecha
      `
    );
    for (const tc of tipos.rows) {
      await query(
        `
          INSERT INTO mercado_snapshot_items (
            snapshot_id, categoria, subcategoria, producto, plaza, region, precio, moneda, unidad, fuente, confiabilidad
          )
          VALUES ($1,'tipo_cambio','spot',$2,'nacional','nacional',$3,'ARS','usd',$4,'alta')
        `,
        [snapshotId, tc.tipo, tc.valor, "dolarapi"]
      );
    }
    fuentesOk.push("tipo_cambio");
  } catch (e) {
    fuentesError.push(`tipo_cambio:${e.message}`);
  }

  try {
    const fut = await query(
      `
        SELECT fp.*
        FROM futuros_posiciones fp
        JOIN (
          SELECT LOWER(cultivo) cultivo, posicion, MAX(fecha) fecha
          FROM futuros_posiciones
          GROUP BY LOWER(cultivo), posicion
        ) u ON LOWER(fp.cultivo)=u.cultivo AND fp.posicion=u.posicion AND fp.fecha=u.fecha
      `
    );
    for (const f of fut.rows) {
      await query(
        `
          INSERT INTO mercado_snapshot_items (
            snapshot_id, categoria, subcategoria, producto, plaza, region, precio_usd, moneda, unidad,
            posicion, fuente, confiabilidad
          )
          VALUES ($1,'futuros','futuro',$2,'matba_rofex','nacional',$3,'USD','tn',$4,'matba','alta')
        `,
        [snapshotId, f.cultivo, f.precio_usd, f.posicion]
      );
    }
    fuentesOk.push("futuros");
  } catch (e) {
    fuentesError.push(`futuros:${e.message}`);
  }

  try {
    const usuarios = await query("SELECT id, partido, provincia, plan FROM usuarios WHERE activo = true");
    for (const u of usuarios.rows.slice(0, 100)) {
      const fletes = await obtenerFletesUsuario(u);
      for (const f of fletes) {
        if (f?.error) continue;
        const tns = Number(f.toneladas);
        const totalArs = f.costo_total_ars != null ? Number(f.costo_total_ars) : null;
        const usdTn = f.costo_usd_tn != null ? Number(f.costo_usd_tn) : null;
        const arsTn =
          f.costo_ars_tn != null && Number.isFinite(Number(f.costo_ars_tn))
            ? Number(Number(f.costo_ars_tn).toFixed(2))
            : Number.isFinite(totalArs) && Number.isFinite(tns) && tns > 0
              ? Number((totalArs / tns).toFixed(2))
              : null;
        const regionMeta =
          Number.isFinite(tns) && Number.isFinite(totalArs)
            ? `tn_ref=${String(Math.round(tns))};tot_ars=${String(Math.round(totalArs))}`.slice(0, 50)
            : "nacional";
        let precioInsert = arsTn;
        let unidadInsert = "por_tn_ars_y_usd";
        if (!Number.isFinite(arsTn) && Number.isFinite(totalArs)) {
          precioInsert = totalArs;
          unidadInsert = "total_ars_viaje";
        }
        await query(
          `
            INSERT INTO mercado_snapshot_items (
              snapshot_id, categoria, subcategoria, producto, plaza, region, precio, precio_usd, moneda, unidad,
              distancia_km, destino, fuente, confiabilidad
            )
            VALUES ($1,'fletes',$2,$3,$4,$5,$6,$7,'ARS',$8,$9,$10,'fletes_referencia','media')
          `,
          [
            snapshotId,
            f.tipo_carga || "general",
            `flete_${(f.origen || "origen").toLowerCase()}`,
            f.destino,
            regionMeta,
            precioInsert,
            Number.isFinite(usdTn) ? usdTn : null,
            unidadInsert,
            f.distancia_km || null,
            f.destino || null,
          ]
        );
      }
    }
    fuentesOk.push("fletes");
  } catch (e) {
    fuentesError.push(`fletes:${e.message}`);
  }

  try {
    const existentes = await query(
      `
        SELECT LOWER(categoria) categoria, LOWER(producto) producto
        FROM mercado_snapshot_items
        WHERE snapshot_id = $1
      `,
      [snapshotId]
    );
    const set = new Set(existentes.rows.map((r) => `${r.categoria}|${r.producto}`));
    const catalogo = construirCatalogoProductos();
    for (const c of catalogo) {
      const key = `${normalizar(c.categoria)}|${normalizar(c.producto)}`;
      if (set.has(key)) continue;
      await query(
        `
          INSERT INTO mercado_snapshot_items (
            snapshot_id, categoria, subcategoria, producto, plaza, region, precio, precio_usd, moneda, unidad,
            fuente, confiabilidad
          )
          VALUES ($1,$2,$3,$4,'nacional','nacional',NULL,NULL,'ARS','tn','catalogo_productos','baja')
        `,
        [snapshotId, c.categoria, c.subcategoria || "general", c.producto]
      );
    }
    fuentesOk.push("catalogo");
  } catch (e) {
    fuentesError.push(`catalogo:${e.message}`);
  }

  const c = await query(
    "SELECT COUNT(*)::int AS total FROM mercado_snapshot_items WHERE snapshot_id = $1",
    [snapshotId]
  );
  const total = Number(c.rows[0]?.total || 0);
  const datosCompletos = total > 0 && fuentesError.length === 0;

  await query(
    `
      UPDATE mercado_snapshot
      SET fuentes_ok = $2, fuentes_error = $3, total_items = $4, datos_completos = $5
      WHERE id = $1
    `,
    [snapshotId, fuentesOk, fuentesError, total, datosCompletos]
  );

  return { snapshotId, fecha, hora, totalItems: total, fuentesOk, fuentesError, datosCompletos };
}

/**
 * Interpreta filas `fletes` del snapshot: históricamente `precio` mezclaba total ARS del viaje con `unidad=tn`
 * mientras `precio_usd` era USD/tn (incoherente para la IA).
 */
const interpretarFilaFleteSnapshot = (r) => {
  const meta = String(r.region || "");
  const m = meta.match(/tn_ref=(\d+(?:\.\d+)?);tot_ars=(\d+)/);
  let tnRef = m ? Number(m[1]) : null;
  let totArsViaje = m ? Number(m[2]) : null;
  const pArs = r.precio != null ? Number(r.precio) : null;
  const pUsd = r.precio_usd != null ? Number(r.precio_usd) : null;
  const unidad = String(r.unidad || "");
  const legacyTotalArsEnPrecio =
    unidad === "tn" &&
    Number.isFinite(pArs) &&
    Number.isFinite(pUsd) &&
    pUsd > 0 &&
    pUsd < 250 &&
    pArs / pUsd > 8000;
  const costoUsdTn = Number.isFinite(pUsd) ? pUsd : null;
  if (legacyTotalArsEnPrecio) {
    const tot = pArs;
    const tn = tnRef && tnRef > 0 ? tnRef : 28;
    return {
      costoArsPorTn: Number((tot / tn).toFixed(2)),
      costoUsdTn,
      toneladas_referencia_viaje: tn,
      costo_total_ars_viaje: tot,
      unidad_flete: unidad || null,
    };
  }
  if (unidad === "total_ars_viaje" && Number.isFinite(pArs)) {
    return {
      costoArsPorTn: null,
      costoUsdTn,
      toneladas_referencia_viaje: tnRef,
      costo_total_ars_viaje: pArs,
      unidad_flete: unidad,
    };
  }
  return {
    costoArsPorTn: Number.isFinite(pArs) ? pArs : null,
    costoUsdTn,
    toneladas_referencia_viaje: tnRef,
    costo_total_ars_viaje: totArsViaje,
    unidad_flete: unidad || null,
  };
};

const enriquecerItemsFletesSnapshot = (rows = []) =>
  (rows || []).map((r) => {
    if (String(r.categoria || "").toLowerCase() !== "fletes") return r;
    const z = interpretarFilaFleteSnapshot(r);
    return {
      ...r,
      precio: z.costoArsPorTn,
      precio_usd: z.costoUsdTn,
      unidad: z.costoArsPorTn != null ? "por_tn_ars_y_usd" : String(r.unidad || ""),
      tot_ars_viaje_referencia: z.costo_total_ars_viaje,
      tn_referencia_viaje: z.toneladas_referencia_viaje,
    };
  });

async function obtenerSnapshotParaIA(usuario) {
  const s = await query(
    `
      SELECT *
      FROM mercado_snapshot
      ORDER BY fecha DESC, hora DESC
      LIMIT 1
    `
  );
  const snap = s.rows[0];
  if (!snap) return null;

  const items = await query(
    `
      SELECT *
      FROM mercado_snapshot_items
      WHERE snapshot_id = $1
      ORDER BY categoria, producto
    `,
    [snap.id]
  );

  const origenUsuario = (usuario?.partido || "").toLowerCase();
  const fletesUsuario = items.rows
    .filter((r) => r.categoria === "fletes" && String(r.producto || "").toLowerCase().includes(origenUsuario))
    .slice(0, 5)
    .map((r) => {
      const z = interpretarFilaFleteSnapshot(r);
      return {
        destino: r.destino,
        distancia_km: r.distancia_km,
        costo_usd_tn: z.costoUsdTn,
        costo_ars_por_tn: z.costoArsPorTn,
        toneladas_referencia_viaje: z.toneladas_referencia_viaje,
        costo_total_ars_viaje: z.costo_total_ars_viaje,
        unidad_flete: z.unidad_flete,
        fuente: r.fuente || null,
      };
    });

  const itemsParaIa = enriquecerItemsFletesSnapshot(items.rows);

  return {
    snapshot: {
      id: snap.id,
      fecha: snap.fecha,
      hora: snap.hora,
      total_items: snap.total_items,
      fuentes_ok: snap.fuentes_ok || [],
      fuentes_error: snap.fuentes_error || [],
      datos_completos: snap.datos_completos,
    },
    items: itemsParaIa,
    fletes: fletesUsuario,
  };
}

module.exports = {
  generarSnapshotMercado,
  obtenerSnapshotParaIA,
};
