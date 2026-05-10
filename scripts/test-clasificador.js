#!/usr/bin/env node
/**
 * Prueba el clasificador y el router (sin depender solo de IA: muestra tiempos y rutas).
 * Uso: node scripts/test-clasificador.js
 * Opcional: TEST_WHATSAPP=549... para perfil real de BD.
 * MAX_MENSAJES=5 limita cuántos ítems ejecutar (útil para CI sin cortar con `head`).
 */

"use strict";

require("dotenv").config();

const { clasificarMensaje, clasificarHeuristica, normalizarClasificacion } = require("../src/services/clasificador");
const { routear } = require("../src/services/router");
const {
  obtenerYCompletarPerfil,
} = require("../src/services/consultas/procesar_consulta");

const mensajes = [
  "cuánto está la soja hoy",
  "conviene vender o espero",
  "con mis costos me da?",
  "va a llover esta semana en Tandil",
  "gasté 500000 en glifosato",
  "cuánto gasté este mes",
  "nació un ternero en el lote norte",
  "cuántos animales tengo en total",
  "qué es el FAS teórico",
  "quién ganó el partido de anoche",
  "hola buen día",
  "MI RESUMEN",
  "avisame cuando la soja supere 440000",
  "cuándo se siembra el trigo en Buenos Aires",
  "llovió 35mm esta mañana",
];

(async () => {
  const wa =
    process.env.TEST_WHATSAPP?.trim() ||
    process.env.TEST_WA?.trim() ||
    "5490000000000";

  let usuario = { cultivos: [{ cultivo: "soja", hectareas: 100 }], tiene_datos: true };
  if (process.env.CARGAR_PERFIL_BD === "1") {
    try {
      usuario = (await Promise.race([
        obtenerYCompletarPerfil(wa),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout perfil")), 4000)),
      ])) || usuario;
    } catch (e) {
      console.warn("[test] Perfil BD omitido:", e.message);
    }
  }

  const soloHeu = String(process.env.CLASIFICADOR_SOLO_HEURISTICA || "").trim() === "1";

  const maxM = Number(process.env.MAX_MENSAJES);
  const lista =
    Number.isFinite(maxM) && maxM > 0 ? mensajes.slice(0, Math.floor(maxM)) : mensajes;

  for (const mensaje of lista) {
    const t0 = Date.now();
    let clasificación;
    let ms;
    if (soloHeu) {
      clasificación = normalizarClasificacion(clasificarHeuristica(mensaje));
      ms = Date.now() - t0;
    } else {
      clasificación = await clasificarMensaje(mensaje, usuario);
      ms = Date.now() - t0;
    }

    let respuesta = "";
    try {
      respuesta = await routear({
        clasificacion: clasificación,
        mensaje,
        usuario,
        numeroWhatsapp: wa,
      });
    } catch (err) {
      respuesta = `[error ruta] ${err.message}`;
    }

    const preview =
      String(respuesta || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 320) + (String(respuesta).length > 320 ? "…" : "");

    console.log("---");
    console.log("Mensaje:", mensaje);
    console.log("Clasificación:", JSON.stringify(clasificación, null, 2));
    console.log("Ruta (intención):", clasificación.intencion);
    console.log("Tiempo clasificación (ms):", ms);
    console.log("Respuesta:", preview);
  }
})();
