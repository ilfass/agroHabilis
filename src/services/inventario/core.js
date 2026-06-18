"use strict";

const { query } = require("../../config/database");
const { fechaISOArgentina } = require("../../utils/fecha_ar");
const { generarCodigo, PREFIJOS } = require("../../utils/codigo_visible");

const ESPECIES_KEYS = [
  { especie: "vacuno", keys: ["vacuno", "bovino", "novillo", "novillos", "ternero", "terneros", "vaca", "vacas", "vaquillona", "toro", "toros", "cabez"] },
  { especie: "porcino", keys: ["porcino", "cerdo", "chancho"] },
  { especie: "ovino", keys: ["ovino", "oveja", "ovejas", "cordero", "carnero"] },
  { especie: "caprino", keys: ["caprino", "cabra", "chivo"] },
  { especie: "camelido", keys: ["llama", "alpaca"] },
  { especie: "equino", keys: ["caballo", "yegua", "equino"] },
  { especie: "avicola", keys: ["pollo", "gallina", "avicola"] },
];

const normalizarSlug = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

const inferirEspecieDesdeEtiqueta = (etiqueta = "") => {
  const t = normalizarSlug(etiqueta).replace(/_/g, " ");
  const hit = ESPECIES_KEYS.find((e) => e.keys.some((k) => t.includes(normalizarSlug(k).replace(/_/g, ""))));
  return hit?.especie || "vacuno";
};

const itemClaveGanado = (especie, categoriaHumana) => `g:${normalizarSlug(especie)}:${normalizarSlug(categoriaHumana)}`;

const itemClaveCultivo = (cultivo) => `c:${normalizarSlug(cultivo)}`;

function normalizarUnidadInsumo(u = "") {
  const raw = String(u || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!raw) return "un";
  if (/^kgs?$|^kilos?$/.test(raw)) return "kg";
  if (/^(l(t(s)?)?|litros?)$/.test(raw)) return "lt";
  if (/^bols/.test(raw)) return "bolsa";
  if (/^tn|^ton|^tonela/.test(raw)) return "tn";
  if (/^uni/.test(raw) || raw === "u") return "un";
  const slug = normalizarSlug(raw).replace(/^_+|_+$/g, "").slice(0, 12);
  return slug || "un";
}

const itemClaveInsumo = (producto, unidadCodigo) =>
  `i:${normalizarSlug(producto)}:${normalizarSlug(unidadCodigo || "un")}`;

/** Stock físico de grano (tn), distinto de superficie en ha (dominio cultivo). */
const itemClaveGrano = (cultivo) => `gr:${normalizarSlug(cultivo)}`;

function claseDominioMovimiento(dominio) {
  if (dominio === "insumo") return "insumo";
  if (dominio === "grano") return "grano";
  return "stock";
}

async function leerCantidadSaldoActual(usuarioId, dominio, itemClave, ubicacionId, campanaId) {
  const r = await query(
    `
      SELECT cantidad
      FROM inventario_saldo
      WHERE usuario_id = $1
        AND dominio = $2
        AND item_clave = $3
        AND (ubicacion_id IS NOT DISTINCT FROM $4)
        AND (campana_id IS NOT DISTINCT FROM $5)
      LIMIT 1
    `,
    [usuarioId, dominio, itemClave, ubicacionId, campanaId]
  );
  if (!r.rows.length) return 0;
  const n = Number(r.rows[0].cantidad);
  return Number.isFinite(n) ? n : 0;
}

async function asegurarLoteUsuario(usuarioId, ubicacionId) {
  if (ubicacionId == null || ubicacionId === "") return;
  const id = Number(ubicacionId);
  if (!Number.isFinite(id)) throw new Error("lote_invalido");
  const r = await query(`SELECT 1 FROM ubicaciones WHERE id = $1 AND usuario_id = $2 LIMIT 1`, [id, usuarioId]);
  if (!r.rows.length) throw new Error("Lote no válido o no pertenece al usuario.");
}

async function asegurarCampanaUsuario(usuarioId, campanaId) {
  if (campanaId == null || campanaId === "") return;
  const id = Number(campanaId);
  if (!Number.isFinite(id)) throw new Error("campana_invalida");
  const r = await query(`SELECT 1 FROM campanas_agricolas WHERE id = $1 AND usuario_id = $2 LIMIT 1`, [
    id,
    usuarioId,
  ]);
  if (!r.rows.length) throw new Error("Campaña no válida o no pertenece al usuario.");
}

async function listarCampanasUsuario(usuarioId) {
  if (!usuarioId) return [];
  const r = await query(
    `
      SELECT id, nombre, fecha_inicio, fecha_fin, activa, comentarios
      FROM campanas_agricolas
      WHERE usuario_id = $1
      ORDER BY activa DESC NULLS LAST, id DESC
      LIMIT 80
    `,
    [usuarioId]
  );
  return r.rows || [];
}

async function crearCampanaUsuario({ usuarioId, nombre, fechaInicio = null, fechaFin = null }) {
  const n = String(nombre || "").trim();
  if (!n) throw new Error("nombre_campana_obligatorio");
  const r = await query(
    `
      INSERT INTO campanas_agricolas (usuario_id, nombre, fecha_inicio, fecha_fin, activa)
      VALUES ($1, $2, $3, $4, true)
      RETURNING id, nombre, fecha_inicio, fecha_fin, activa, comentarios
    `,
    [usuarioId, n, fechaInicio || null, fechaFin || null]
  );
  return r.rows[0];
}

async function editarCampanaUsuario({ usuarioId, campanaId, nombre, comentarios }) {
  const n = String(nombre || "").trim();
  if (!n) throw new Error("nombre_campana_obligatorio");
  const r = await query(
    `
      UPDATE campanas_agricolas
      SET nombre = $3,
          comentarios = $4
      WHERE id = $2 AND usuario_id = $1
      RETURNING id, nombre, fecha_inicio, fecha_fin, activa, comentarios
    `,
    [usuarioId, campanaId, n, comentarios || null]
  );
  return r.rows[0];
}

async function resolverCampanaPorNombre(usuarioId, fragmento = "") {
  const frag = String(fragmento || "").trim();
  if (!frag || !usuarioId) return null;
  const todos = await listarCampanasUsuario(usuarioId);
  const normFrag = normalizarSlug(frag);
  const scored = todos
    .map((c) => {
      const cn = normalizarSlug(c.nombre || "");
      let score = 0;
      if (cn === normFrag) score = 100;
      else if (cn.includes(normFrag) || normFrag.includes(cn)) score = 60;
      else if (normFrag.split("_").every((tok) => tok && cn.includes(tok))) score = 40;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.c || null;
}

async function listarLotesUsuario(usuarioId) {
  if (!usuarioId) return [];
  const r = await query(
    `
      SELECT id, nombre, hectareas, cultivo, arrendado, cliente, firma, provincia, partido, tipo, lat, lng, codigo
      FROM ubicaciones
      WHERE usuario_id = $1
        AND (tipo IS NULL OR tipo NOT IN ('feedlot','corral'))
      ORDER BY nombre NULLS LAST, id ASC
    `,
    [usuarioId]
  );
  return r.rows || [];
}

async function crearLoteUsuario({ 
  usuarioId, 
  nombre, 
  hectareas = null, 
  cultivo = null, 
  arrendado = false, 
  cliente = null,
  firma = null,
  provincia = null,
  partido = null,
  tipo = 'lote',
  lat = null,
  lng = null
}) {
  const n = String(nombre || "").trim();
  if (!n) throw new Error("nombre_obligatorio");
  const ha = hectareas === null || hectareas === undefined || hectareas === "" ? null : Number(hectareas);
  const lLat = lat === null || lat === undefined || lat === "" ? null : Number(lat);
  const lLng = lng === null || lng === undefined || lng === "" ? null : Number(lng);
  const tipoSan = tipo ? String(tipo).trim() : 'lote';
  const codigo = await generarCodigo(query, "ubicaciones", PREFIJOS.lotes, usuarioId);

  let campo_id = null;
  const cCliente = cliente ? String(cliente).trim() : null;
  if (cCliente) {
    const rCampo = await query(`SELECT id FROM campos WHERE usuario_id = $1 AND LOWER(nombre) = LOWER($2) LIMIT 1`, [usuarioId, cCliente]);
    if (rCampo.rows.length > 0) campo_id = rCampo.rows[0].id;
  }

  const r = await query(
    `
      INSERT INTO ubicaciones (usuario_id, nombre, hectareas, cultivo, arrendado, cliente, firma, provincia, partido, tipo, lat, lng, codigo, campo_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id, nombre, hectareas, cultivo, arrendado, cliente, firma, provincia, partido, tipo, lat, lng, codigo, campo_id
    `,
    [
      usuarioId,
      n,
      Number.isFinite(ha) ? ha : null,
      cultivo ? String(cultivo).trim() : null,
      Boolean(arrendado),
      cCliente,
      firma ? String(firma).trim() : null,
      provincia ? String(provincia).trim() : null,
      partido ? String(partido).trim() : null,
      tipoSan,
      Number.isFinite(lLat) ? lLat : null,
      Number.isFinite(lLng) ? lLng : null,
      codigo,
      campo_id
    ]
  );
  return r.rows[0];
}

async function resolverLotePorNombre(usuarioId, fragmento = "") {
  const frag = String(fragmento || "").trim();
  if (!frag || !usuarioId) return null;
  const todos = await listarLotesUsuario(usuarioId);
  const normFrag = normalizarSlug(frag);
  const scored = todos
    .map((l) => {
      const ln = normalizarSlug(l.nombre || "");
      let score = 0;
      if (ln === normFrag) score = 100;
      else if (ln.includes(normFrag) || normFrag.includes(ln)) score = 60;
      else if (normFrag.split("_").every((tok) => tok && ln.includes(tok))) score = 40;
      return { l, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.l || null;
}

async function obtenerPendiente(usuarioId) {
  const r = await query(
    `
      SELECT *
      FROM inventario_movimiento
      WHERE usuario_id = $1
        AND estado = 'pendiente_confirmacion'
      ORDER BY creado_en DESC
      LIMIT 1
    `,
    [usuarioId]
  );
  return r.rows[0] || null;
}

async function expirarOtrosPendientes(usuarioId, exceptoId = null) {
  await query(
    `
      UPDATE inventario_movimiento
      SET estado = 'expirado',
          rechazado_en = COALESCE(rechazado_en, NOW())
      WHERE usuario_id = $1
        AND estado = 'pendiente_confirmacion'
        ${exceptoId ? "AND id <> $2" : ""}
    `,
    exceptoId ? [usuarioId, exceptoId] : [usuarioId]
  );
}

async function insertarMovimientoBase({
  usuarioId,
  campanaId = null,
  ubicacionId = null,
  dominio,
  clase = "stock",
  efecto = "replace",
  payload,
  fechaReferencia,
  textoNl,
  estado,
  canal,
  idempotencyKey = null,
}) {
  const r = await query(
    `
      INSERT INTO inventario_movimiento (
        usuario_id, campana_id, ubicacion_id, dominio, clase, efecto, payload,
        fecha_referencia, texto_nl, estado, canal, idempotency_key, confirmado_en
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `,
    [
      usuarioId,
      campanaId,
      ubicacionId,
      dominio,
      clase,
      efecto,
      JSON.stringify(payload || {}),
      fechaReferencia,
      textoNl || null,
      estado,
      canal || null,
      idempotencyKey,
      estado === "confirmado" ? new Date() : null,
    ]
  );
  return r.rows[0];
}

async function upsertSaldoDesdeMovimientoConfirmado(movRow) {
  const efecto = movRow.efecto === "delta" ? "delta" : "replace";
  const { usuario_id: usuarioId, campana_id: campanaId, ubicacion_id: ubicacionId, dominio, id, payload } = movRow;
  const pj = typeof payload === "object" && payload ? payload : JSON.parse(payload || "{}");
  let item_clave = null;
  let cantidad = null;
  let unidad = null;
  let etiqueta = null;

  if (dominio === "ganado") {
    const categoriaHum = String(pj.categoria || "").trim() || inferirEtiquetaGanado(pj);
    const especie = String(pj.especie || inferirEspecieDesdeEtiqueta(categoriaHum));
    item_clave = itemClaveGanado(especie, categoriaHum);
    unidad = "cab";
    etiqueta = categoriaHum;
    if (efecto === "delta") {
      const d = Number(pj.delta ?? pj.cambio ?? pj.variacion);
      if (!Number.isFinite(d)) throw new Error("delta_ganado_invalido");
      const base = await leerCantidadSaldoActual(usuarioId, dominio, item_clave, ubicacionId, campanaId);
      cantidad = Math.round(base + d);
      if (cantidad < 0) throw new Error("saldo_final_negativo");
    } else {
      cantidad = Number(pj.cantidad);
      if (!Number.isFinite(cantidad) || cantidad < 0) throw new Error("cantidad_ganado_invalida");
      cantidad = Math.round(cantidad);
    }
    
    if (Array.isArray(pj.animales_individuales) && pj.animales_individuales.length > 0) {
      const { calcularCarencia } = require("../../utils/carencia");
      for (const anim of pj.animales_individuales) {
        let carenciaHasta = null;
        let carenciaDetalle = null;
        const carenciaInfo = calcularCarencia(anim.observaciones || "");
        if (carenciaInfo) {
          const dias = carenciaInfo.dias;
          const fechaRef = new Date(pj.fecha_referencia || new Date());
          fechaRef.setDate(fechaRef.getDate() + dias);
          carenciaHasta = fechaRef;
          carenciaDetalle = carenciaInfo.motivo;
        }

        // Insertamos o actualizamos datos maestros del animal
        const resAnim = await query(
          `
            INSERT INTO animales_individuales (
              usuario_id, ubicacion_id, caravana, categoria, estado, observaciones, 
              peso, sexo, raza, carencia_hasta, carencia_detalle
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (usuario_id, caravana) WHERE caravana IS NOT NULL
            DO UPDATE SET
              ubicacion_id = EXCLUDED.ubicacion_id,
              categoria = EXCLUDED.categoria,
              estado = EXCLUDED.estado,
              peso = COALESCE(EXCLUDED.peso, animales_individuales.peso),
              observaciones = COALESCE(EXCLUDED.observaciones, animales_individuales.observaciones),
              carencia_hasta = EXCLUDED.carencia_hasta,
              carencia_detalle = EXCLUDED.carencia_detalle
            RETURNING id
          `,
          [
            usuarioId,
            ubicacionId,
            anim.caravana || null,
            anim.categoria || etiqueta,
            anim.estado || "sano",
            anim.observaciones || null,
            anim.peso != null ? Number(anim.peso) : null,
            anim.sexo || null,
            anim.raza || null,
            carenciaHasta,
            carenciaDetalle,
          ]
        );

        const animalId = resAnim.rows[0]?.id;

        // Si viene peso, registramos el evento de pesaje en el historial
        if (animalId && anim.peso != null) {
          await query(
            `
              INSERT INTO animales_eventos (usuario_id, animal_id, tipo_evento, fecha, valor_numerico)
              VALUES ($1, $2, 'pesaje', $3, $4)
            `,
            [usuarioId, animalId, pj.fecha_referencia || new Date(), Number(anim.peso)]
          );
        }

        // Si viene estado sanitario u observaciones de salud, registramos evento de sanidad
        if (animalId && (anim.estado != null || anim.observaciones != null)) {
          await query(
            `
              INSERT INTO animales_eventos (usuario_id, animal_id, tipo_evento, fecha, valor_texto, observaciones)
              VALUES ($1, $2, 'sanidad', $3, $4, $5)
            `,
            [
              usuarioId, 
              animalId, 
              pj.fecha_referencia || new Date(), 
              anim.estado || 'chequeo', 
              anim.observaciones || 'Registro sanitario individual'
            ]
          );
        }
      }
    }
  } else if (dominio === "cultivo") {
    const cultivo = String(pj.cultivo || "").trim();
    item_clave = itemClaveCultivo(cultivo);
    unidad = "ha";
    etiqueta = cultivo;
    if (!cultivo) throw new Error("cultivo_invalido");
    if (efecto === "delta") {
      const d = Number(pj.delta ?? pj.cambio ?? pj.hectareas_delta);
      if (!Number.isFinite(d)) throw new Error("delta_cultivo_invalido");
      const base = await leerCantidadSaldoActual(usuarioId, dominio, item_clave, ubicacionId, campanaId);
      cantidad = base + d;
      if (cantidad < 0) throw new Error("saldo_final_negativo");
    } else {
      const hectareas = Number(pj.hectareas);
      if (!Number.isFinite(hectareas) || hectareas <= 0) throw new Error("hectareas_cultivo_invalidas");
      cantidad = hectareas;
    }

    // Actualización de datos maestros del lote si vienen en el mensaje
    if (ubicacionId && (cultivo || pj.variedad || pj.fecha_siembra || pj.densidad || pj.rinde_esperado || pj.siembra_tipo || pj.densidad_por_metro || pj.distancia_surcos || pj.fertilizante || pj.fertilizante_dosis || pj.arrendado !== undefined)) {
      await query(
        `
          UPDATE ubicaciones 
          SET variedad = COALESCE($3, variedad),
              fecha_siembra = COALESCE($4, fecha_siembra),
              densidad = COALESCE($5, densidad),
              rinde_esperado = COALESCE($6, rinde_esperado),
              cultivo = COALESCE($7, cultivo),
              arrendado = COALESCE($8, arrendado),
              siembra_tipo = COALESCE($9, siembra_tipo),
              densidad_por_metro = COALESCE($10, densidad_por_metro),
              distancia_surcos = COALESCE($11, distancia_surcos),
              fertilizante = COALESCE($12, fertilizante),
              fertilizante_dosis = COALESCE($13, fertilizante_dosis)
          WHERE id = $1 AND usuario_id = $2
        `,
        [
          ubicacionId,
          usuarioId,
          pj.variedad || null,
          pj.fecha_siembra || null,
          pj.densidad != null ? Number(pj.densidad) : null,
          pj.rinde_esperado != null ? Number(pj.rinde_esperado) : null,
          cultivo,
          pj.arrendado !== undefined ? Boolean(pj.arrendado) : null,
          pj.siembra_tipo || null,
          pj.densidad_por_metro != null ? Number(pj.densidad_por_metro) : null,
          pj.distancia_surcos != null ? Number(pj.distancia_surcos) : null,
          pj.fertilizante || null,
          pj.fertilizante_dosis != null ? Number(pj.fertilizante_dosis) : null
        ]
      );
    }

    // Registro de monitoreo si viene data específica
    if (ubicacionId && pj.monitoreo) {
      const m = pj.monitoreo;
      await query(
        `
          INSERT INTO monitoreo_agricola (
            usuario_id, ubicacion_id, campana_id, fecha, 
            estado_fenologico, humedad_suelo, incidencia_sanitaria, observaciones
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          usuarioId,
          ubicacionId,
          campanaId,
          pj.fecha_referencia || new Date(),
          m.estado_fenologico || null,
          m.humedad_suelo || null,
          m.incidencia_sanitaria || null,
          m.observaciones || null
        ]
      );
    }
  } else if (dominio === "insumo") {
    const producto = String(pj.producto || "").trim().slice(0, 120);
    if (!producto) throw new Error("producto_insumo_obligatorio");
    unidad = normalizarUnidadInsumo(pj.unidad);
    item_clave = itemClaveInsumo(producto, unidad);
    etiqueta = `${producto} (${unidad})`;
    if (efecto === "delta") {
      const d = Number(pj.delta ?? pj.cambio);
      if (!Number.isFinite(d)) throw new Error("delta_insumo_invalido");
      const base = await leerCantidadSaldoActual(usuarioId, dominio, item_clave, ubicacionId, campanaId);
      cantidad = base + d;
      if (cantidad < 0) throw new Error("saldo_final_negativo");
    } else {
      cantidad = Number(pj.cantidad);
      if (!Number.isFinite(cantidad) || cantidad < 0) throw new Error("cantidad_insumo_invalida");
    }
  } else if (dominio === "grano") {
    const cultivo = String(pj.cultivo || "").trim();
    if (!cultivo) throw new Error("grano_cultivo_obligatorio");
    item_clave = itemClaveGrano(cultivo);
    unidad = "tn";
    etiqueta = `${cultivo}`;
    if (efecto === "delta") {
      const d = Number(pj.delta ?? pj.cambio ?? pj.delta_toneladas);
      if (!Number.isFinite(d)) throw new Error("delta_grano_invalido");
      const base = await leerCantidadSaldoActual(usuarioId, dominio, item_clave, ubicacionId, campanaId);
      cantidad = base + d;
      if (cantidad < 0) throw new Error("saldo_final_negativo");
    } else {
      const tn = Number(pj.toneladas ?? pj.tn);
      if (!Number.isFinite(tn) || tn < 0) throw new Error("toneladas_grano_invalidas");
      cantidad = tn;
    }
  } else throw new Error("dominio_invalido");

  const upd = await query(
    `
      UPDATE inventario_saldo
      SET cantidad = $1,
          unidad = $2,
          etiqueta = $3,
          ultimo_movimiento_id = $4,
          actualizado_en = NOW()
      WHERE usuario_id = $5
        AND dominio = $6
        AND item_clave = $7
        AND (ubicacion_id IS NOT DISTINCT FROM $8)
        AND (campana_id IS NOT DISTINCT FROM $9)
    `,
    [cantidad, unidad, etiqueta, id, usuarioId, dominio, item_clave, ubicacionId, campanaId]
  );
  if (upd.rowCount > 0) return;

  await query(
    `
      INSERT INTO inventario_saldo (
        usuario_id, campana_id, ubicacion_id, dominio, item_clave,
        cantidad, unidad, etiqueta, ultimo_movimiento_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [usuarioId, campanaId, ubicacionId, dominio, item_clave, cantidad, unidad, etiqueta, id]
  );
}

function inferirEtiquetaGanado(pj) {
  const c = pj.categoria_corta || pj.etiqueta;
  return String(c || "cabezas");
}

async function crearRegistroPendiente({
  usuarioId,
  dominio,
  payload,
  ubicacionId = null,
  campanaId = null,
  efecto = "replace",
  textoNl = "",
  fechaReferencia,
  canal = "whatsapp",
}) {
  await asegurarLoteUsuario(usuarioId, ubicacionId);
  await asegurarCampanaUsuario(usuarioId, campanaId);
  await expirarOtrosPendientes(usuarioId);
  const f = fechaReferencia || fechaISOArgentina();
  const efectoSan = efecto === "delta" ? "delta" : "replace";
  const mov = await insertarMovimientoBase({
    usuarioId,
    campanaId,
    ubicacionId,
    dominio,
    clase: claseDominioMovimiento(dominio),
    efecto: efectoSan,
    payload,
    fechaReferencia: f,
    textoNl,
    estado: "pendiente_confirmacion",
    canal,
  });
  return mov;
}

async function confirmarMovimientoPorId(id, usuarioId) {
  const r = await query(
    `
      UPDATE inventario_movimiento
      SET estado = 'confirmado',
          confirmado_en = NOW()
      WHERE id = $1 AND usuario_id = $2 AND estado = 'pendiente_confirmacion'
      RETURNING *
    `,
    [id, usuarioId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const p = typeof row.payload === "object" && row.payload ? row.payload : JSON.parse(row.payload || "{}");
  if (Array.isArray(p.items_compuestos) && p.items_compuestos.length) {
    for (let i = 0; i < p.items_compuestos.length; i += 1) {
      const it = p.items_compuestos[i] || {};
      const dom = String(it.dominio || "").trim();
      if (!["ganado", "cultivo", "insumo", "grano"].includes(dom)) continue;
      const ef = it.efecto === "delta" ? "delta" : "replace";
      const pay = it.payload && typeof it.payload === "object" ? it.payload : null;
      if (!pay) continue;
      const child = await insertarMovimientoBase({
        usuarioId: row.usuario_id,
        campanaId: row.campana_id,
        ubicacionId: row.ubicacion_id,
        dominio: dom,
        clase: claseDominioMovimiento(dom),
        efecto: ef,
        payload: pay,
        fechaReferencia: row.fecha_referencia,
        textoNl: `${row.texto_nl || "registro compuesto"} [item ${i + 1}/${p.items_compuestos.length}]`,
        estado: "confirmado",
        canal: row.canal || "whatsapp",
      });
      await upsertSaldoDesdeMovimientoConfirmado(child);
    }
    return row;
  }
  if (row.dominio === "ganado" && row.efecto === "replace" && Array.isArray(p.items) && p.items.length) {
    for (let i = 0; i < p.items.length; i += 1) {
      const it = p.items[i] || {};
      const categoria = String(it.categoria || "").trim();
      const especie = String(it.especie || inferirEspecieDesdeEtiqueta(categoria));
      const cantidad = Number(it.cantidad);
      if (!categoria || !Number.isFinite(cantidad) || cantidad < 0) continue;
      const child = await insertarMovimientoBase({
        usuarioId: row.usuario_id,
        campanaId: row.campana_id,
        ubicacionId: row.ubicacion_id,
        dominio: "ganado",
        clase: "stock",
        efecto: "replace",
        payload: { especie, categoria, cantidad: Math.round(cantidad) },
        fechaReferencia: row.fecha_referencia,
        textoNl: `${row.texto_nl || "lote ganado"} [item ${i + 1}/${p.items.length}]`,
        estado: "confirmado",
        canal: row.canal || "whatsapp",
      });
      await upsertSaldoDesdeMovimientoConfirmado(child);
    }
    return row;
  }
  await upsertSaldoDesdeMovimientoConfirmado(row);
  return row;
}

async function rechazarMovimientoPorId(id, usuarioId) {
  const r = await query(
    `
      UPDATE inventario_movimiento
      SET estado = 'rechazado',
          rechazado_en = NOW()
      WHERE id = $1 AND usuario_id = $2 AND estado = 'pendiente_confirmacion'
      RETURNING *
    `,
    [id, usuarioId]
  );
  return r.rows[0] || null;
}

async function registroConfirmadoDirecto({
  usuarioId,
  dominio,
  payload,
  ubicacionId = null,
  campanaId = null,
  efecto = "replace",
  textoNl = null,
  fechaReferencia,
  canal = "web",
  idempotencyKey = null,
}) {
  await asegurarLoteUsuario(usuarioId, ubicacionId);
  await asegurarCampanaUsuario(usuarioId, campanaId);
  await expirarOtrosPendientes(usuarioId);
  const f = fechaReferencia || fechaISOArgentina();
  const efectoSan = efecto === "delta" ? "delta" : "replace";
  const mov = await insertarMovimientoBase({
    usuarioId,
    campanaId,
    ubicacionId,
    dominio,
    clase: claseDominioMovimiento(dominio),
    efecto: efectoSan,
    payload,
    fechaReferencia: f,
    textoNl,
    estado: "confirmado",
    canal,
    idempotencyKey,
  });
  await upsertSaldoDesdeMovimientoConfirmado(mov);
  return mov;
}

async function listarSaldos({ usuarioId, ubicacionId = undefined, campanaId = undefined, dominio = undefined }) {
  const cond = ["s.usuario_id = $1"];
  const vals = [usuarioId];
  if (dominio) {
    vals.push(dominio);
    cond.push(`s.dominio = $${vals.length}`);
  }
  if (ubicacionId !== undefined && ubicacionId !== null && ubicacionId !== "") {
    vals.push(Number(ubicacionId));
    cond.push(`s.ubicacion_id = $${vals.length}`);
  }
  if (campanaId !== undefined && campanaId !== null && campanaId !== "") {
    vals.push(Number(campanaId));
    cond.push(`s.campana_id = $${vals.length}`);
  }
  const r = await query(
    `
      SELECT s.id, s.ubicacion_id, s.campana_id, s.dominio, s.item_clave, s.cantidad, s.unidad,
             s.etiqueta, s.actualizado_en,
             l.nombre AS lote_nombre,
             c.nombre AS campana_nombre
      FROM inventario_saldo s
      LEFT JOIN ubicaciones l ON l.id = s.ubicacion_id AND l.usuario_id = s.usuario_id
      LEFT JOIN campanas_agricolas c ON c.id = s.campana_id AND c.usuario_id = s.usuario_id
      WHERE ${cond.join(" AND ")}
      ORDER BY s.dominio ASC, s.etiqueta ASC
    `,
    vals
  );
  return r.rows || [];
}

async function listarMovimientos({ usuarioId, limit = 40 }) {
  const lim = Math.min(500, Math.max(1, Number(limit) || 40));
  const r = await query(
    `
      SELECT m.id, m.dominio, m.ubicacion_id, m.campana_id, m.estado, m.efecto, m.payload, m.fecha_referencia,
             m.texto_nl, m.canal, m.creado_en, m.confirmado_en,
             l.nombre AS lote_nombre,
             ca.nombre AS campana_nombre
      FROM inventario_movimiento m
      LEFT JOIN ubicaciones l ON l.id = m.ubicacion_id AND l.usuario_id = m.usuario_id
      LEFT JOIN campanas_agricolas ca ON ca.id = m.campana_id AND ca.usuario_id = m.usuario_id
      WHERE m.usuario_id = $1 AND m.estado <> 'pendiente_confirmacion'
      ORDER BY m.creado_en DESC
      LIMIT ${lim}
    `,
    [usuarioId]
  );
  return r.rows || [];
}

async function consultarHistorialSanidad({ usuarioId, caravana = null, ubicacionId = null, limit = 20 }) {
  const cond = ["e.usuario_id = $1"];
  const vals = [usuarioId];
  if (caravana) {
    vals.push(String(caravana).trim());
    cond.push(`a.caravana = $${vals.length}`);
  }
  if (ubicacionId) {
    vals.push(Number(ubicacionId));
    cond.push(`a.ubicacion_id = $${vals.length}`);
  }

  const r = await query(
    `
      SELECT e.tipo_evento, e.fecha, e.valor_numerico, e.valor_texto, e.observaciones, 
             a.caravana, a.categoria, l.nombre AS lote_nombre
      FROM animales_eventos e
      JOIN animales_individuales a ON a.id = e.animal_id
      LEFT JOIN ubicaciones l ON l.id = a.ubicacion_id
      WHERE ${cond.join(" AND ")}
      ORDER BY e.fecha DESC, e.creado_en DESC
      LIMIT $${vals.length + 1}
    `,
    [...vals, limit]
  );
  return r.rows || [];
}

function resumenMovimientoParaHumano(row, loteNombre = "", campanaNombre = "") {
  const esDelta = row.efecto === "delta";
  const p = typeof row.payload === "object" && row.payload ? row.payload : JSON.parse(row.payload || "{}");
  let det = "";
  if (row.dominio === "ganado") {
    if (Array.isArray(p.items_compuestos) && p.items_compuestos.length) {
      det = p.items_compuestos
        .slice(0, 6)
        .map((it) => {
          const d = String(it.dominio || "");
          const q = it.payload || {};
          if (d === "cultivo") return `${q.cultivo || "cultivo"}: ${numeroFormateado(q.hectareas ?? q.delta)} ha`;
          if (d === "insumo") return `${q.producto || "insumo"}: ${numeroFormateado(q.cantidad ?? q.delta)} ${normalizarUnidadInsumo(q.unidad)}`;
          if (d === "grano") return `${q.cultivo || "grano"}: ${numeroFormateado(q.toneladas ?? q.delta)} tn`;
          return `${q.categoria || "ganado"}: ${numeroFormateado(q.cantidad ?? q.delta)} cab`;
        })
        .join(" + ");
      if (p.items_compuestos.length > 6) det += ` + ${p.items_compuestos.length - 6} ítems`;
    } else
    if (!esDelta && Array.isArray(p.items) && p.items.length) {
      det = p.items
        .slice(0, 8)
        .map((it) => `${numeroFormateado(it.cantidad)} ${String(it.categoria || "ganado")}`)
        .join(" + ");
      if (p.items.length > 8) det += ` + ${p.items.length - 8} ítems`;
    } else {
    const cat = String(p.categoria || p.etiqueta || "ganado");
    if (esDelta) {
      const d = Number(p.delta ?? p.cambio ?? p.variacion);
      det = `${cat}: Δ ${Number.isFinite(d) && d > 0 ? "+" : ""}${numeroFormateado(d)} cab`;
    } else det = `${cat}: ${numeroFormateado(p.cantidad)} cab`;
    }
  } else if (row.dominio === "cultivo") {
    const cr = String(p.cultivo || "cultivo");
    if (esDelta) {
      const d = Number(p.delta ?? p.cambio ?? p.hectareas_delta);
      det = `${cr}: Δ ${Number.isFinite(d) && d > 0 ? "+" : ""}${numeroFormateado(d)} ha`;
    } else det = `${cr}: ${numeroFormateado(p.hectareas)} ha`;
  } else if (row.dominio === "insumo") {
    const pr = String(p.producto || "insumo");
    const un = normalizarUnidadInsumo(p.unidad);
    if (esDelta) {
      const d = Number(p.delta ?? p.cambio);
      det = `${pr}: Δ ${Number.isFinite(d) && d > 0 ? "+" : ""}${numeroFormateado(d)} ${un}`;
    } else det = `${pr}: ${numeroFormateado(p.cantidad)} ${un}`;
  } else if (row.dominio === "grano") {
    const cr = String(p.cultivo || "grano");
    if (esDelta) {
      const d = Number(p.delta ?? p.cambio ?? p.delta_toneladas);
      det = `${cr} (stock): Δ ${Number.isFinite(d) && d > 0 ? "+" : ""}${numeroFormateado(d)} tn`;
    } else det = `${cr} (stock): ${numeroFormateado(p.toneladas ?? p.tn)} tn`;
  } else det = "?";
  const lf = row.ubicacion_id ? `\n📍 ${loteNombre || `lote #${row.ubicacion_id}`}` : `\n📍 establecimiento (sin lote)`;
  const cf = row.campana_id ? `\n🌾 ${campanaNombre || `campaña #${row.campana_id}`}` : "";
  
  let carenciaAlert = "";
  if (row.dominio === "ganado" && Array.isArray(p.animales_individuales)) {
    const { calcularCarencia } = require("../../utils/carencia");
    const alertas = [];
    for (const anim of p.animales_individuales) {
      const carenciaInfo = calcularCarencia(anim.observaciones || "");
      if (carenciaInfo && carenciaInfo.dias > 0) {
        const fechaRef = new Date(row.fecha_referencia || new Date());
        fechaRef.setDate(fechaRef.getDate() + carenciaInfo.dias);
        const fechaFormateada = `${String(fechaRef.getDate()).padStart(2, '0')}/${String(fechaRef.getMonth() + 1).padStart(2, '0')}/${fechaRef.getFullYear()}`;
        alertas.push(`• *Caravana ${anim.caravana || 's/d'}*: ⚠️ *Retiro/Carencia hasta ${fechaFormateada}* (${carenciaInfo.motivo})`);
      }
    }
    if (alertas.length) {
      carenciaAlert = `\n\n🛡️ *Período de Carencia (SENASA):*\n${alertas.join("\n")}`;
    }
  }

  return `${det}${lf}${cf}\n📅 ${String(row.fecha_referencia || "")}${carenciaAlert}`;
}

function numeroFormateado(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x ?? "");
  return n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

module.exports = {
  asegurarLoteUsuario,
  asegurarCampanaUsuario,
  listarCampanasUsuario,
  crearCampanaUsuario,
  editarCampanaUsuario,
  resolverCampanaPorNombre,
  listarLotesUsuario,
  crearLoteUsuario,
  resolverLotePorNombre,
  obtenerPendiente,
  crearRegistroPendiente,
  confirmarMovimientoPorId,
  rechazarMovimientoPorId,
  registroConfirmadoDirecto,
  listarSaldos,
  listarMovimientos,
  consultarHistorialSanidad,
  resumenMovimientoParaHumano,
  inferirEspecieDesdeEtiqueta,
  fechaISOArgentinaDesdeServicio: fechaISOArgentina,
  itemClaveGanado,
  itemClaveCultivo,
  itemClaveInsumo,
  itemClaveGrano,
  normalizarUnidadInsumo,
};
