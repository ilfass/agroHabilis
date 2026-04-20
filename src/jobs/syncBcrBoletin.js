const { query } = require("../config/database");
const { obtenerDatosUltimoBoletin } = require("../scrapers/bcrBoletin");

const mercadoEtiqueta = (boletinNumero) =>
  `Rosario MFG (BCR boletin #${boletinNumero})`;

const upsertPrecio = async ({
  cultivo,
  mercado,
  precio,
  moneda,
  fechaSql,
}) => {
  await query(
    `
    INSERT INTO precios (cultivo, mercado, precio, moneda, fecha)
    VALUES ($1, $2, $3, $4, $5::date)
    ON CONFLICT (cultivo, mercado, fecha)
    DO UPDATE SET
      precio = EXCLUDED.precio,
      moneda = EXCLUDED.moneda,
      creado_en = NOW()
    `,
    [cultivo, mercado, precio, moneda, fechaSql]
  );
};

const sincronizarPreciosBoletinBcr = async () => {
  const datos = await obtenerDatosUltimoBoletin();
  const mercado = mercadoEtiqueta(datos.boletinNumero);
  const fechaSql = datos.fechaMercadoTexto.split("/").reverse().join("-");

  for (const fila of datos.minimos) {
    await upsertPrecio({
      cultivo: fila.cultivo,
      mercado,
      precio: fila.precio,
      moneda: fila.moneda,
      fechaSql,
    });
  }

  return {
    ok: true,
    boletinNumero: datos.boletinNumero,
    pdfUrl: datos.pdfUrl,
    fechaMercadoTexto: datos.fechaMercadoTexto,
    insertados: datos.minimos.length,
    datos,
  };
};

module.exports = {
  sincronizarPreciosBoletinBcr,
};
