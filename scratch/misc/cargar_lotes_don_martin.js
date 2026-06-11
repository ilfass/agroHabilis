"use strict";
/**
 * cargar_lotes_don_martin.js
 * Registra los 22 lotes del campo Don Martín (firma: Daedaz Sociedad Anónima)
 * para el usuario Juan Barreiro (usuario_id = 575) y le envía un mensaje de WhatsApp.
 */

require("dotenv").config();
const { rutaCrearLote } = require("../src/services/rutas/lotes");
const { sendMessage } = require("../src/config/whatsapp");

const USUARIO = {
  id: 575,
  nombre: "Juan Barreiro",
};

const WHATSAPP_JUAN = "542281419121"; // +54 9 2281 41-9121

const LOTES = [
  { nombre: "Lote 1",   hectareas: 31.89, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 2a",  hectareas: 2.85,  cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 2b",  hectareas: 3.08,  cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 3",   hectareas: 37.17, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 4",   hectareas: 41.60, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 5",   hectareas: 33.87, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 5a",  hectareas: 15.13, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 6",   hectareas: 58.21, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 7",   hectareas: 39.89, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 7b",  hectareas: 12.40, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 7c",  hectareas: 20.24, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 7d",  hectareas: 19.26, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 8",   hectareas: 40.81, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 8b",  hectareas: 11.99, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 9",   hectareas: 23.72, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 9a",  hectareas: 40.94, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 10",  hectareas: 74.07, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 11",  hectareas: 42.92, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 12",  hectareas: 1.93,  cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 13",  hectareas: 5.50,  cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 14",  hectareas: 7.68,  cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
  { nombre: "Lote 15",  hectareas: 25.38, cliente: "Don Martín", firma: "Daedaz Sociedad Anónima" },
];

async function main() {
  console.log("══════════════════════════════════════════════════");
  console.log("  CARGANDO LOTES: Don Martín / Daedaz SA → Juan");
  console.log("══════════════════════════════════════════════════\n");

  // 1. Registrar lotes
  const resultado = await rutaCrearLote({
    args: { lotes: LOTES },
    usuario: USUARIO,
  });

  console.log("Resultado de rutaCrearLote:\n", resultado);

  // 2. Mensaje WhatsApp para Juan
  const mensajeWa = [
    "¡Listo Juan! 🌾 Cargué los *22 lotes* del campo *Don Martín* (Daedaz Sociedad Anónima) en tu perfil de AgroHabilis.",
    "",
    "📋 *Resumen del campo Don Martín — 590.53 ha totales:*",
    "",
    "• *Lote 1*: 31.89 ha",
    "• *Lote 2a*: 2.85 ha",
    "• *Lote 2b*: 3.08 ha",
    "• *Lote 3*: 37.17 ha",
    "• *Lote 4*: 41.60 ha",
    "• *Lote 5*: 33.87 ha",
    "• *Lote 5a*: 15.13 ha",
    "• *Lote 6*: 58.21 ha",
    "• *Lote 7*: 39.89 ha",
    "• *Lote 7b*: 12.40 ha",
    "• *Lote 7c*: 20.24 ha",
    "• *Lote 7d*: 19.26 ha",
    "• *Lote 8*: 40.81 ha",
    "• *Lote 8b*: 11.99 ha",
    "• *Lote 9*: 23.72 ha",
    "• *Lote 9a*: 40.94 ha",
    "• *Lote 10*: 74.07 ha",
    "• *Lote 11*: 42.92 ha",
    "• *Lote 12*: 1.93 ha",
    "• *Lote 13*: 5.50 ha",
    "• *Lote 14*: 7.68 ha",
    "• *Lote 15*: 25.38 ha",
    "",
    "Ya los podés ver todos en el panel y empezar a registrar siembras, movimientos de hacienda o gastos por lote. ¡Cualquier cosa avisame! 🤝",
  ].join("\n");

  console.log("\nEnviando mensaje a Juan por WhatsApp...");
  try {
    await sendMessage(WHATSAPP_JUAN, mensajeWa);
    console.log("✅ Mensaje enviado correctamente a", WHATSAPP_JUAN);
  } catch (err) {
    console.error("❌ Error al enviar WhatsApp:", err.message);
  }

  console.log("\n══════════════════════════════════════════════════");
  console.log("Operación completa.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
