const { query } = require("../config/database");
const { buscarPorWhatsapp, obtenerPerfil, guardarCultivosUsuario } = require("../models/usuario");

const RANGOS_COSTO = {
  soja: {
    propio: [380, 450],
    arrendado: [500, 600],
  },
  maiz: {
    propio: [480, 560],
    arrendado: [620, 720],
  },
  trigo: {
    propio: [280, 350],
    arrendado: [380, 450],
  },
};

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

const promedio = ([a, b]) => Number(((Number(a) + Number(b)) / 2).toFixed(2));

const parseCultivo = (cultivo = "") => {
  const c = norm(cultivo);
  if (c.includes("soja")) return "soja";
  if (c.includes("maiz")) return "maiz";
  if (c.includes("trigo")) return "trigo";
  return "soja";
};

const calcularCostoPorHa = async (usuario, cultivo) => {
  const cultivoClave = parseCultivo(cultivo);
  const cultivoUsuario = (usuario?.cultivos || []).find(
    (c) => parseCultivo(c.cultivo) === cultivoClave
  );

  const costoActual = Number(cultivoUsuario?.costo_por_ha);
  if (Number.isFinite(costoActual) && costoActual > 0) {
    return {
      costo_estimado: costoActual,
      es_estimado: false,
      fuente: "usuario_cultivos.costo_por_ha",
    };
  }

  const r = RANGOS_COSTO[cultivoClave] || RANGOS_COSTO.soja;
  const estimado = promedio(r.propio);
  return {
    costo_estimado: estimado,
    es_estimado: true,
    fuente: "promedio_regional",
    rango_usd_ha: r.propio,
  };
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

module.exports = {
  calcularCostoPorHa,
  guiarCalculoCosto,
};
