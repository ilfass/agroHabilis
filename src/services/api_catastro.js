const express = require("express");
const { query } = require("../config/database");
const { generarCodigo, PREFIJOS } = require("../utils/codigo_visible");

const router = express.Router();

// ===== FIRMAS =====
router.get("/firmas", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const { rows } = await query("SELECT * FROM firmas WHERE usuario_id = $1 ORDER BY nombre", [uid]);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/firmas", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const nombre = String(req.body.nombre || "").trim();
    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });
    const codigo = await generarCodigo(query, "firmas", PREFIJOS.firmas, uid);
    const { rows } = await query(
      "INSERT INTO firmas (usuario_id, nombre, codigo) VALUES ($1, $2, $3) RETURNING *",
      [uid, nombre, codigo]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put("/firmas/:id", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const nombre = String(req.body.nombre || "").trim();
    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });
    const { rows } = await query("UPDATE firmas SET nombre=$1 WHERE id=$2 AND usuario_id=$3 RETURNING *", [nombre, req.params.id, uid]);
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete("/firmas/:id", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    await query("DELETE FROM firmas WHERE id=$1 AND usuario_id=$2", [req.params.id, uid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ===== CAMPOS =====
router.get("/campos", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const { rows } = await query("SELECT * FROM campos WHERE usuario_id = $1 ORDER BY nombre", [uid]);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/campos", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const nombre = String(req.body.nombre || "").trim();
    const firma_id = req.body.firma_id ? Number(req.body.firma_id) : null;
    const ciudad = String(req.body.ciudad || "").trim();
    const provincia = String(req.body.provincia || "").trim();
    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });
    const codigo = await generarCodigo(query, "campos", PREFIJOS.campos, uid);
    const { rows } = await query(
      "INSERT INTO campos (usuario_id, firma_id, nombre, ciudad, provincia, codigo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [uid, firma_id, nombre, ciudad, provincia, codigo]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put("/campos/:id", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const nombre = String(req.body.nombre || "").trim();
    const firma_id = req.body.firma_id ? Number(req.body.firma_id) : null;
    const ciudad = String(req.body.ciudad || "").trim();
    const provincia = String(req.body.provincia || "").trim();
    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });
    const { rows } = await query(
      "UPDATE campos SET nombre=$1, firma_id=$2, ciudad=$3, provincia=$4 WHERE id=$5 AND usuario_id=$6 RETURNING *",
      [nombre, firma_id, ciudad, provincia, req.params.id, uid]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete("/campos/:id", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    await query("DELETE FROM campos WHERE id=$1 AND usuario_id=$2", [req.params.id, uid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ===== LOTES (superficies extensivas: pastoreo, agricultura) =====
router.get("/lotes", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    // No incluir tipo feedlot/corral — esos ahora están en sus propias tablas
    const { rows } = await query(
      `SELECT * FROM ubicaciones WHERE usuario_id = $1
       AND tipo NOT IN ('feedlot', 'corral')
       ORDER BY nombre`,
      [uid]
    );
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/lotes", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const nombre = String(req.body.nombre || "").trim();
    const campo_id = req.body.campo_id ? Number(req.body.campo_id) : null;
    const hectareas = req.body.hectareas ? Number(req.body.hectareas) : null;
    const lat = req.body.lat ? Number(req.body.lat) : null;
    const lng = req.body.lng ? Number(req.body.lng) : null;
    const geojson = req.body.geojson || null;
    const tipo = req.body.tipo ? String(req.body.tipo).trim() : 'lote';
    const firma = req.body.firma ? String(req.body.firma).trim() : null;
    const provincia = req.body.provincia ? String(req.body.provincia).trim() : null;
    const partido = req.body.partido ? String(req.body.partido).trim() : null;
    const cultivo = req.body.cultivo ? String(req.body.cultivo).trim() : null;
    const variedad = req.body.variedad ? String(req.body.variedad).trim() : null;
    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });

    const codigo = await generarCodigo(query, "ubicaciones", PREFIJOS.lotes, uid);
    const { rows } = await query(
      `INSERT INTO ubicaciones (usuario_id, nombre, campo_id, hectareas, lat, lng, geojson, tipo, codigo)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
       RETURNING *`,
      [uid, nombre, campo_id, hectareas, lat, lng, geojson ? JSON.stringify(geojson) : null, tipo, codigo]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put("/lotes/:id", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const nombre = String(req.body.nombre || "").trim();
    const campo_id = req.body.campo_id ? Number(req.body.campo_id) : null;
    const hectareas = req.body.hectareas ? Number(req.body.hectareas) : null;
    const lat = req.body.lat ? Number(req.body.lat) : null;
    const lng = req.body.lng ? Number(req.body.lng) : null;
    const geojson = req.body.geojson !== undefined ? req.body.geojson : undefined;
    const tipo = req.body.tipo ? String(req.body.tipo).trim() : undefined;
    const firma = req.body.firma !== undefined ? (req.body.firma ? String(req.body.firma).trim() : null) : undefined;
    const provincia = req.body.provincia !== undefined ? (req.body.provincia ? String(req.body.provincia).trim() : null) : undefined;
    const partido = req.body.partido !== undefined ? (req.body.partido ? String(req.body.partido).trim() : null) : undefined;
    const cultivo = req.body.cultivo !== undefined ? (req.body.cultivo ? String(req.body.cultivo).trim() : null) : undefined;
    const variedad = req.body.variedad !== undefined ? (req.body.variedad ? String(req.body.variedad).trim() : null) : undefined;
    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });

    let sql = "UPDATE ubicaciones SET nombre=$1, campo_id=$2, hectareas=$3, lat=$4, lng=$5";
    let params = [nombre, campo_id, hectareas, lat, lng];
    let idx = 6;

    if (geojson !== undefined) { sql += `, geojson=$${idx}::jsonb`; params.push(geojson ? JSON.stringify(geojson) : null); idx++; }
    if (tipo !== undefined) { sql += `, tipo=$${idx}`; params.push(tipo); idx++; }
                    
    sql += ` WHERE id=$${idx} AND usuario_id=$${idx+1} RETURNING *`;
    params.push(req.params.id, uid);
    const { rows } = await query(sql, params);
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete("/lotes/:id", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    await query("DELETE FROM ubicaciones WHERE id=$1 AND usuario_id=$2", [req.params.id, uid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ===== FEEDLOTS (instalación de engorde, hija de campo) =====
router.get("/feedlots", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const { rows } = await query(
      `SELECT f.*,
              c.nombre AS campo_nombre,
              (SELECT COUNT(*) FROM ubicaciones cr WHERE cr.ubicacion_padre_id = f.id AND cr.tipo = 'corral') AS total_corrales
       FROM ubicaciones f
       LEFT JOIN campos c ON c.id = f.campo_id
       WHERE f.usuario_id = $1 AND f.tipo = 'feedlot'
       ORDER BY f.nombre`,
      [uid]
    );
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/feedlots", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const nombre = String(req.body.nombre || "").trim();
    const campo_id = req.body.campo_id ? Number(req.body.campo_id) : null;
    const capacidad_cabezas = req.body.capacidad_cabezas != null ? Number(req.body.capacidad_cabezas) : null;
    const tipo_encierre = req.body.tipo_encierre ? String(req.body.tipo_encierre).trim() : null;
    const provincia = req.body.provincia ? String(req.body.provincia).trim() : null;
    const partido = req.body.partido ? String(req.body.partido).trim() : null;
    const lat = req.body.lat ? Number(req.body.lat) : null;
    const lng = req.body.lng ? Number(req.body.lng) : null;
    const geojson = req.body.geojson || null;
    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });

    const codigo = await generarCodigo(query, "ubicaciones", PREFIJOS.feedlots, uid);
    const { rows } = await query(
      `INSERT INTO ubicaciones (usuario_id, campo_id, nombre, capacidad_cabezas, tipo_encierre, lat, lng, geojson, codigo, tipo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'feedlot')
       RETURNING *`,
      [uid, campo_id, nombre, capacidad_cabezas, tipo_encierre, lat, lng, geojson ? JSON.stringify(geojson) : null, codigo]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put("/feedlots/:id", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const nombre = String(req.body.nombre || "").trim();
    const campo_id = req.body.campo_id ? Number(req.body.campo_id) : null;
    const capacidad_cabezas = req.body.capacidad_cabezas != null ? Number(req.body.capacidad_cabezas) : null;
    const tipo_encierre = req.body.tipo_encierre ? String(req.body.tipo_encierre).trim() : null;
    const lat = req.body.lat ? Number(req.body.lat) : null;
    const lng = req.body.lng ? Number(req.body.lng) : null;
    const geojson = req.body.geojson !== undefined ? req.body.geojson : undefined;
    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });

    let sql = "UPDATE ubicaciones SET nombre=$1, campo_id=$2, capacidad_cabezas=$3, tipo_encierre=$4, lat=$5, lng=$6";
    let params = [nombre, campo_id, capacidad_cabezas, tipo_encierre, lat, lng];
    let idx = 7;
    if (geojson !== undefined) { sql += `, geojson=$${idx}::jsonb`; params.push(geojson ? JSON.stringify(geojson) : null); idx++; }
    sql += ` WHERE id=$${idx} AND usuario_id=$${idx+1} RETURNING *`;
    params.push(req.params.id, uid);

    const { rows } = await query(sql, params);
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete("/feedlots/:id", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    // Cascade eliminará corrales automáticamente
    await query("DELETE FROM ubicaciones WHERE id=$1 AND usuario_id=$2", [req.params.id, uid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ===== CORRALES (subdivisión dentro de feedlot) =====
router.get("/corrales", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const feedlot_id = req.query.feedlot_id ? Number(req.query.feedlot_id) : null;
    let sql = `SELECT cr.*, f.nombre AS feedlot_nombre
               FROM ubicaciones cr
               JOIN ubicaciones f ON f.id = cr.ubicacion_padre_id
               WHERE cr.usuario_id = $1 AND cr.tipo = 'corral'`;
    const params = [uid];
    if (feedlot_id) {
      sql += ` AND cr.ubicacion_padre_id = $2`;
      params.push(feedlot_id);
    }
    sql += ` ORDER BY f.nombre, cr.nombre`;
    const { rows } = await query(sql, params);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/corrales", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const feedlot_id = req.body.feedlot_id ? Number(req.body.feedlot_id) : null;
    const nombre = String(req.body.nombre || "").trim();
    const tipo_corral = req.body.tipo_corral ? String(req.body.tipo_corral).trim() : 'engorde';
    const capacidad_cabezas = req.body.capacidad_cabezas != null ? Number(req.body.capacidad_cabezas) : null;
    if (!feedlot_id) return res.status(400).json({ ok: false, error: "feedlot_id requerido" });
    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });

    const codigo = await generarCodigo(query, "ubicaciones", PREFIJOS.corrales, uid);
    const { rows } = await query(
      `INSERT INTO corrales (usuario_id, feedlot_id, nombre, tipo_corral, capacidad_cabezas, codigo)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [uid, feedlot_id, nombre, tipo_corral, capacidad_cabezas, codigo]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put("/corrales/:id", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const nombre = String(req.body.nombre || "").trim();
    const tipo_corral = req.body.tipo_corral ? String(req.body.tipo_corral).trim() : 'engorde';
    const capacidad_cabezas = req.body.capacidad_cabezas != null ? Number(req.body.capacidad_cabezas) : null;
    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });

    const { rows } = await query(
      `UPDATE ubicaciones SET nombre=$1, tipo_encierre=$2, capacidad_cabezas=$3
       WHERE id=$4 AND usuario_id=$5 RETURNING *`,
      [nombre, tipo_corral, capacidad_cabezas, req.params.id, uid]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete("/corrales/:id", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    await query("DELETE FROM ubicaciones WHERE id=$1 AND usuario_id=$2", [req.params.id, uid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
