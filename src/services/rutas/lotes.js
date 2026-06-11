const { crearLoteUsuario: invCrearLote } = require("../inventario/core");
const { query } = require("../../config/database");

async function rutaCrearLote({ args, usuario }) {
  if (!usuario) {
    return "No pude identificarte. Asegurate de estar registrado en AgroHabilis.";
  }

  // Soporte retrocompatible y soporte para array
  const lotesAProcesar = Array.isArray(args.lotes) ? args.lotes : [args];

  if (lotesAProcesar.length === 0) {
    return "No encontré lotes para crear. Por favor, indicame el nombre del lote o campo.";
  }

  const creados = [];
  const duplicados = [];
  const errores = [];

  for (const loteData of lotesAProcesar) {
    const nombre = String(loteData.nombre || "").trim();
    if (!nombre) continue;

    try {
      // Validar duplicados
      const r = await query(
        `SELECT id FROM ubicaciones WHERE usuario_id = $1 AND LOWER(nombre) = LOWER($2) LIMIT 1`,
        [usuario.id, nombre]
      );

      if (r.rows.length > 0) {
        duplicados.push(nombre);
        continue;
      }

      // Preparar firma/cliente
      let firma = loteData.firma || null;
      let cliente = loteData.cliente || null;
      if (loteData.firma_cliente && !firma && !cliente) {
        firma = loteData.firma_cliente;
      }

      // Crear el lote
      const loteObj = await invCrearLote({
        usuarioId: usuario.id,
        nombre,
        hectareas: loteData.hectareas || null,
        cultivo: loteData.cultivo || null,
        arrendado: loteData.arrendado || false,
        firma: firma,
        cliente: cliente,
      });

      creados.push(loteObj.nombre);
    } catch (error) {
      console.error("Error al crear lote individual:", error);
      errores.push(nombre);
    }
  }

  // Armar respuesta consolidada
  let msg = [];
  if (creados.length > 0) {
    msg.push(`¡Listo! Registré ${creados.length === 1 ? 'el nuevo campo/lote' : 'los nuevos campos/lotes'} con éxito: ${creados.join(", ")}. Ya podés empezar a cargarles movimientos, pasturas o gastos. 🌾`);
  }
  if (duplicados.length > 0) {
    msg.push(`Ya tenías registrado(s): ${duplicados.join(", ")}.`);
  }
  if (errores.length > 0) {
    msg.push(`Hubo un error al crear: ${errores.join(", ")}.`);
  }
  if (msg.length === 0) {
    return "Por favor, indicame el nombre del lote o campo que querés registrar.";
  }

  return msg.join("\n");
}

module.exports = { rutaCrearLote };
