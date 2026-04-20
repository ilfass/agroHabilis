const { sendMessage } = require("../config/whatsapp");

const formatNumero = (numero) => String(numero || "").replace(/\D/g, "");

const enviarResumen = async (usuario, contenido) => {
  try {
    const numero = formatNumero(usuario?.whatsapp);
    if (!numero) {
      throw new Error("Usuario sin numero de WhatsApp valido");
    }
    const nombre = usuario?.nombre || "productor";
    const mensaje = `Hola ${nombre}, este es tu resumen diario de AgroHabilis:\n\n${contenido}`;
    const response = await sendMessage(numero, mensaje);
    return { ok: true, response };
  } catch (error) {
    console.error("Error enviando resumen por WhatsApp:", error.message);
    return { ok: false, error: error.message };
  }
};

const enviarAlerta = async (usuario, mensaje) => {
  try {
    const numero = formatNumero(usuario?.whatsapp);
    if (!numero) {
      throw new Error("Usuario sin numero de WhatsApp valido");
    }
    const texto = `Alerta AgroHabilis:\n\n${mensaje}`;
    const response = await sendMessage(numero, texto);
    return { ok: true, response };
  } catch (error) {
    console.error("Error enviando alerta por WhatsApp:", error.message);
    return { ok: false, error: error.message };
  }
};

module.exports = {
  enviarResumen,
  enviarAlerta,
};
