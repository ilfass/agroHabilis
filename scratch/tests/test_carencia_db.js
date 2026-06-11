"use strict";

require("dotenv").config();
const { query, pool } = require("./src/config/database");
const { registroConfirmadoDirecto } = require("./src/services/inventario/core");

async function test() {
  console.log("==> Iniciando test de Carencia en DB");

  // Obtener un ID de usuario de prueba
  const uRes = await query("SELECT id FROM usuarios LIMIT 1");
  const usuarioId = uRes.rows[0]?.id;
  if (!usuarioId) {
    console.error("No se encontró ningún usuario en la DB para correr el test.");
    return;
  }
  console.log(`Usuario de prueba: ID ${usuarioId}`);

  // Crear un movimiento simulado confirmado con tratamiento sanitario
  const movimientoSimulado = {
    usuarioId,
    campanaId: null,
    loteId: null,
    dominio: "ganado",
    efecto: "replace",
    payload: {
      especie: "vacuno",
      categoria: "novillo",
      cantidad: 1,
      fecha_referencia: "2026-05-21",
      animales_individuales: [
        {
          caravana: "TEST-CAR-01",
          categoria: "novillo",
          estado: "tratado",
          peso: 220,
          sexo: "macho",
          raza: "Angus",
          observaciones: "Tratado con ivermectina por parásitos"
        }
      ]
    },
    textoNl: "Test de carencia veterinaria",
    fechaReferencia: "2026-05-21",
    canal: "test"
  };

  console.log("==> Ejecutando registroConfirmadoDirecto...");
  const mov = await registroConfirmadoDirecto(movimientoSimulado);
  console.log(`Movimiento creado con ID: ${mov.id}`);

  console.log("==> Verificando registro en la base de datos...");
  const verifyRes = await query(
    "SELECT caravana, observaciones, carencia_hasta, carencia_detalle FROM animales_individuales WHERE caravana = 'TEST-CAR-01'"
  );

  console.log("Resultado de la consulta DB:");
  console.log(verifyRes.rows[0]);

  // Limpiar animal de prueba y el movimiento generado
  await query("DELETE FROM animales_individuales WHERE caravana = 'TEST-CAR-01'");
  await query("DELETE FROM inventario_movimiento WHERE id = $1", [mov.id]);
  await query("DELETE FROM inventario_saldo WHERE ultimo_movimiento_id = $1", [mov.id]);
  console.log("==> Limpieza completada.");

  await pool.end();
}

test().catch(async (e) => {
  console.error("Error en test:", e);
  try {
    await pool.end();
  } catch (_) {}
});
