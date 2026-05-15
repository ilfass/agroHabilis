"use strict";

const axios = require("axios");
const cheerio = require("cheerio");

const URL = "https://www.bcp.org.ar/informes.asp?id_inf=24";
const UA = { "User-Agent": "AgroHabilis/1.0 (+bcp-bahia-blanca)" };

/**
 * Scraper para la Bolsa de Cereales y Productos de Bahía Blanca (BCP).
 * Extrae precios de Cebada, Trigo, Maíz, Soja y Girasol.
 */
const obtenerPreciosBCP = async () => {
  try {
    const res = await axios.get(URL, {
      timeout: 30000,
      headers: UA,
      validateStatus: (s) => s === 200,
    });
    const $ = cheerio.load(res.data);
    const items = [];

    // Buscamos la fecha en el texto de las pestañas o el contenido
    // En el HTML suele aparecer como "Cotización DD-MM-YYYY"
    const fechaMatch = res.data.match(/Cotización\s*(\d{2})-(\d{2})-(\d{4})/);
    const fecha = fechaMatch ? `${fechaMatch[3]}-${fechaMatch[2]}-${fechaMatch[1]}` : new Date().toISOString().split("T")[0];

    // La BCP tiene tablas para Pizarra, FOB y FAS.
    // Usaremos un enfoque basado en las filas que contienen los nombres de los granos.
    // Estructura simplificada: TR -> TD (Grano) -> TD (Precio)
    
    $("tr").each((_i, el) => {
      const $tr = $(el);
      const text = $tr.text().toLowerCase();
      
      let cultivo = null;
      if (text.includes("trigo")) cultivo = "trigo";
      else if (text.includes("cebada")) cultivo = "cebada";
      else if (text.includes("maiz") || text.includes("maíz")) cultivo = "maiz";
      else if (text.includes("soja")) cultivo = "soja";
      else if (text.includes("girasol")) cultivo = "girasol";
      else if (text.includes("sorgo")) cultivo = "sorgo";

      if (!cultivo) return;

      // Intentamos extraer precios de las celdas
      const celdas = $tr.find("td").map((_, td) => $(td).text().trim()).get();
      
      // La BCP suele tener: [Grano, Precio Pizarra, Precio FOB, Precio FAS]
      // Pero varía según la sección. Vamos a buscar valores numéricos con $ o USD.
      celdas.forEach((val, idx) => {
        if (idx === 0) return; // Es el nombre del grano

        const num = parseFloat(val.replace(/\./g, "").replace(",", ".").replace(/[^0-9.]/g, ""));
        if (!isNaN(num) && num > 0) {
          const esDolar = val.includes("USD") || val.includes("U$D") || num < 2000; // Heurística: si es bajo, es USD
          
          items.push({
            cultivo,
            mercado: "BCP_BAHIA_BLANCA",
            precio_ars: esDolar ? null : num,
            precio_usd: esDolar ? num : null,
            fecha,
            fuente: "bcp_bahia",
            tipo_precio: "referencia",
            presentacion: text.includes("cervecera") ? "cervecera" : text.includes("forrajera") ? "forrajera" : null
          });
        }
      });
    });

    // Deduplicar y limpiar
    return items.filter((it, index, self) => 
      index === self.findIndex((t) => (
        t.cultivo === it.cultivo && t.mercado === it.mercado && t.precio_ars === it.precio_ars && t.precio_usd === it.precio_usd && t.presentacion === it.presentacion
      ))
    );
  } catch (error) {
    console.error("[Scraper][BCP] Error:", error.message);
    return [];
  }
};

module.exports = { obtenerPreciosBCP };
