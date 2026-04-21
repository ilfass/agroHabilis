const axios = require("axios");
const { query } = require("../config/database");
const { generarRespuestaConsulta } = require("./gemini");
const { guardarConsulta } = require("../models/consulta");
const {
  normalizarWhatsapp,
  buscarPorWhatsapp,
  actualizarUsuario,
  obtenerPerfil,
} = require("../models/usuario");

const obtenerUltimosPreciosPorCultivos = async (cultivos = []) => {
  const fechaResult = await query("SELECT MAX(fecha) AS fecha FROM precios");
  const fecha = fechaResult.rows[0]?.fecha;
  if (!fecha) return { fecha: null, items: [] };

  const cultivosLimpios = cultivos
    .map((c) => String(c || "").trim())
    .filter(Boolean);

  let preciosResult;
  if (cultivosLimpios.length) {
    preciosResult = await query(
      `
        SELECT cultivo, mercado, precio, moneda, fecha
        FROM precios
        WHERE fecha = $1
          AND LOWER(cultivo) = ANY($2::text[])
        ORDER BY cultivo, mercado
      `,
      [fecha, cultivosLimpios.map((x) => x.toLowerCase())]
    );
  } else {
    preciosResult = await query(
      `
        SELECT cultivo, mercado, precio, moneda, fecha
        FROM precios
        WHERE fecha = $1
        ORDER BY cultivo, mercado
      `,
      [fecha]
    );
  }

  return { fecha, items: preciosResult.rows };
};

const obtenerUltimoTipoCambio = async () => {
  const fechaResult = await query("SELECT MAX(fecha) AS fecha FROM tipo_cambio");
  const fecha = fechaResult.rows[0]?.fecha;
  if (!fecha) return { fecha: null, items: [] };

  const tcResult = await query(
    `
      SELECT tipo, valor, fecha
      FROM tipo_cambio
      WHERE fecha = $1
      ORDER BY tipo
    `,
    [fecha]
  );

  return { fecha, items: tcResult.rows };
};

const geocodificarZona = async ({ partido, provincia }) => {
  if (!partido || !provincia) return null;
  const q = `${partido}, ${provincia}, Argentina`;
  const response = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: {
      q,
      format: "json",
      limit: 1,
    },
    timeout: 30_000,
    headers: {
      "User-Agent": "AgroHabilis/1.0 (soporte@agrohabilis.com)",
    },
    validateStatus: (s) => s === 200,
  });
  const row = Array.isArray(response.data) ? response.data[0] : null;
  if (!row) return null;

  const lat = Number(row.lat);
  const lng = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const completarGeolocalizacionSiFalta = async (perfil) => {
  if (!perfil) return perfil;
  if (perfil.lat !== null && perfil.lng !== null) return perfil;

  try {
    const geo = await geocodificarZona({
      partido: perfil.partido,
      provincia: perfil.provincia,
    });
    if (!geo) return perfil;
    const actualizado = await actualizarUsuario(perfil.id, geo);
    return { ...perfil, lat: actualizado?.lat ?? geo.lat, lng: actualizado?.lng ?? geo.lng };
  } catch (error) {
    console.warn("[Consultas] No se pudo geocodificar zona:", error.message);
    return perfil;
  }
};

const obtenerClimaZona = async ({ lat, lng }) => {
  if (lat === null || lng === null || lat === undefined || lng === undefined) {
    return [];
  }
  const result = await query(
    `
      SELECT fecha, temp_min, temp_max, precipitacion, helada, descripcion
      FROM clima
      WHERE lat = $1 AND lng = $2
      ORDER BY fecha DESC
      LIMIT 7
    `,
    [lat, lng]
  );
  return result.rows.reverse();
};

const normalizarTextoComando = (texto = "") =>
  String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

const parseComandoBot = (texto = "") => {
  const cmd = normalizarTextoComando(texto);
  if (cmd === "PAUSAR BOT") return "PAUSAR_BOT";
  if (cmd === "ACTIVAR BOT") return "ACTIVAR_BOT";
  if (cmd === "ESTADO BOT") return "ESTADO_BOT";
  return null;
};

const obtenerEstadoBot = async (numeroWhatsapp) => {
  const whatsapp = normalizarWhatsapp(numeroWhatsapp);
  if (!whatsapp) return true;

  const result = await query(
    `
      SELECT bot_activo
      FROM whatsapp_bot_control
      WHERE whatsapp = $1
      LIMIT 1
    `,
    [whatsapp]
  );
  if (!result.rows[0]) return true;
  return Boolean(result.rows[0].bot_activo);
};

const setEstadoBot = async (numeroWhatsapp, botActivo) => {
  const whatsapp = normalizarWhatsapp(numeroWhatsapp);
  if (!whatsapp) {
    throw new Error("Numero invalido para controlar estado del bot");
  }

  await query(
    `
      INSERT INTO whatsapp_bot_control (whatsapp, bot_activo)
      VALUES ($1, $2)
      ON CONFLICT (whatsapp)
      DO UPDATE SET
        bot_activo = EXCLUDED.bot_activo,
        actualizado_en = NOW()
    `,
    [whatsapp, botActivo]
  );
};

const manejarComandoBot = async (numeroWhatsapp, texto) => {
  const comando = parseComandoBot(texto);
  if (!comando) return null;

  if (comando === "PAUSAR_BOT") {
    await setEstadoBot(numeroWhatsapp, false);
    return "Listo, desactive el bot para este chat. Para volver a activarlo escribi: ACTIVAR BOT";
  }

  if (comando === "ACTIVAR_BOT") {
    await setEstadoBot(numeroWhatsapp, true);
    return "Perfecto, el bot quedo activado para este chat.";
  }

  const activo = await obtenerEstadoBot(numeroWhatsapp);
  return activo
    ? "Estado del bot: ACTIVO en este chat."
    : "Estado del bot: PAUSADO en este chat.";
};

const armarContextoDatos = ({ usuario, precios, tipoCambio, cultivos, clima }) => {
  return JSON.stringify(
    {
      unidades_y_significado: {
        precios_ars:
          "Cada fila con moneda ARS es precio de granos por TONELADA (pizarra/plaza local, ej. AFA o CAC), no por kilo ni por hectárea.",
        precios_usd:
          "Cada fila con moneda USD es referencia FOB/exportación u homóloga en dólares por TONELADA (ej. MAGYP FOB oficial), salvo que el campo mercado indique otra convención.",
        tipo_cambio:
          "tipo_cambio.valor es ARS por 1 USD según la categoría (oficial, blue, bolsa, ccl); corresponde a la cotización del día indicado.",
      },
      usuario: usuario
        ? {
            id: usuario.id,
            nombre: usuario.nombre,
            whatsapp: usuario.whatsapp,
            provincia: usuario.provincia,
            partido: usuario.partido,
            lat: usuario.lat,
            lng: usuario.lng,
            plan: usuario.plan,
            activo: usuario.activo,
          }
        : null,
      precios: {
        fecha: precios.fecha,
        items: precios.items,
      },
      tipo_cambio: {
        fecha: tipoCambio.fecha,
        items: tipoCambio.items,
      },
      cultivos_usuario: cultivos,
      clima_zona_usuario: clima,
    },
    null,
    2
  );
};

const procesarConsulta = async (numeroWhatsapp, pregunta) => {
  const textoPregunta = String(pregunta || "").trim();
  if (!textoPregunta) {
    return "No recibí la consulta. Escribime tu pregunta y te respondo con datos actualizados.";
  }

  const perfilInicial = await obtenerPerfil(numeroWhatsapp);
  const usuario = await completarGeolocalizacionSiFalta(perfilInicial);
  const cultivos = usuario?.cultivos || [];
  const precios = await obtenerUltimosPreciosPorCultivos(cultivos.map((c) => c.cultivo));
  const tipoCambio = await obtenerUltimoTipoCambio();
  const clima = usuario ? await obtenerClimaZona(usuario) : [];

  const contextoDatos = armarContextoDatos({
    usuario,
    precios,
    tipoCambio,
    cultivos,
    clima,
  });

  const { texto, tokensUsados } = await generarRespuestaConsulta({
    contextoDatos,
    pregunta: textoPregunta,
  });

  await guardarConsulta({
    usuarioId: usuario?.id || null,
    whatsapp: normalizarWhatsapp(numeroWhatsapp),
    pregunta: textoPregunta,
    respuesta: texto,
    tokensUsados,
  });

  return texto;
};

module.exports = {
  manejarComandoBot,
  obtenerEstadoBot,
  procesarConsulta,
};
