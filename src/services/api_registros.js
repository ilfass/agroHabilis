const express = require("express");
const { query } = require("../config/database");

const router = express.Router();

// 1. Ganadería: Carga Ganadera Declarada
router.post("/ganaderia/perfil", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const especie = String(req.body.especie || "").trim();
    const categoria = String(req.body.categoria || "").trim();
    const cantidad = req.body.cantidad ? Number(req.body.cantidad) : 0;

    if (!especie || !categoria) {
      return res.status(400).json({ ok: false, error: "Especie y categoría requeridas" });
    }

    // Upsert para actualizar o crear
    const sql = `
      INSERT INTO usuario_ganaderia_perfil (usuario_id, especie, categoria, cantidad_estimada, activo)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (usuario_id, especie, categoria) 
      DO UPDATE SET cantidad_estimada = $4, activo = true, creado_en = NOW()
      RETURNING *
    `;
    const { rows } = await query(sql, [uid, especie, categoria, cantidad]);
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 2. Ganadería: Trazabilidad Individual Animal
router.post("/ganaderia/animal", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const caravana = req.body.caravana ? String(req.body.caravana).trim() : null;
    const categoria = String(req.body.categoria || "").trim();
    const raza = req.body.raza ? String(req.body.raza).trim() : null;
    const lote_id = req.body.lote_id ? Number(req.body.lote_id) : null;
    const peso = req.body.peso ? Number(req.body.peso) : null;
    const estado = String(req.body.estado || "sano").trim();
    const fecha_ingreso = req.body.fecha_ingreso || new Date().toISOString().slice(0, 10);

    if (!categoria) {
      return res.status(400).json({ ok: false, error: "Categoría requerida" });
    }

    // Insert en animales_individuales
    const sql = `
      INSERT INTO animales_individuales (usuario_id, lote_id, caravana, categoria, raza, peso, estado, fecha_ingreso)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const { rows } = await query(sql, [uid, lote_id, caravana, categoria, raza, peso, estado, fecha_ingreso]);
    
    // Si hay peso inicial, registrar también el evento en animales_eventos
    if (peso) {
      const sqlEvento = `
        INSERT INTO animales_eventos (usuario_id, animal_id, tipo_evento, fecha, valor_numerico, observaciones)
        VALUES ($1, $2, 'pesaje', $3, $4, 'Pesaje inicial al ingreso')
      `;
      await query(sqlEvento, [uid, rows[0].id, fecha_ingreso, peso]);
    }

    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 3. Pasturas: Semáforo de Pastura
router.post("/pasturas/evento", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const lote_id = req.body.lote_id ? Number(req.body.lote_id) : null;
    const tipo = String(req.body.tipo || "").trim();
    const cabezas = req.body.cabezas ? Number(req.body.cabezas) : null;
    const dias_descanso = req.body.dias_descanso ? Number(req.body.dias_descanso) : null;
    const observacion = req.body.observacion ? String(req.body.observacion).trim() : null;
    const fecha = req.body.fecha_evento || new Date().toISOString().slice(0, 10);

    if (!lote_id || !tipo) {
      return res.status(400).json({ ok: false, error: "Lote y tipo requeridos" });
    }

    // Obtener nombre del lote para el evento
    const { rows: loteRows } = await query("SELECT nombre FROM ubicaciones WHERE id = $1 AND usuario_id = $2", [lote_id, uid]);
    const lote_nombre = loteRows.length ? loteRows[0].nombre : 'Lote Desconocido';

    const sql = `
      INSERT INTO eventos_pastura (usuario_id, lote_id, lote_nombre, tipo, cabezas, dias_descanso, observacion, fecha_evento)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const { rows } = await query(sql, [uid, lote_id, lote_nombre, tipo, cabezas, dias_descanso, observacion, fecha]);
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 4. Agricultura: Plan de Arrendamiento
router.post("/agricultura/arrendamiento", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const lote_id = req.body.lote_id ? Number(req.body.lote_id) : null;
    const costo = req.body.costo ? Number(req.body.costo) : null;

    if (!lote_id || costo === null) {
      return res.status(400).json({ ok: false, error: "Lote y costo requeridos" });
    }

    // 1. Actualizar ubicacion: setear arrendado = true (o false si costo es 0)
    const arrendado = costo > 0;
    await query("UPDATE ubicaciones SET arrendado = $1 WHERE id = $2 AND usuario_id = $3", [arrendado, lote_id, uid]);

    // 2. Registrar el movimiento en inventario_movimiento para mantener el histórico
    const payload = JSON.stringify({ costo_arrendamiento: costo });
    const fecha_ref = new Date().toISOString().slice(0, 10);
    const sql = `
      INSERT INTO inventario_movimiento (usuario_id, lote_id, dominio, clase, efecto, payload, fecha_referencia, estado)
      VALUES ($1, $2, 'cultivo', 'stock', 'replace', $3, $4, 'confirmado')
      RETURNING *
    `;
    const { rows } = await query(sql, [uid, lote_id, payload, fecha_ref]);
    
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 5. Plan de Siembra
router.get("/plan_siembra", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const { rows } = await query("SELECT * FROM plan_siembra WHERE usuario_id = $1 ORDER BY id DESC", [uid]);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/plan_siembra", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const { ubicacion_id, cultivo, campania, variedad, densidad, fecha_estimada, estado } = req.body;
    const sql = `
      INSERT INTO plan_siembra (usuario_id, ubicacion_id, cultivo, campania, variedad, densidad, fecha_estimada, estado)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
    `;
    const params = [uid, ubicacion_id, cultivo, campania, variedad, densidad || null, fecha_estimada || null, estado || 'planificado'];
    const { rows } = await query(sql, params);
    
    if (fecha_estimada) {
      await query(
        `INSERT INTO eventos_calendario (usuario_id, titulo, descripcion, fecha_inicio, fecha_fin, categoria, ubicacion_id)
         VALUES ($1, $2, $3, $4, $4, 'Siembra', $5)`,
        [uid, `Siembra planificada de ${cultivo}`, `Campaña ${campania}. Variedad: ${variedad || 'N/A'}. Densidad: ${densidad || 'N/A'}.`, fecha_estimada, ubicacion_id]
      );
    }
    
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.put("/plan_siembra/:id", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const { id } = req.params;
    const { ubicacion_id, cultivo, campania, variedad, densidad, fecha_estimada, estado } = req.body;
    const sql = `
      UPDATE plan_siembra 
      SET ubicacion_id=$1, cultivo=$2, campania=$3, variedad=$4, densidad=$5, fecha_estimada=$6, estado=$7, actualizado_en=NOW()
      WHERE id=$8 AND usuario_id=$9 RETURNING *
    `;
    const params = [ubicacion_id, cultivo, campania, variedad, densidad || null, fecha_estimada || null, estado || 'planificado', id, uid];
    const { rows } = await query(sql, params);
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete("/plan_siembra/:id", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    await query("DELETE FROM plan_siembra WHERE id = $1 AND usuario_id = $2", [req.params.id, uid]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 6. Catálogo de Campañas
router.get("/campanias", async (req, res) => {
  try {
    const { rows } = await query("SELECT valor FROM sistema_catalogos WHERE categoria='campania' AND activo=true ORDER BY orden ASC");
    res.json({ ok: true, data: rows.map(r => r.valor) });
  } catch (e) {
    // Si la tabla no existe aún por falta de migración, devolver un default
    res.json({ ok: true, data: ['23/24', '24/25', '25/26'] });
  }
});

// 7. Cultivos y Pasturas Activas (usuario_cultivos)
router.get("/usuario_cultivos", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const { rows } = await query("SELECT * FROM usuario_cultivos WHERE usuario_id = $1 ORDER BY id DESC", [uid]);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/usuario_cultivos", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    const { cultivo, campania, hectareas, costo_por_ha } = req.body;
    if (!cultivo) return res.status(400).json({ ok: false, error: "El nombre del cultivo/pastura es requerido" });

    const sql = `
      INSERT INTO usuario_cultivos (usuario_id, cultivo, campania, hectareas, costo_por_ha, activo)
      VALUES ($1, $2, $3, $4, $5, true) RETURNING *
    `;
    const params = [uid, cultivo, campania || null, hectareas || null, costo_por_ha || null];
    const { rows } = await query(sql, params);
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete("/usuario_cultivos/:id", async (req, res) => {
  try {
    const { id: uid } = req.clienteSession.user;
    await query("DELETE FROM usuario_cultivos WHERE id = $1 AND usuario_id = $2", [req.params.id, uid]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
