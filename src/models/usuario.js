const { query } = require("../config/database");

const normalizarWhatsapp = (numeroWhatsapp = "") => {
  const limpio = String(numeroWhatsapp).trim();
  if (!limpio) return "";
  if (limpio.includes("@")) {
    return limpio.split("@")[0].replace(/\D/g, "");
  }
  return limpio.replace(/\D/g, "");
};

const buscarPorWhatsapp = async (numeroWhatsapp) => {
  const whatsapp = normalizarWhatsapp(numeroWhatsapp);
  if (!whatsapp) return null;

  const result = await query(
    `
      SELECT id, nombre, whatsapp, provincia, partido, lat, lng, plan, activo
      FROM usuarios
      WHERE regexp_replace(whatsapp, '\\D', '', 'g') = $1
      LIMIT 1
    `,
    [whatsapp]
  );

  return result.rows[0] || null;
};

const crearUsuario = async (datos) => {
  const result = await query(
    `
      INSERT INTO usuarios (nombre, whatsapp, provincia, partido, lat, lng)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, nombre, whatsapp, provincia, partido, lat, lng, plan, activo
    `,
    [
      datos.nombre,
      normalizarWhatsapp(datos.whatsapp),
      datos.provincia || null,
      datos.partido || null,
      datos.lat ?? null,
      datos.lng ?? null,
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
  pushCampo("provincia", datos.provincia);
  pushCampo("partido", datos.partido);
  pushCampo("lat", datos.lat);
  pushCampo("lng", datos.lng);
  if (valueIsSet(datos.whatsapp)) {
    pushCampo("whatsapp", normalizarWhatsapp(datos.whatsapp));
  }

  if (!campos.length) {
    const current = await query(
      `
        SELECT id, nombre, whatsapp, provincia, partido, lat, lng, plan, activo
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
      RETURNING id, nombre, whatsapp, provincia, partido, lat, lng, plan, activo
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

const obtenerPerfil = async (numeroWhatsapp) => {
  const usuario = await buscarPorWhatsapp(numeroWhatsapp);
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

module.exports = {
  normalizarWhatsapp,
  buscarPorWhatsapp,
  crearUsuario,
  actualizarUsuario,
  guardarCultivosUsuario,
  obtenerPerfil,
};
