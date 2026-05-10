"use strict";

/**
 * Archivado (2026): flujo conversacional "CALCULAR COSTO" vía `onboarding_estado.datos_temporales.calculo_costo_flow`.
 * Antes se invocaba desde el orquestador grande de `procesarConsulta` en legacy; el pipeline actual (clasificador + router) no lo cablea.
 *
 * Si se reactiva: importar este módulo o fusionar de nuevo con `src/services/calculadora_costos.js` y enrutar la intención (p. ej. comando o ruta dedicada).
 */

const { query } = require("../src/config/database");
const { buscarPorWhatsapp, obtenerPerfil, guardarCultivosUsuario } = require("../src/models/usuario");

const norm = (txt = "") =>
  String(txt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const parseNumero = (txt = "") => {
  const clean = String(txt).replace(/\./g, "").replace(",", ".");
  const m = clean.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
};

const getFlowState = async (whatsapp) => {
  const estado = await query(
    `
      SELECT datos_temporales
      FROM onboarding_estado
      WHERE whatsapp = $1
      LIMIT 1
    `,
    [String(whatsapp).replace(/\D/g, "")]
  );
  return estado.rows[0]?.datos_temporales?.calculo_costo_flow || null;
};

const setFlowState = async (whatsapp, flow) => {
  const wp = String(whatsapp).replace(/\D/g, "");
  const current = await query(
    `
      SELECT paso_actual, completado, datos_temporales
      FROM onboarding_estado
      WHERE whatsapp = $1
      LIMIT 1
    `,
    [wp]
  );
  const pasoActual = current.rows[0]?.paso_actual || 3;
  const completado = current.rows[0]?.completado ?? true;
  const datosTemporales = current.rows[0]?.datos_temporales || {};
  datosTemporales.calculo_costo_flow = flow;

  await query(
    `
      INSERT INTO onboarding_estado (whatsapp, paso_actual, datos_temporales, completado)
      VALUES ($1, $2, $3::jsonb, $4)
      ON CONFLICT (whatsapp) DO UPDATE SET
        paso_actual = EXCLUDED.paso_actual,
        datos_temporales = EXCLUDED.datos_temporales,
        completado = EXCLUDED.completado,
        actualizado_en = NOW()
    `,
    [wp, pasoActual, JSON.stringify(datosTemporales), completado]
  );
};

const guiarCalculoCosto = async (whatsapp, mensaje) => {
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario) {
    return { enFlujo: false, respuesta: "Primero completá el onboarding inicial." };
  }

  const texto = String(mensaje || "").trim();
  const comando = norm(texto);
  let flow = await getFlowState(whatsapp);

  if (!flow && comando !== "calcular costo") {
    return { enFlujo: false, respuesta: null };
  }
  if (!flow) {
    flow = { paso: 1, data: {} };
    await setFlowState(whatsapp, flow);
    return {
      enFlujo: true,
      respuesta:
        "Para calcular tu costo por hectárea necesito algunos datos.\n¿El campo es propio o arrendado?",
    };
  }

  if (flow.paso === 1) {
    const t = norm(texto);
    if (!t.includes("propio") && !t.includes("arrend")) {
      return { enFlujo: true, respuesta: "Respondé 'propio' o 'arrendado'." };
    }
    flow.data.campo = t.includes("arrend") ? "arrendado" : "propio";
    flow.paso = flow.data.campo === "arrendado" ? 2 : 3;
    await setFlowState(whatsapp, flow);
    if (flow.paso === 2) {
      return { enFlujo: true, respuesta: "¿Cuánto pagás de arrendamiento? (USD/ha o qq/ha)" };
    }
    return {
      enFlujo: true,
      respuesta: "¿Tenés el costo de semilla, fertilizantes y agroquímicos aproximado? (total en USD/ha)",
    };
  }

  if (flow.paso === 2) {
    const arr = parseNumero(texto);
    if (arr === null || arr < 0) {
      return { enFlujo: true, respuesta: "No entendí el arrendamiento. Enviá un número." };
    }
    flow.data.arrendamiento = arr;
    flow.paso = 3;
    await setFlowState(whatsapp, flow);
    return {
      enFlujo: true,
      respuesta: "¿Tenés el costo de semilla, fertilizantes y agroquímicos aproximado? (total en USD/ha)",
    };
  }

  if (flow.paso === 3) {
    const insumos = parseNumero(texto);
    if (insumos === null || insumos < 0) {
      return { enFlujo: true, respuesta: "No entendí ese costo. Enviá un número en USD/ha." };
    }
    flow.data.insumos = insumos;
    flow.paso = 4;
    await setFlowState(whatsapp, flow);
    return { enFlujo: true, respuesta: "¿Y labores + flete + cosecha? (USD/ha)" };
  }

  if (flow.paso === 4) {
    const labores = parseNumero(texto);
    if (labores === null || labores < 0) {
      return { enFlujo: true, respuesta: "No entendí ese costo. Enviá un número en USD/ha." };
    }
    const total =
      Number(flow.data.insumos || 0) +
      Number(labores) +
      Number(flow.data.arrendamiento || 0);

    const perfil = await obtenerPerfil(whatsapp);
    const cultivos = (perfil?.cultivos || []).map((c) => c.cultivo);
    if (cultivos.length) {
      await guardarCultivosUsuario({
        usuarioId: usuario.id,
        cultivos,
        hectareas: perfil.cultivos[0]?.hectareas ?? null,
        costoPorHa: Number(total.toFixed(2)),
      });
    }

    await setFlowState(whatsapp, null);
    return {
      enFlujo: true,
      respuesta: `Perfecto. Costo total estimado guardado: USD ${Number(total.toFixed(2))}/ha.`,
    };
  }

  await setFlowState(whatsapp, null);
  return { enFlujo: true, respuesta: "Flujo de costo finalizado." };
};

module.exports = { guiarCalculoCosto, getFlowState, setFlowState };
