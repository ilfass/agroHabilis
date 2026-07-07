"use strict";

const { query } = require("../../config/database");
const { guardarConsulta } = require("../../models/consulta");

let colaReintentosVisionIniciado = false;

/**
 * Registra e inicia el procesador periódico de la cola de reintentos de telemetría Gemini Vision.
 * @param {{ sendMessage: Function }} dependencies - Dependencias externas inyectadas para evitar acoplamiento circular.
 */
const iniciarProcesadorColaReintentosVision = (dependencies) => {
  if (colaReintentosVisionIniciado) return;
  colaReintentosVisionIniciado = true;

  const { sendMessage } = dependencies;
  if (typeof sendMessage !== "function") {
    throw new Error("[Vision Queue] Inyección de dependencia sendMessage inválida");
  }

  // Ejecutar por primera vez después de 1 minuto para dar tiempo al arranque y no congestionar
  setTimeout(() => {
    void procesarColaReintentosVision({ sendMessage });
  }, 60_000);

  // Intervalo cada 5 minutos
  const ms = 5 * 60 * 1000;
  setInterval(() => {
    void procesarColaReintentosVision({ sendMessage });
  }, ms);
  
  console.log("[Vision Queue] Procesador de cola de reintentos de telemetría registrado (intervalo 5m)");
};

/**
 * Drena y procesa los elementos pendientes en 'vision_retry_queue' intentando la extracción por visión.
 * @param {{ sendMessage: Function }} dependencies
 */
const procesarColaReintentosVision = async ({ sendMessage }) => {
  try {
    const res = await query(`
      SELECT id, usuario_id, whatsapp_norm, media_buffer, mime_type, intentos
      FROM vision_retry_queue
      WHERE intentos < 5
      ORDER BY creado_en ASC
    `);

    if (!res || !res.rows || res.rows.length === 0) {
      return;
    }

    console.log(`[Vision Queue] Procesando ${res.rows.length} elementos pendientes en la cola...`);
    const { extraerDatosMonitor } = require("./agro_vision");

    for (const item of res.rows) {
      try {
        console.log(`[Vision Queue] Reintentando elemento ${item.id} para usuario ${item.usuario_id}...`);
        const parsed = await extraerDatosMonitor(item.media_buffer, item.mime_type);
        
        if (parsed && parsed.tipo_labor && (parsed.hectareas_reales || parsed.dosis_promedio)) {
          // ¡Éxito! Insertar labor de maquinaria en base de datos
          await query(`
            INSERT INTO registro_labores_maquinaria 
              (usuario_id, tipo_labor, lote_nombre, hectareas_reales, dosis_promedio, producto_insumo, datos_crudos_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            item.usuario_id,
            parsed.tipo_labor,
            parsed.lote_nombre || 'Establecimiento General',
            parsed.hectareas_reales,
            parsed.dosis_promedio,
            parsed.producto_insumo || 'Insumo',
            JSON.stringify(parsed)
          ]);

          const emojiMap = {
            SIEMBRA: "🚜",
            COSECHA: "🌾",
            PULVERIZACION: "🌱"
          };
          const emoji = emojiMap[parsed.tipo_labor] || "🚜";
          
          const fmtNum = (val) => val != null ? Number(val).toLocaleString("es-AR", { maximumFractionDigits: 2 }) : null;
          
          let estDetalles = [];
          if (parsed.finca_nombre) estDetalles.push(parsed.finca_nombre);
          if (parsed.agricultor_nombre) estDetalles.push(parsed.agricultor_nombre);
          const estStr = estDetalles.length ? estDetalles.join(" · ") : null;

          let lines = [
            `📲 *¡Listo! Analicé tu foto pendiente y registré la labor:*`,
            ``,
            `* **Operación**: ${parsed.tipo_labor} ${emoji}`
          ];

          if (estStr) {
            lines.push(`* **Establecimiento**: ${estStr}`);
          }
          lines.push(`* **Lote**: ${parsed.lote_nombre || "Establecimiento General"}`);
          lines.push(`* **Superficie**: ${fmtNum(parsed.hectareas_reales) || "—"} ha reales`);
          lines.push(`* **Insumo**: ${parsed.producto_insumo || "—"}`);

          const insumoLower = String(parsed.producto_insumo || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const isSemillaDensidad = insumoLower.includes("maiz") || insumoLower.includes("girasol");
          const dosisUnidad = parsed.tipo_labor === 'SIEMBRA' ? (isSemillaDensidad ? 'sem/ha' : 'kg/ha') : parsed.tipo_labor === 'PULVERIZACION' ? 'l/ha' : 'tn/ha';
          lines.push(`* **Dosis Promedio**: ${fmtNum(parsed.dosis_promedio) || "—"} ${dosisUnidad}`);

          if (parsed.rendimiento_total_t != null) {
            lines.push(`* **Masa Seca Total**: ${fmtNum(parsed.rendimiento_total_t)} t`);
          }
          if (parsed.humedad_media != null) {
            lines.push(`* **Humedad Media**: ${fmtNum(parsed.humedad_media)}%`);
          }
          if (parsed.velocidad_media != null) {
            lines.push(`* **Velocidad Media**: ${fmtNum(parsed.velocidad_media)} km/h`);
          }

          lines.push(``);
          lines.push(`_Los datos ya están guardados en tu panel histórico de forma segura._`);

          const confirmationMsg = lines.join("\n");

          try {
            await guardarConsulta({
              usuarioId: item.usuario_id,
              whatsapp: item.whatsapp_norm,
              pregunta: "[Reintento automático: Imagen de monitor agrícola]",
              respuesta: confirmationMsg,
              tokensUsados: null,
              iaSinContexto: false,
              iaProvider: "gemini_vision",
              iaProviderTrace: [{ type: "vision_monitor_retry", success: true, data: parsed }]
            });
          } catch (eGuardar) {
            console.error("[Vision Queue] Error al registrar en historial_consultas:", eGuardar.message);
          }

          // Enviar mensaje de confirmación
          await sendMessage(item.whatsapp_norm, confirmationMsg);
          console.log(`[Vision Queue] Elemento ${item.id} resuelto con éxito y notificado a ${item.whatsapp_norm}`);

          // Eliminar de la cola
          await query("DELETE FROM vision_retry_queue WHERE id = $1", [item.id]);
        } else {
          // No es un monitor agrícola legible o es inválida
          console.log(`[Vision Queue] Elemento ${item.id} procesado pero no se detectaron métricas de monitor agrícola.`);
          try {
            const rUser = await query("SELECT nombre FROM usuarios WHERE id = $1", [item.usuario_id]);
            const nombreUsuario = rUser.rows[0]?.nombre ? rUser.rows[0].nombre.split(" ")[0] : "";
            const saludo = nombreUsuario ? `Hola ${nombreUsuario}, ` : "Hola, ";
            const msgFallo = `${saludo}estuve analizando la foto del monitor que me enviaste pero la calidad de la imagen o los reflejos de la pantalla dificultan la lectura de los datos. 📸\n\n¿Me podrías mandar otra foto con la pantalla bien centrada y sin reflejos para registrarlo de nuevo? ¡Gracias!`;
            await sendMessage(item.whatsapp_norm, msgFallo);
          } catch (eSend) {
            console.error("[Vision Queue] No se pudo enviar mensaje de fallo:", eSend.message);
          }
          await query("DELETE FROM vision_retry_queue WHERE id = $1", [item.id]);
        }
      } catch (err) {
        const errText = err.message.toLowerCase();
        const isQuotaError = errText.includes("429") || 
                             errText.includes("spending cap") || 
                             errText.includes("limit") || 
                             errText.includes("quota") || 
                             errText.includes("exhausted");

        if (isQuotaError) {
          // Seguimos sin cuota, incrementamos intentos y abortamos el procesamiento de esta tanda para no martillar la API
          console.warn(`[Vision Queue] ⚠️ Continuamos sin cuota de Gemini Vision. Abortando procesamiento de esta tanda. Error: ${err.message}`);
          await query(`
            UPDATE vision_retry_queue
            SET intentos = intentos + 1, ultimo_intento = NOW(), error_mensaje = $2
            WHERE id = $1
          `, [item.id, err.message]);
          break; // Salir del bucle for
        } else {
          // Error general, incrementamos intentos
          console.error(`[Vision Queue] Error procesando elemento ${item.id}:`, err.message);
          const nuevosIntentos = item.intentos + 1;
          if (nuevosIntentos >= 5) {
            console.warn(`[Vision Queue] Elemento ${item.id} superó los 5 intentos de procesamiento. Eliminando de la cola.`);
            try {
              const rUser = await query("SELECT nombre FROM usuarios WHERE id = $1", [item.usuario_id]);
              const nombreUsuario = rUser.rows[0]?.nombre ? rUser.rows[0].nombre.split(" ")[0] : "";
              const saludo = nombreUsuario ? `Hola ${nombreUsuario}, ` : "Hola, ";
              const msgFallo = `${saludo}estuve intentando procesar tu foto pendiente pero tuvimos problemas técnicos reiterados con el sistema de visión. 📸\n\n¿Me podrías reenviar la foto para probar de nuevo? ¡Muchas gracias!`;
              await sendMessage(item.whatsapp_norm, msgFallo);
            } catch (eSend) {
              console.error("[Vision Queue] No se pudo enviar mensaje de error persistente:", eSend.message);
            }
            await query("DELETE FROM vision_retry_queue WHERE id = $1", [item.id]);
          } else {
            await query(`
              UPDATE vision_retry_queue
              SET intentos = $2, ultimo_intento = NOW(), error_mensaje = $3
              WHERE id = $1
            `, [item.id, nuevosIntentos, err.message]);
          }
        }
      }
    }
  } catch (error) {
    console.error("[Vision Queue] Error crítico en procesarColaReintentosVision:", error.message);
  }
};

module.exports = {
  iniciarProcesadorColaReintentosVision,
  procesarColaReintentosVision,
};
