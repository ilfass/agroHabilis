const templates = {
  bienvenida: require("./bienvenida"),
  resumen_diario: require("./resumen_diario"),
  mi_resumen: require("./mi_resumen"),
  alerta: require("./alerta"),
  analisis_venta: require("./analisis_venta"),
  consulta: require("./consulta"),
};

async function renderTemplate(nombre, usuario, ...args) {
  const template = templates[nombre];
  if (!template) throw new Error(`Template ${nombre} no existe`);
  const datos = await template.obtenerDatos(usuario, ...args);
  const render = await template.renderizar(usuario, datos, ...args);
  const mensaje = typeof render === "string" ? render : render?.mensaje;
  const meta = typeof render === "string" ? {} : render?.meta || {};
  console.log(`[Template ${nombre}] Datos obtenidos: ${Object.keys(datos || {}).join(", ")}`);
  return { mensaje, datos, meta, template: nombre };
}

module.exports = { renderTemplate, templates };
