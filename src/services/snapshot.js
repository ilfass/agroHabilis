const { query } = require("../config/database");
const { obtenerFletesUsuario } = require("./fletes");

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
        await query(
          `
            INSERT INTO mercado_snapshot_items (
              snapshot_id, categoria, subcategoria, producto, plaza, region, precio, precio_usd, moneda, unidad,
              distancia_km, destino, fuente, confiabilidad
            )
            VALUES ($1,'fletes',$2,$3,$4,$5,$6,$7,'ARS','tn',$8,$9,'fletes_referencia','media')
          `,
          [
            snapshotId,
            f.tipo_carga || "general",
            `flete_${(f.origen || "origen").toLowerCase()}`,
            f.destino,
            "nacional",
            f.costo_total_ars || null,
            f.costo_usd_tn || null,
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
    .map((r) => ({
      destino: r.destino,
      distancia_km: r.distancia_km,
      costo_usd_tn: r.precio_usd,
      costo_total_ars: r.precio,
    }));

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
    items: items.rows,
    fletes: fletesUsuario,
  };
}

module.exports = {
  generarSnapshotMercado,
  obtenerSnapshotParaIA,
};
