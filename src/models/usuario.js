const { pool, query } = require("../config/database");

const extraerIdentidadWhatsapp = (numeroWhatsapp = "") => {
  const limpio = String(numeroWhatsapp || "").trim();
  if (!limpio) {
    return { jid: null, numero: "", numeroReal: null, esLid: false };
  }
  const jid = limpio.includes("@") ? limpio : null;
  const userPart = jid ? jid.split("@")[0] : limpio;
  const numero = String(userPart || "").replace(/\D/g, "");
  const esLid = Boolean(jid && jid.endsWith("@lid"));
  const numeroReal = !esLid && numero ? numero : null;
  return { jid, numero, numeroReal, esLid };
};

const normalizarWhatsapp = (numeroWhatsapp = "") => {
  return extraerIdentidadWhatsapp(numeroWhatsapp).numero;
};

/**
 * Destino para envío saliente (whatsapp-web.js): prioriza teléfono real (`getNumberId`);
 * si no hay, usa `whatsapp_jid` (@lid / @c.us) para cuentas que solo tienen LID en `whatsapp`.
 */
const destinoWhatsappParaEnvio = (usuario = {}) => {
  const realRaw = String(usuario.whatsapp_real || "").trim();
  if (realRaw) {
    const soloDigitos = realRaw.replace(/\D/g, "");
    if (soloDigitos.length >= 8) return soloDigitos;
  }
  const jid = String(usuario.whatsapp_jid || "").trim();
  if (jid.includes("@")) return jid;
  return String(usuario.whatsapp || "").trim();
};

const obtenerVariantesTelefono = (value = "") => {
  const base = String(value || "").replace(/\D/g, "");
  if (!base) return [];
  const out = new Set([base]);
  if (base.startsWith("549") && base.length > 3) out.add(`54${base.slice(3)}`);
  if (base.startsWith("54") && !base.startsWith("549") && base.length > 2) out.add(`549${base.slice(2)}`);
  return Array.from(out).filter(Boolean);
};

const buscarPorWhatsapp = async (numeroWhatsapp, numeroRealOptional) => {
  const identidad = extraerIdentidadWhatsapp(numeroWhatsapp);
  if (!identidad.numero && !identidad.jid) return null;

  const numeroBuscado = identidad.numero || "";
  const variantes = obtenerVariantesTelefono(numeroBuscado);

  const realNumCanon = numeroRealOptional ? normalizarWhatsapp(numeroRealOptional) : null;
  const variantesReal = realNumCanon ? obtenerVariantesTelefono(realNumCanon) : [];

  // 1. Primero verificamos si es un Teléfono Autorizado (Delegado) ACTIVO
  const delegadoResult = await query(
    `
      SELECT t.usuario_principal_id, t.nombre_contacto, t.rol, t.aceptado, t.whatsapp_autorizado,
             u.nombre AS nombre_principal, u.email, u.whatsapp AS whatsapp_principal,
             u.whatsapp_jid, u.whatsapp_real,
             u.provincia, u.partido, u.lat, u.lng, u.plan, u.activo, u.tipo_comercializacion
      FROM telefonos_autorizados t
      JOIN usuarios u ON t.usuario_principal_id = u.id
      WHERE (
        regexp_replace(COALESCE(t.whatsapp_autorizado, ''), '\\D', '', 'g') = ANY($1::text[])
        OR (
          $2::text[] <> '{}'::text[] AND
          regexp_replace(COALESCE(t.whatsapp_autorizado, ''), '\\D', '', 'g') = ANY($2::text[])
        )
      )
        AND t.activo = true
        AND u.activo = true
      LIMIT 1
    `,
    [variantes, variantesReal]
  );

  if (delegadoResult.rows[0]) {
    const row = delegadoResult.rows[0];
    return {
      id: row.usuario_principal_id,
      nombre: row.nombre_principal,
      email: row.email,
      whatsapp: row.whatsapp_principal,
      whatsapp_jid: row.whatsapp_jid,
      whatsapp_real: row.whatsapp_real,
      provincia: row.provincia,
      partido: row.partido,
      lat: row.lat,
      lng: row.lng,
      plan: row.plan,
      activo: row.activo,
      tipo_comercializacion: row.tipo_comercializacion,
      es_delegado: true,
      nombre_operario: row.nombre_contacto,
      rol_operario: row.rol,
      delegado_pendiente: !row.aceptado,
      whatsapp_autorizado: row.whatsapp_autorizado,
    };
  }

  // 2. Si no es un delegado activo, buscamos si el número pertenece a un Usuario Principal
  const result = await query(
    `
      SELECT id, nombre, email, whatsapp, whatsapp_jid, whatsapp_real, provincia, partido, lat, lng, plan, activo, tipo_comercializacion
      FROM usuarios
      WHERE (
        $1::text[] <> '{}'::text[] AND (
          regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = ANY($1::text[])
          OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = ANY($1::text[])
          OR regexp_replace(COALESCE(whatsapp_jid, ''), '\\D', '', 'g') = ANY($1::text[])
        )
      )
      OR ($2::text IS NOT NULL AND whatsapp_jid = $2::text)
      OR (
        $3::text[] <> '{}'::text[] AND (
          regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = ANY($3::text[])
          OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = ANY($3::text[])
          OR regexp_replace(COALESCE(whatsapp_jid, ''), '\\D', '', 'g') = ANY($3::text[])
        )
      )
      LIMIT 1
    `,
    [variantes, identidad.jid, variantesReal]
  );

  if (result.rows[0]) {
    return {
      ...result.rows[0],
      es_delegado: false,
      nombre_operario: result.rows[0].nombre,
      rol_operario: "dueño",
    };
  }

  return null;
};

const crearUsuario = async (datos) => {
  const identidad = extraerIdentidadWhatsapp(datos.whatsapp);
  const whatsappCanon = identidad.numeroReal || identidad.numero;
  const result = await query(
    `
      INSERT INTO usuarios (nombre, whatsapp, whatsapp_jid, whatsapp_real, provincia, partido, lat, lng, tipo_comercializacion)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, nombre, email, whatsapp, whatsapp_jid, whatsapp_real, provincia, partido, lat, lng, plan, activo, tipo_comercializacion
    `,
    [
      datos.nombre,
      whatsappCanon,
      identidad.jid,
      identidad.numeroReal,
      datos.provincia || null,
      datos.partido || null,
      datos.lat ?? null,
      datos.lng ?? null,
      datos.tipo_comercializacion || "disponible",
    ]
  );
  return result.rows[0];
};

const actualizarUsuario = async (id, datos) => {
  const campos = [];
  const valores = [];

  const pushCampo = (campo, valor) => {
    if (valueIsSet(valor)) {
      campos.push(`${campo} = $${valores.length + 1}`);
      valores.push(valor);
    }
  };

  const valueIsSet = (v) => v !== undefined;

  pushCampo("nombre", datos.nombre);
  pushCampo("email", datos.email);
  pushCampo("provincia", datos.provincia);
  pushCampo("partido", datos.partido);
  pushCampo("lat", datos.lat);
  pushCampo("lng", datos.lng);
  pushCampo("tipo_comercializacion", datos.tipo_comercializacion);
  if (valueIsSet(datos.whatsapp)) {
    const identidad = extraerIdentidadWhatsapp(datos.whatsapp);
    pushCampo("whatsapp", identidad.numeroReal || identidad.numero);
    if (identidad.jid) pushCampo("whatsapp_jid", identidad.jid);
    if (identidad.numeroReal) pushCampo("whatsapp_real", identidad.numeroReal);
  }
  pushCampo("whatsapp_jid", datos.whatsapp_jid);
  pushCampo("whatsapp_real", datos.whatsapp_real);

  if (!campos.length) {
    const current = await query(
      `
        SELECT id, nombre, email, whatsapp, whatsapp_jid, whatsapp_real, provincia, partido, lat, lng, plan, activo, tipo_comercializacion
        FROM usuarios
        WHERE id = $1
      `,
      [id]
    );
    return current.rows[0] || null;
  }

  valores.push(id);
  const result = await query(
    `
      UPDATE usuarios
      SET ${campos.join(", ")}
      WHERE id = $${valores.length}
      RETURNING id, nombre, email, whatsapp, whatsapp_jid, whatsapp_real, provincia, partido, lat, lng, plan, activo, tipo_comercializacion
    `,
    valores
  );
  return result.rows[0] || null;
};

const guardarCultivosUsuario = async ({
  usuarioId,
  cultivos,
  hectareas,
  costoPorHa,
}) => {
  await query("DELETE FROM usuario_cultivos WHERE usuario_id = $1", [usuarioId]);
  for (const cultivo of cultivos) {
    await query(
      `
        INSERT INTO usuario_cultivos (usuario_id, cultivo, hectareas, costo_por_ha, activo)
        VALUES ($1, $2, $3, $4, true)
      `,
      [usuarioId, cultivo, hectareas ?? null, costoPorHa ?? null]
    );
  }
};

const obtenerPerfil = async (numeroWhatsapp, numeroRealOptional) => {
  const usuario = await buscarPorWhatsapp(numeroWhatsapp, numeroRealOptional);
  if (!usuario) return null;

  const cultivosResult = await query(
    `
      SELECT cultivo, hectareas, costo_por_ha
      FROM usuario_cultivos
      WHERE usuario_id = $1 AND activo = true
      ORDER BY cultivo
    `,
    [usuario.id]
  );

  return {
    ...usuario,
    cultivos: cultivosResult.rows,
  };
};

const syncEstadoBotPorWhatsapp = async ({ whatsapp, botActivo }) => {
  const whatsappNorm = normalizarWhatsapp(whatsapp);
  if (!whatsappNorm) return;
  await query(
    `
      INSERT INTO whatsapp_bot_control (whatsapp, bot_activo)
      VALUES ($1, $2)
      ON CONFLICT (whatsapp)
      DO UPDATE SET
        bot_activo = EXCLUDED.bot_activo,
        actualizado_en = NOW()
    `,
    [whatsappNorm, Boolean(botActivo)]
  );
};

const registrarIdentidadWhatsapp = async ({ jid, whatsappReal }) => {
  const identidadJid = extraerIdentidadWhatsapp(jid);
  const real = normalizarWhatsapp(whatsappReal);
  const jidNorm = identidadJid.jid;
  const numeroJid = identidadJid.numero;
  if (!jidNorm && !numeroJid && !real) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const linkedByJid = jidNorm
      ? await client.query(
          `
            SELECT id
            FROM usuarios
            WHERE whatsapp_jid = $1
            ORDER BY id DESC
            LIMIT 1
          `,
          [jidNorm]
        )
      : { rows: [] };

    const linkedByJidNumber = numeroJid
      ? await client.query(
          `
            SELECT id
            FROM usuarios
            WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
               OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = $1
            ORDER BY id DESC
            LIMIT 1
          `,
          [numeroJid]
        )
      : { rows: [] };

    const linkedByReal = real
      ? await client.query(
          `
            SELECT id
            FROM usuarios
            WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
               OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = $1
            ORDER BY id DESC
            LIMIT 1
          `,
          [real]
        )
      : { rows: [] };

    const idByJid = linkedByJid.rows[0]?.id || null;
    const idByJidNumber = linkedByJidNumber.rows[0]?.id || null;
    const idByReal = linkedByReal.rows[0]?.id || null;

    const targetId = idByReal || idByJid || idByJidNumber || null;
    const sourceCandidates = [idByJid, idByJidNumber].filter((id) => id && id !== targetId);

    if (targetId && sourceCandidates.length) {
      const sourceId = sourceCandidates[0];
      await client.query(
        `
          INSERT INTO resumenes (usuario_id, fecha, tipo, contenido, enviado_wp, enviado_en, tokens_usados, creado_en)
          SELECT $1, fecha, tipo, contenido, enviado_wp, enviado_en, tokens_usados, creado_en
          FROM resumenes
          WHERE usuario_id = $2
          ON CONFLICT (usuario_id, fecha, tipo) DO NOTHING
        `,
        [targetId, sourceId]
      );
      await client.query(`DELETE FROM resumenes WHERE usuario_id = $1`, [sourceId]);

      const tablasConUsuarioId = [
        "usuario_cultivos",
        "envios_whatsapp",
        "historial_consultas",
        "alertas",
        "perfil_productivo",
        "campanas_agricolas",
        "lotes",
        "stock_ganadero",
        "gastos",
        "ventas",
      ];
      for (const tabla of tablasConUsuarioId) {
        await client.query(`UPDATE ${tabla} SET usuario_id = $1 WHERE usuario_id = $2`, [
          targetId,
          sourceId,
        ]);
      }
      await client.query(`DELETE FROM usuarios WHERE id = $1`, [sourceId]);
    }

    if (targetId) {
      await client.query(
        `
          UPDATE usuarios
          SET
            whatsapp_jid = COALESCE($2::text, whatsapp_jid),
            whatsapp_real = COALESCE($3::text, whatsapp_real),
            whatsapp = CASE
              WHEN $3::text IS NOT NULL AND $3::text <> '' THEN $3::text
              ELSE whatsapp
            END
          WHERE id = $1
        `,
        [targetId, jidNorm, real || null]
      );
    } else {
      await client.query(
        `
          UPDATE usuarios
          SET
            whatsapp_jid = COALESCE($1::text, whatsapp_jid),
            whatsapp_real = COALESCE($2::text, whatsapp_real),
            whatsapp = CASE
              WHEN $2::text IS NOT NULL AND $2::text <> '' THEN $2::text
              ELSE whatsapp
            END
          WHERE
            ($1::text IS NOT NULL AND whatsapp_jid = $1::text)
            OR ($3::text <> '' AND regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $3::text)
            OR ($3::text <> '' AND regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = $3::text)
        `,
        [jidNorm, real || null, numeroJid || ""]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const setActivoUsuario = async (usuarioId, activo) => {
  const result = await query(
    `
      UPDATE usuarios
      SET activo = $2
      WHERE id = $1
      RETURNING id, nombre, whatsapp, plan, activo
    `,
    [usuarioId, Boolean(activo)]
  );
  const usuario = result.rows[0] || null;
  if (usuario?.whatsapp) {
    await syncEstadoBotPorWhatsapp({
      whatsapp: usuario.whatsapp,
      botActivo: Boolean(activo),
    });
  }
  return usuario;
};

const tryQueryOpcional = async (client, text, params) => {
  try {
    await client.query(text, params);
  } catch (err) {
    if (err && err.code === "42P01") return;
    throw err;
  }
};

const eliminarUsuarioSoft = async (usuarioId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const previo = await client.query(
      `
        SELECT id, nombre, whatsapp, whatsapp_real, whatsapp_jid, plan, activo
        FROM usuarios
        WHERE id = $1
        LIMIT 1
      `,
      [usuarioId]
    );
    const usuario = previo.rows[0] || null;
    if (!usuario) {
      await client.query("ROLLBACK");
      return null;
    }

    const whatsappNorm = normalizarWhatsapp(usuario.whatsapp);
    const whatsappRealNorm = normalizarWhatsapp(usuario.whatsapp_real);
    const whatsappJidNorm = normalizarWhatsapp(usuario.whatsapp_jid);

    if (whatsappNorm) {
      await tryQueryOpcional(
        client,
        `DELETE FROM whatsapp_interaccion_log WHERE whatsapp_norm = $1 OR usuario_id = $2`,
        [whatsappNorm, usuarioId]
      );
      await tryQueryOpcional(
        client,
        `
          DELETE FROM consulta_route_events
          WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
        `,
        [whatsappNorm]
      );
      await tryQueryOpcional(
        client,
        `
          DELETE FROM alertas_horticolas
          WHERE regexp_replace(COALESCE(usuario_ref, ''), '\\D', '', 'g') = $1
             OR BTRIM(usuario_ref) = BTRIM($2::text)
             OR BTRIM(usuario_ref) = BTRIM($3::text)
        `,
        [whatsappNorm, String(usuario.whatsapp || ""), String(usuario.whatsapp_jid || "")]
      );
    }

    // Estas dos tablas no tienen ON DELETE CASCADE en todos los entornos.
    await client.query("DELETE FROM envios_whatsapp WHERE usuario_id = $1", [usuarioId]);
    await client.query("DELETE FROM historial_consultas WHERE usuario_id = $1", [usuarioId]);

    await client.query("DELETE FROM usuarios WHERE id = $1", [usuarioId]);

    if (whatsappNorm) {
      await client.query(
        `DELETE FROM onboarding_estado WHERE regexp_replace(COALESCE(whatsapp,''), '\\D', '', 'g') = $1`,
        [whatsappNorm]
      );
      await client.query(
        `DELETE FROM whatsapp_bot_control WHERE regexp_replace(COALESCE(whatsapp,''), '\\D', '', 'g') = $1`,
        [whatsappNorm]
      );
    }
    if (whatsappRealNorm && whatsappRealNorm !== whatsappNorm) {
      await client.query(
        `DELETE FROM onboarding_estado WHERE regexp_replace(COALESCE(whatsapp,''), '\\D', '', 'g') = $1`,
        [whatsappRealNorm]
      );
      await client.query(
        `DELETE FROM whatsapp_bot_control WHERE regexp_replace(COALESCE(whatsapp,''), '\\D', '', 'g') = $1`,
        [whatsappRealNorm]
      );
    }
    if (whatsappJidNorm && whatsappJidNorm !== whatsappNorm && whatsappJidNorm !== whatsappRealNorm) {
      await client.query(
        `DELETE FROM onboarding_estado WHERE regexp_replace(COALESCE(whatsapp,''), '\\D', '', 'g') = $1`,
        [whatsappJidNorm]
      );
      await client.query(
        `DELETE FROM whatsapp_bot_control WHERE regexp_replace(COALESCE(whatsapp,''), '\\D', '', 'g') = $1`,
        [whatsappJidNorm]
      );
    }

    await client.query("COMMIT");
    return { ...usuario, activo: false, eliminado: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  normalizarWhatsapp,
  destinoWhatsappParaEnvio,
  buscarPorWhatsapp,
  crearUsuario,
  actualizarUsuario,
  guardarCultivosUsuario,
  obtenerPerfil,
  setActivoUsuario,
  eliminarUsuarioSoft,
  registrarIdentidadWhatsapp,
  extraerIdentidadWhatsapp,
};
