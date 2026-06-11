#!/usr/bin/env node
/**
 * Prueba en consola los bloques del resumen interactivo.
 * Uso: AGRO_USUARIO_ID=123 node scripts/test-resumen-interactivo.js
 */
require("dotenv").config();

const {
  prepararDatosResumenInteractivo,
} = require("../src/services/resumen");
const resumenInteractivo = require("../src/services/resumen_interactivo");

const logBloque = (titulo, texto) => {
  console.log("\n" + "=".repeat(60));
  console.log(titulo);
  console.log("=".repeat(60));
  console.log(texto);
};

const main = async () => {
  const id = Number.parseInt(process.env.AGRO_USUARIO_ID || "", 10);
  if (!Number.isFinite(id) || id <= 0) {
    console.error("Definí AGRO_USUARIO_ID (numérico) con un usuario de tu base.");
    process.exitCode = 1;
    return;
  }

  const ctx = await prepararDatosResumenInteractivo(id);
  if (!ctx) {
    console.error("No se encontró usuario o falló la carga de contexto.");
    process.exitCode = 1;
    return;
  }

  const precios = await resumenInteractivo.generarBloquePreciosUsuario(ctx);
  logBloque("BLOQUE PRECIOS / HACIENDA", precios);

  const dato = await resumenInteractivo.generarDatosClavePorProducto(ctx);
  logBloque("DATOS CLAVE (por rubro)", dato);

  const prono = await resumenInteractivo.generarBloquePronostico(ctx);
  logBloque("PRONÓSTICO (hoy + 2 días, AR)", prono);

  const notis = await resumenInteractivo.generarBloqueNoticias(id, ctx);
  logBloque("NOTICIAS (3)", notis);

  const usuarioMock = {
    id: ctx.perfil.id,
    plan: ctx.perfil.plan,
    plan_activo_hasta: ctx.perfil.plan_activo_hasta,
  };
  const que = resumenInteractivo.generarBloqueQuePuedoHacer(usuarioMock);
  logBloque("QUÉ PODÉS HACER", que);

  console.log("\n[OK] Heurística sí/no:", {
    "esAfirmativo('sí')": resumenInteractivo.esAfirmativo("sí"),
    "esNegativo('no')": resumenInteractivo.esNegativo("no"),
  });
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
