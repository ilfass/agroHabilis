"use strict";

const { rutaPrecio } = require("./rutas/precio");
const { rutaAnalisisMercado } = require("./rutas/analisis_mercado");
const { rutaAnalisisInterno } = require("./rutas/analisis_interno");
const { rutaClima } = require("./rutas/clima");
const { rutaRegistrar } = require("./rutas/registrar");
const { rutaConsultaRegistros } = require("./rutas/consulta_registros");
const { rutaAgroGeneral } = require("./rutas/agro_general");
const { rutaNoAgro } = require("./rutas/no_agro");
const { rutaSaludo } = require("./rutas/saludo");
const { rutaComando } = require("./rutas/comando");
const { rutaFletes } = require("./rutas/fletes");
const { rutaRaciones } = require("./rutas/raciones");
const { rutaPdf } = require("./rutas/pdf");

const pedirRegistro = () =>
  "Para eso primero necesito tu perfil activo. Escribime cualquier mensaje y arrancamos el onboarding.";

const routear = async ({ clasificacion, mensaje, usuario, numeroWhatsapp, historialReciente = [] }) => {
  const { intencion } = clasificacion || {};

  switch (intencion) {
    case "precio":
      return rutaPrecio({ clasificacion, mensaje, usuario, numeroWhatsapp });

    case "fletes":
      return rutaFletes({ clasificacion, mensaje, usuario, numeroWhatsapp });

    case "raciones":
      return rutaRaciones({ clasificacion, mensaje, usuario, numeroWhatsapp });

    case "pdf":
      return rutaPdf({ clasificacion, mensaje, usuario, numeroWhatsapp });

    case "analisis_mercado":
      return rutaAnalisisMercado({ clasificacion, mensaje, usuario, numeroWhatsapp });

    case "analisis_interno":
      if (!usuario?.id) return pedirRegistro();
      return rutaAnalisisInterno({ clasificacion, mensaje, usuario, numeroWhatsapp });

    case "clima":
      return rutaClima({ clasificacion, mensaje, usuario, numeroWhatsapp });

    case "registrar":
      return rutaRegistrar({ clasificacion, mensaje, usuario, numeroWhatsapp });

    case "registrar_pastura":
      const { rutaPasturas } = require("./rutas/pasturas");
      return rutaPasturas({ clasificacion, mensaje, usuario, numeroWhatsapp });


    case "consulta_registros":
      if (!usuario?.id) return pedirRegistro();
      return rutaConsultaRegistros({ clasificacion, mensaje, usuario, numeroWhatsapp });

    case "agro_general":
      return rutaAgroGeneral({ clasificacion, mensaje, usuario, historialReciente });

    case "no_agro":
      return rutaNoAgro({ clasificacion, mensaje, usuario, numeroWhatsapp });

    case "saludo":
      return rutaSaludo({ usuario, mensaje, historialReciente });

    case "small_talk":
      /**
       * Charla breve: re-usamos `rutaSaludo` que ya genera respuesta amigable
       * y reorienta a temas agro. Evita que el gate de dominio rechace al
       * usuario con "queda fuera de lo que puedo resolver".
       */
      return rutaSaludo({ usuario, mensaje, historialReciente });

    case "comando":
      return rutaComando({ clasificacion, mensaje, usuario, numeroWhatsapp });

    default:
      return rutaAgroGeneral({ clasificacion, mensaje, usuario });
  }
};

module.exports = { routear, pedirRegistro };
