const armarTextoContexto = (datos, incluirDetalle = false) => {
  const lineas = [
    `Boletin: #${datos.boletinNumero}`,
    `Fecha mercado Rosario (MFG): ${datos.fechaMercadoTexto}`,
    `Fuente: ${datos.pdfUrl}`,
    "",
    "Minimos por cultivo y moneda (referencia operativa):",
    ...datos.minimos.map(
      (f) => `- ${f.cultivo} (${f.moneda}): ${f.precio}`
    ),
    "",
    "Detalle extra (opcional):",
    ...(incluirDetalle
      ? datos.filas.map(
          (f) =>
            `- ${f.cultivo} | ${f.destino} | ${f.entrega} | ${f.calidad} | ${f.moneda} ${f.precio}`
        )
      : ["(incluirDetalle=false)"]),
  ];
  return lineas.join("\n");
};

module.exports = { armarTextoContexto };
