"use strict";

const H = require("../consultas/legacy_helpers");
const { preguntaConNoticiasMercado } = require("./consulta_contexto_mercado");

const rutaAnalisisInterno = async ({ clasificacion, mensaje, usuario }) => {
  const cultivos = usuario?.cultivos || [];
  let cultivo =
    clasificacion?.cultivo ||
    H.detectarCultivoConsulta(mensaje, cultivos) ||
    H.detectarCultivoEnTexto(mensaje);
  cultivo = cultivo ? H.parseCultivo(String(cultivo)) : null;

  let resumenTxt = "";
  let desgloseGastosTxt = "";
  let refInsumosTxt = "";
  try {
    const r = await H.obtenerResumenFinanciero(usuario.id);
    if (r?.porPerfil?.length) {
      resumenTxt = r.porPerfil
        .map(
          (p) =>
            `${p.perfil}: gastos ${Number(p.gastos || 0).toLocaleString("es-AR")} · ventas ${Number(
              p.ventas || 0
            ).toLocaleString("es-AR")} · margen ${Number(p.margen || 0).toLocaleString("es-AR")}`
        )
        .join("; ");
    }
    if (Array.isArray(r?.desgloseCategorias) && r.desgloseCategorias.length) {
      desgloseGastosTxt = r.desgloseCategorias
        .slice(0, 12)
        .map((d) => `- ${d.categoria}: $${Number(d.total || 0).toLocaleString("es-AR")}`)
        .join("\n");
    }
    if (Array.isArray(r?.referenciasInsumos) && r.referenciasInsumos.length) {
      refInsumosTxt = r.referenciasInsumos
        .slice(0, 6)
        .map((x) => `- ${x.categoria}/${x.producto}: ${Number(x.precio).toLocaleString("es-AR")} (${x.unidad})`)
        .join("\n");
    }
  } catch (_e) {
    /* opcional */
  }

  const perfilTxt = [
    usuario?.nombre && `Nombre: ${usuario.nombre}`,
    [usuario?.partido, usuario?.provincia].filter(Boolean).join(", ") && `Zona: ${[usuario?.partido, usuario?.provincia].filter(Boolean).join(", ")}`,
    cultivos.length &&
      `Cultivos: ${cultivos.map((c) => `${c.cultivo}${c.hectareas ? ` ${c.hectareas} ha` : ""}`).join(", ")}`,
    resumenTxt && `Movimientos mes: ${resumenTxt}`,
    desgloseGastosTxt && `Desglose gastos mes:\n${desgloseGastosTxt}`,
    refInsumosTxt && `Referencias insumos (último corte interno):\n${refInsumosTxt}`,
  ]
    .filter(Boolean)
    .join("\n");

  if (cultivo) {
    const row = cultivos.find((c) => H.parseCultivo(c.cultivo) === cultivo);
    if (row && Number.isFinite(Number(row.hectareas)) && Number(row.hectareas) > 0) {
      const out = await H.renderTemplate("analisis_venta", usuario, cultivo);
      const base = H.sanitizarPlaceholders(String(out?.mensaje || "").trim());
      const falta = !Number.isFinite(Number(row.costo_por_ha))
        ? "\n\n_Si querés afinar el margen, completá costo por ha en tu perfil._"
        : "";
      const ventaPlusNoticias = await preguntaConNoticiasMercado({
        clasificacion,
        mensaje: `${base}${falta}`,
        extraKeys: cultivo ? [cultivo] : [],
      });
      return H.enriquecerConGroundingAgroSiHaceFalta({
        pregunta: mensaje,
        textoBase: ventaPlusNoticias,
        intencion: "analisis_interno",
      });
    }
  }

  const preguntaBase = `${mensaje}\n\n--- Perfil y datos cargados ---\n${perfilTxt || "(sin datos extra)"}`;
  const pregunta = await preguntaConNoticiasMercado({
    clasificacion,
    mensaje: preguntaBase,
    extraKeys: cultivo ? [cultivo] : [],
  });
  const out = await H.renderTemplate("consulta", usuario, pregunta);
  return H.enriquecerConGroundingAgroSiHaceFalta({
    pregunta: mensaje,
    textoBase: H.sanitizarPlaceholders(String(out?.mensaje || "").trim()),
    intencion: "analisis_interno",
  });
};

module.exports = { rutaAnalisisInterno };
