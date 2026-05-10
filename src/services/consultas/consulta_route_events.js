"use strict";

const createConsultaRouteEvents = ({ queryFn: query, normalizarWhatsappFn: normalizarWhatsapp, logConsultaFn: logConsulta }) => {
  let eventosRutaSchemaReady = false;

  const ensureConsultaRouteEventsTable = async () => {
    if (eventosRutaSchemaReady) return;
    await query(
      `
      CREATE TABLE IF NOT EXISTS consulta_route_events (
        id BIGSERIAL PRIMARY KEY,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        whatsapp VARCHAR(32),
        route VARCHAR(64) NOT NULL,
        estado VARCHAR(32) NOT NULL,
        cultivo VARCHAR(32),
        faltantes TEXT,
        inconsistente BOOLEAN NOT NULL DEFAULT FALSE
      )
    `
    );
    await query(
      "CREATE INDEX IF NOT EXISTS idx_consulta_route_events_creado ON consulta_route_events (creado_en DESC)"
    );
    await query(
      "CREATE INDEX IF NOT EXISTS idx_consulta_route_events_route ON consulta_route_events (route, creado_en DESC)"
    );
    await query(
      "CREATE INDEX IF NOT EXISTS idx_consulta_route_events_whatsapp ON consulta_route_events (whatsapp, creado_en DESC)"
    );
    eventosRutaSchemaReady = true;
  };

  const registrarEventoRuta = async (payload = {}) => {
    try {
      await ensureConsultaRouteEventsTable();
      await query(
        `
        INSERT INTO consulta_route_events
          (whatsapp, route, estado, cultivo, faltantes, inconsistente)
        VALUES ($1,$2,$3,$4,$5,$6)
      `,
        [
          payload.whatsapp ? normalizarWhatsapp(payload.whatsapp) : null,
          payload.route || "N/A",
          payload.estado || "N/A",
          payload.cultivo || null,
          payload.faltantes || null,
          Boolean(payload.inconsistente),
        ]
      );
    } catch (error) {
      logConsulta({
        level: "warn",
        whatsapp: payload.whatsapp || "",
        route: "registrar_evento_ruta",
        message: `No se pudo registrar evento de ruta: ${error.message}`,
      });
    }
  };

  const logConsultaRoute = (whatsapp, route, extra = {}) => {
    try {
      const payload = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
      logConsulta({
        level: "info",
        whatsapp,
        route: String(route || ""),
        message: `Route event from=${normalizarWhatsapp(whatsapp)}${payload}`,
      });
    } catch (_e) {
      logConsulta({
        level: "info",
        whatsapp,
        route: String(route || ""),
        message: `Route event from=${normalizarWhatsapp(whatsapp)}`,
      });
    }
  };

  return { ensureConsultaRouteEventsTable, registrarEventoRuta, logConsultaRoute };
};

module.exports = { createConsultaRouteEvents };
