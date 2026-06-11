"use strict";

const H = require("../consultas/legacy_helpers");

const rutaPdf = async ({ clasificacion, mensaje, usuario }) => {
  const t = String(mensaje || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  let tipo = "trazabilidad";
  if (t.includes("sanidad") || t.includes("clinica") || t.includes("carencia") || t.includes("tratamiento") || t.includes("enfermo") || t.includes("veterinario")) {
    tipo = "sanidad";
  }

  const panelLink = "https://agro.habilispro.com/cliente.html";

  // Formatear respuesta de exportación PDF general
  return [
    `📄 *AGROHABILIS - PLANILLAS Y EXPORTACIÓN PDF*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `¡Hola! He preparado el generador del reporte oficial de:`,
    `👉 *${tipo === "sanidad" ? "Historial Clínico y Veterinario" : "Trazabilidad de Caravanas"}*`,
    `para tu establecimiento *"${usuario?.partido || "Tandil"}"*.`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Puedes visualizar, guardar o imprimir este documento certificado (diseñado con firma autorizada para manga veterinaria y auditorías de SENASA) haciendo clic en el siguiente enlace:`,
    "",
    `🔗 *${panelLink}*`,
    "",
    `💡 _Solo debés ingresar, ir a la pestaña "Hacienda y Pasturas" y presionar el botón "Exportar PDF" correspondiente al lado del listado. ¡Es instantáneo!_`
  ].join("\n");
};

module.exports = { rutaPdf };
