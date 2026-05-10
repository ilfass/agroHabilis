const { resolverPlan } = require("../base");

const bienvenidaLayouts = {
  gratis: require("./bienvenida.gratis"),
  basico: require("./bienvenida.basico"),
  pro: require("./bienvenida.pro"),
};

const resumenDiarioLayouts = {
  gratis: require("./resumen_diario.gratis"),
  basico: require("./resumen_diario.basico"),
  pro: require("./resumen_diario.pro"),
};

const miResumenLayouts = {
  gratis: require("./mi_resumen.gratis"),
  basico: require("./mi_resumen.basico"),
  pro: require("./mi_resumen.pro"),
};

const alertaLayouts = {
  gratis: require("./alerta.gratis"),
  basico: require("./alerta.basico"),
  pro: require("./alerta.pro"),
};

const analisisVentaLayouts = {
  gratis: require("./analisis_venta.gratis"),
  basico: require("./analisis_venta.basico"),
  pro: require("./analisis_venta.pro"),
};

const consultaLayouts = {
  gratis: require("./consulta.gratis"),
  basico: require("./consulta.basico"),
  pro: require("./consulta.pro"),
};

const aplicarLayout = (tipo, usuario, payload) => {
  const plan = resolverPlan(usuario);
  if (tipo === "bienvenida") return (bienvenidaLayouts[plan] || bienvenidaLayouts.gratis)({ ...payload, usuario });
  if (tipo === "resumen_diario") {
    return (resumenDiarioLayouts[plan] || resumenDiarioLayouts.gratis)({ ...payload, usuario });
  }
  if (tipo === "mi_resumen") return (miResumenLayouts[plan] || miResumenLayouts.gratis)({ ...payload, usuario });
  if (tipo === "alerta") return (alertaLayouts[plan] || alertaLayouts.gratis)({ ...payload, usuario });
  if (tipo === "analisis_venta") {
    return (analisisVentaLayouts[plan] || analisisVentaLayouts.gratis)({ ...payload, usuario });
  }
  if (tipo === "consulta") return (consultaLayouts[plan] || consultaLayouts.gratis)({ ...payload, usuario });
  return payload.mensaje;
};

module.exports = {
  aplicarLayout,
};
