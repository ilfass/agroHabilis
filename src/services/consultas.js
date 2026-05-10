"use strict";

/**
 * Punto de entrada público de consultas (PASO 13 del spec de clasificación/router).
 * Expone la misma superficie que espera `src/config/whatsapp.js`:
 * `procesarConsulta`, `manejarComandoBot`, `obtenerEstadoBot`.
 *
 * La pipeline: perfil → comando control → clasificar → log → routear → historial.
 */

const { query } = require("../config/database");
const { guardarConsulta } = require("../models/consulta");
const { normalizarWhatsapp, obtenerPerfil } = require("../models/usuario");
const { parseComandoBot, manejarComandoBot, obtenerEstadoBot } = require("./consultas/bot_control");
const {
  clasificarMensaje,
  normalizarClasificacion,
  aplicarRefuerzoRegistroInventario,
} = require("./clasificador");
const { routear } = require("./router");
const {
  completarGeolocalizacionSiFalta,
  logConsultaRoute,
} = require("./consultas/legacy_helpers");
const { fusionarIntencionPrecalculada } = require("./consultas/intencion_precalculada");
const { obtenerPendiente } = require("./inventario/core");
const { manejarInventarioWhatsapp } = require("./inventario/whatsapp_flow");

/**
 * Perfil + geo + flag heurístico para el clasificador (`tiene_datos`).
 */
const obtenerYCompletarPerfil = async (numeroWhatsapp) => {
  const inicial = await obtenerPerfil(numeroWhatsapp);
  const usuario = await completarGeolocalizacionSiFalta(inicial);
  if (!usuario?.id) {
    return usuario ? { ...usuario, tiene_datos: false } : null;
  }
  const r = await query(
    `
      SELECT (
        EXISTS (SELECT 1 FROM gastos WHERE usuario_id = $1 LIMIT 1)
        OR EXISTS (SELECT 1 FROM ventas WHERE usuario_id = $1 LIMIT 1)
        OR EXISTS (SELECT 1 FROM inventario_movimiento WHERE usuario_id = $1 LIMIT 1)
      ) AS ok
    `,
    [usuario.id]
  );
  return { ...usuario, tiene_datos: Boolean(r.rows[0]?.ok) };
};

const procesarConsulta = async (numeroWhatsapp, pregunta, opciones = {}) => {
  const textoPregunta = String(pregunta || "").trim();
  if (!textoPregunta) return "No recibí la consulta.";

  const comandoControl = parseComandoBot(textoPregunta);
  if (comandoControl) {
    return manejarComandoBot(numeroWhatsapp, textoPregunta);
  }

  const usuario = await obtenerYCompletarPerfil(numeroWhatsapp);

  /* Inventario: confirmaciones (SI/NO), autocrear lote, o hectáreas pendientes.
   * Debe ejecutarse antes del clasificador: respuestas cortas como «si» suelen
   * etiquetarse como saludo y nunca llegaban a rutaRegistrar → whatsapp_flow. */
  if (usuario?.id) {
    const pendInv = await obtenerPendiente(usuario.id);
    if (pendInv) {
      const inv = await manejarInventarioWhatsapp({
        texto: textoPregunta,
        usuarioId: usuario.id,
        numeroWhatsapp: normalizarWhatsapp(numeroWhatsapp),
      });
      if (inv?.manejado && inv.respuesta != null) {
        const respuestaInv = inv.respuesta;
        logConsultaRoute(numeroWhatsapp, "registrar_inventario_pendiente", {
          cultivo: null,
          confianza: "alta",
          msClasificador: 0,
        });
        await guardarConsulta({
          usuarioId: usuario.id,
          whatsapp: normalizarWhatsapp(numeroWhatsapp),
          pregunta: textoPregunta,
          respuesta: respuestaInv,
          tokensUsados: null,
        });
        return respuestaInv;
      }
    }
  }

  const t0 = Date.now();
  let clasificacion = await clasificarMensaje(textoPregunta, usuario);
  if (opciones?.intencionPrecalculada) {
    clasificacion = normalizarClasificacion(
      fusionarIntencionPrecalculada(clasificacion, opciones.intencionPrecalculada, textoPregunta)
    );
  }
  clasificacion = aplicarRefuerzoRegistroInventario(textoPregunta, clasificacion);

  logConsultaRoute(numeroWhatsapp, clasificacion.intencion, {
    cultivo: clasificacion.cultivo,
    confianza: clasificacion.confianza,
    msClasificador: Date.now() - t0,
  });

  const respuesta = await routear({
    clasificacion,
    mensaje: textoPregunta,
    usuario,
    numeroWhatsapp,
  });

  await guardarConsulta({
    usuarioId: usuario?.id || null,
    whatsapp: normalizarWhatsapp(numeroWhatsapp),
    pregunta: textoPregunta,
    respuesta,
    tokensUsados: null,
  });

  return respuesta;
};

procesarConsulta.obtenerYCompletarPerfil = obtenerYCompletarPerfil;

module.exports = {
  manejarComandoBot,
  obtenerEstadoBot,
  procesarConsulta,
  obtenerYCompletarPerfil,
};
