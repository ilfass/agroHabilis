const { query } = require("../config/database");
const { enviarAlerta } = require("./notificaciones");
const { obtenerUsuarioPorId } = require("./resumenes");

const registrarEnvio = async ({
  usuarioId,
  resumenId,
  estado,
  errorMsg = null,
}) => {
  await query(
    `
    INSERT INTO envios_whatsapp (usuario_id, resumen_id, estado, error_msg)
    VALUES ($1, $2, $3, $4)
    `,
    [usuarioId, resumenId, estado, errorMsg]
  );
};

const marcarResumenEnviado = async (resumenId) => {
  await query(
    `
    UPDATE resumenes
    SET enviado_wp = true, enviado_en = NOW()
    WHERE id = $1
    `,
    [resumenId]
  );
};

const enviarResumenYRegistrar = async ({ usuarioId, resumenId, texto }) => {
  const usuario = await obtenerUsuarioPorId(usuarioId);
  if (!usuario) {
    throw new Error(`No se encontro usuario con id=${usuarioId}`);
  }
  const envio = await enviarAlerta(usuario, texto);
  if (!envio.ok) {
    throw new Error(envio.error || "No se pudo enviar por WhatsApp");
  }
  await registrarEnvio({
    usuarioId,
    resumenId,
    estado: "ok",
    errorMsg: null,
  });
  await marcarResumenEnviado(resumenId);
  return {
    messageId: envio.response?.id?._serialized || null,
  };
};

const enviarResumenYRegistrarError = async ({
  usuarioId,
  resumenId,
  error,
}) => {
  const msg = error?.message || String(error);
  await registrarEnvio({
    usuarioId,
    resumenId,
    estado: "error",
    errorMsg: msg.slice(0, 2000),
  });
};

module.exports = {
  enviarResumenYRegistrar,
  enviarResumenYRegistrarError,
  registrarEnvio,
};
