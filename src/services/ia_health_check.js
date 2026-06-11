const { runProviderChain } = require("./gemini");
const { query } = require("../config/database");
const { enviarAlertaSistema } = require("./alertas_sistema");

/**
 * Ejecuta un autodiagnóstico de IA probando 3 intenciones críticas: clima, precios y registro.
 * Guarda el resultado en `fuentes_estado` con `fuente_id = 'ia_health'`.
 * Si el estado de la IA cambia de operativo a erróneo (o viceversa), envía una notificación de Telegram.
 * 
 * @returns {Promise<{ status: string, elapsed: number, errorMsg: string|null }>}
 */
const ejecutarAutodiagnosticoIA = async () => {
  console.log("[IA Health Check] Iniciando autodiagnóstico de IA...");
  const start = Date.now();
  let status = "ok";
  let errorMsg = null;

  try {
    // 1. Clima Check
    console.log("[IA Health Check] Probando flujo: clima...");
    const resClima = await runProviderChain({
      system: "Clasifica la consulta. Responde únicamente con un objeto JSON plano que tenga la propiedad 'intencion' con valor 'clima'. No incluyas explicaciones ni formato markdown.",
      user: "Cómo está el clima hoy en Pergamino?",
      contextLabel: "ia.health.clima",
      opts: { responseMimeType: "application/json" }
    });

    const parsedClima = JSON.parse(resClima.texto);
    if (parsedClima.intencion !== "clima") {
      throw new Error(`Clasificación clima incorrecta. Esperaba 'clima', obtuve '${parsedClima.intencion}'`);
    }

    // 2. Precios Check
    console.log("[IA Health Check] Probando flujo: precios...");
    const resPrecios = await runProviderChain({
      system: "Clasifica la consulta. Responde únicamente con un objeto JSON plano que tenga la propiedad 'intencion' con valor 'precio'. No incluyas explicaciones ni formato markdown.",
      user: "Cuánto cotiza la soja en Rosario?",
      contextLabel: "ia.health.precios",
      opts: { responseMimeType: "application/json" }
    });

    const parsedPrecios = JSON.parse(resPrecios.texto);
    if (parsedPrecios.intencion !== "precio") {
      throw new Error(`Clasificación precios incorrecta. Esperaba 'precio', obtuve '${parsedPrecios.intencion}'`);
    }

    // 3. Registro Check
    console.log("[IA Health Check] Probando flujo: registro...");
    const resRegistro = await runProviderChain({
      system: "Clasifica la consulta. Responde únicamente con un objeto JSON plano que tenga la propiedad 'intencion' con valor 'registrar'. No incluyas explicaciones ni formato markdown.",
      user: "registrar venta de 50 toneladas de maiz",
      contextLabel: "ia.health.registro",
      opts: { responseMimeType: "application/json" }
    });

    const parsedRegistro = JSON.parse(resRegistro.texto);
    if (parsedRegistro.intencion !== "registrar") {
      throw new Error(`Clasificación registro incorrecta. Esperaba 'registrar', obtuve '${parsedRegistro.intencion}'`);
    }

    console.log("[IA Health Check] Autodiagnóstico OK. Todo funciona perfectamente.");
  } catch (error) {
    status = "error";
    errorMsg = error.message;
    console.error("[IA Health Check] Falla en autodiagnóstico:", errorMsg);
  }

  const elapsed = Date.now() - start;

  try {
    // 1. Obtener estado anterior para alertar solo en caso de transiciones/cambios
    const anterior = await query(
      "SELECT status FROM fuentes_estado WHERE fuente_id = 'ia_health' ORDER BY verificado_en DESC LIMIT 1"
    );
    const estadoAnterior = anterior.rows[0]?.status || "ok";

    // 2. Persistir nuevo estado
    await query(
      `
        INSERT INTO fuentes_estado (fuente_id, nombre, status, tiempo_ms, error_msg, verificado_en)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `,
      ["ia_health", "Autodiagnóstico de IA", status, elapsed, errorMsg]
    );

    // 3. Enviar notificaciones si hay cambios de estado de salud
    if (status !== estadoAnterior) {
      if (status === "error") {
        await enviarAlertaSistema({
          titulo: "🚨 ALERTA: Falla en Inteligencia Artificial",
          mensaje: `El autodiagnóstico de IA periódico ha fallado.\n\nError: ${errorMsg}\nTiempo de respuesta: ${(elapsed / 1000).toFixed(2)}s\n\nEl sistema conmutará automáticamente a proveedores alternativos/locales según la configuración.`,
          ignorarCooldown: true
        });
      } else {
        await enviarAlertaSistema({
          titulo: "✅ RESTABLECIDO: Inteligencia Artificial Operativa",
          mensaje: `El autodiagnóstico de IA ha vuelto a la normalidad.\nTodos los flujos (Clima, Precios, Registro) responden correctamente.\nTiempo de respuesta: ${(elapsed / 1000).toFixed(2)}s`,
          ignorarCooldown: true
        });
      }
    }
  } catch (dbErr) {
    console.error("[IA Health Check] Error persistiendo estado o alertando:", dbErr.message);
  }

  return { status, elapsed, errorMsg };
};

module.exports = { ejecutarAutodiagnosticoIA };
