"use strict";

const H = require("../consultas/legacy_helpers");
const { listarSaldos, listarLotesUsuario } = require("../inventario/core");
const { obtenerTextoMisGastos, obtenerTextoMisVentas, obtenerTextoMiMargen } = require("../gastos");
const { hayProveedorIa, ejecutarJsonConCadenaIA } = require("../agent/ia/json_chain");
const { conciliarPorSeguridad, ejecutarPasoConTraza } = require("../agent/orchestration/pasos");
const {
  AGENT_PROMPT_VERSION,
  buildConsultaRegistrosPaso1System,
  buildConsultaRegistrosPaso2System,
} = require("../agent/prompts/builders");

const normTxt = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const pushGateTrace = (clasificacion, evento) => {
  if (!clasificacion || typeof clasificacion !== "object") return;
  const arr = Array.isArray(clasificacion.agentGateTrace) ? clasificacion.agentGateTrace : [];
  arr.push({ etapa: "agent_gate_consulta_registros", prompt_version: AGENT_PROMPT_VERSION, ...evento });
  clasificacion.agentGateTrace = arr.slice(-30);
};

const prioridadModo = (modo = "") => {
  if (modo === "aclarar") return 3;
  if (modo === "consultar") return 2;
  if (modo === "derivar_registrar") return 1;
  return 0;
};

const normalizarModo = (raw = {}) => {
  const o = raw && typeof raw === "object" ? raw : {};
  const modo = String(o.modo || o.decision || o.decision_final || "consultar").trim().toLowerCase();
  const confRaw = Number(o.confianza);
  const confianza = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : null;
  const repregunta = String(o.repregunta || "").trim();
  if (["consultar", "derivar_registrar", "aclarar"].includes(modo)) {
    return { modo, confianza, repregunta };
  }
  return { modo: "consultar", confianza, repregunta };
};

const gateConsultaRegistros = async ({ mensaje, clasificacion }) => {
  const t = normTxt(mensaje);
  const tieneNumero = /\d/.test(String(mensaje || ""));
  const senalRegistro =
    /\b(gast[eé]|compr[eé]|vend[ií]|registr|carg|anot|sum[eé]|agregu[eé]|met[ií]|ingres[eé]|actualiz)\b/.test(t) &&
    (tieneNumero || /\b(vacas?|novill|terner|lote|ha|hect)\b/.test(t));
  const senalConsulta = /\b(que\s+hay|que\s+tengo|mis\s+registros|inventario|stock|cu[aá]nto|mostrar|resumen|lista)\b/.test(t);

  if (senalRegistro && !senalConsulta) {
    pushGateTrace(clasificacion, { ok: true, via: "heuristica_local", modo: "derivar_registrar" });
    return { modo: "derivar_registrar", confianza: 0.9, repregunta: "" };
  }
  if (senalConsulta && !senalRegistro) {
    pushGateTrace(clasificacion, { ok: true, via: "heuristica_local", modo: "consultar" });
    return { modo: "consultar", confianza: 0.9, repregunta: "" };
  }

  if (!hayProveedorIa()) {
    pushGateTrace(clasificacion, { ok: false, via: "sin_ia", modo: "aclarar" });
    return {
      modo: "aclarar",
      confianza: null,
      repregunta:
        "¿Querés que te *muestre* lo cargado o que *registre* un dato nuevo? Si es registro, mandame una línea con número y detalle.",
    };
  }

  const system1 = buildConsultaRegistrosPaso1System();
  const user = `Mensaje: ${String(mensaje || "").trim()}`;

  let m1 = null;
  const traceGate = [];
  const p1 = await ejecutarPasoConTraza({
    etapa: "ia_paso1",
    trace: traceGate,
    ejecutar: async () =>
      ejecutarJsonConCadenaIA({
        system: system1,
        user,
        maxTokens: Number(process.env.CONSULTA_REG_GATE_MAX_TOKENS || 130),
        contextLabel: "IA.consulta_reg_gate",
        orderEnvVar: "CONSULTA_REG_GATE_IA_ORDER",
      }),
    normalizar: (raw) => normalizarModo(raw?.parsed || {}),
  });
  if (p1.ok) {
    m1 = p1.normalizado;
    pushGateTrace(clasificacion, {
      ok: true,
      via: "ia_paso1",
      provider: p1.raw?.providerUsed || null,
      model: p1.raw?.model || null,
      provider_trace: p1.raw?.trace || [],
      modo: m1.modo,
      confianza: m1.confianza,
    });
  } else {
    pushGateTrace(clasificacion, { ok: false, via: "ia_paso1_error", error: p1.error });
  }

  let m2 = null;
  const system2 = buildConsultaRegistrosPaso2System();
  const p2 = await ejecutarPasoConTraza({
    etapa: "ia_paso2_critic",
    trace: traceGate,
    ejecutar: async () =>
      ejecutarJsonConCadenaIA({
        system: system2,
        user: `${user}\nDecision candidata: ${JSON.stringify(m1 || {})}`,
        maxTokens: Number(process.env.CONSULTA_REG_GATE_PASO2_MAX_TOKENS || 120),
        contextLabel: "IA.consulta_reg_gate_critic",
        orderEnvVar: "CONSULTA_REG_GATE_IA_ORDER",
      }),
    normalizar: (raw) => normalizarModo(raw?.parsed || {}),
  });
  if (p2.ok) {
    m2 = p2.normalizado;
    pushGateTrace(clasificacion, {
      ok: true,
      via: "ia_paso2_critic",
      provider: p2.raw?.providerUsed || null,
      model: p2.raw?.model || null,
      provider_trace: p2.raw?.trace || [],
      modo: m2.modo,
      confianza: m2.confianza,
    });
  } else {
    pushGateTrace(clasificacion, { ok: false, via: "ia_paso2_error", error: p2.error });
  }

  const elegidoWrap = conciliarPorSeguridad({
    primaria: m1,
    critic: m2,
    prioridadFn: (x) => prioridadModo(String(x?.modo || "")),
    preferir: "critic",
  });
  const elegido = elegidoWrap.salida || { modo: "consultar", confianza: null, repregunta: "" };
  pushGateTrace(clasificacion, { ok: true, via: "conciliacion", modo: elegido.modo, confianza: elegido.confianza });
  if (elegido.modo === "aclarar" && !elegido.repregunta) {
    elegido.repregunta =
      "¿Querés que te *muestre* lo cargado o que *registre* un dato nuevo? Si es registro, mandame una línea con número y detalle.";
  }
  return elegido;
};

async function formatoLotesBrief(usuarioId) {
  const lotes = await listarLotesUsuario(usuarioId);
  if (!lotes?.length) return "(sin lotes cargados)";
  
  // Consulta recuento de animales por lote para este productor
  const resCounts = await H.query(
    `
      SELECT ubicacion_id, COUNT(*) as cabezas
      FROM animales_individuales
      WHERE usuario_id = $1 AND ubicacion_id IS NOT NULL
      GROUP BY ubicacion_id
    `,
    [usuarioId]
  );
  
  const countsMap = {};
  resCounts.rows.forEach(r => {
    countsMap[r.ubicacion_id] = Number(r.cabezas);
  });

  let eventosMap = {};
  try {
    const { obtenerUltimosEventosPastura, calcularSemaforoPastura } = require("./pasturas");
    const ultimosEventos = await obtenerUltimosEventosPastura(usuarioId);
    eventosMap = (ultimosEventos || []).reduce((acc, ev) => {
      if (ev.ubicacion_id) acc.byId[ev.ubicacion_id] = ev;
      if (ev.lote_nombre) acc.byName[String(ev.lote_nombre).toLowerCase()] = ev;
      return acc;
    }, { byId: {}, byName: {} });
    eventosMap.calc = calcularSemaforoPastura;
  } catch (e) {
    // Si falla el requerimiento o la tabla no existe aún, ignoramos
  }

  return lotes
    .slice(0, 80)
    .map((L) => {
      const nombre = L.nombre || `Lote #${L.id}`;
      const ha = L.hectareas != null ? ` · ${Number(L.hectareas)} ha` : "";
      const cult = L.cultivo ? ` · pastura/cultivo: ${L.cultivo}` : "";
      const cabezas = countsMap[L.id] || 0;
      const cargaText = cabezas > 0 ? ` · 🐄 Carga: ${cabezas} cab` : "";
      
      let semaforo = "⚪ Sin datos de pastoreo";
      if (cabezas > 0) {
        semaforo = "🔴 Ocupado / En consumo activo";
      } else if (eventosMap.calc) {
        const ev = eventosMap.byId[L.id] || eventosMap.byName[String(L.nombre).toLowerCase()];
        if (ev) {
          const res = eventosMap.calc(ev);
          semaforo = `${res.emoji} ${res.label}`;
        }
      }
      
      const semText = L.cultivo ? ` · [Semáforo Pasturas: ${semaforo}]` : "";
      return `- *${nombre}*${ha}${cult}${cargaText}${semText}`;
    })
    .join("\n");
}

async function formatoInventarioBrief(usuarioId) {
  try {
    const rows = await listarSaldos({ usuarioId });
    const arr = Array.isArray(rows) ? rows : [];
    if (!arr.length) return "(sin stock en inventario)";
    return JSON.stringify(arr, null, 0).slice(0, 2200);
  } catch (_e) {
    return "Inventario: no disponible ahora.";
  }
}

async function formatoAnimalesIndividualesBrief(usuarioId) {
  try {
    const res = await H.query(
      `
        SELECT a.caravana, a.categoria, a.estado, a.peso, a.sexo, a.raza, a.observaciones, 
               a.carencia_hasta, a.carencia_detalle, l.nombre as lote_nombre
        FROM animales_individuales a
        LEFT JOIN ubicaciones l ON l.id = a.ubicacion_id
        WHERE a.usuario_id = $1
        ORDER BY a.caravana ASC, a.creado_en DESC
      `,
      [usuarioId]
    );
    if (!res.rows.length) return "(sin animales individuales registrados)";
    return res.rows.map(r => {
      const cav = r.caravana ? `Caravana: *${r.caravana}*` : "Caravana: (sin caravana)";
      const cat = `Categoría: ${r.categoria}`;
      const rz = r.raza ? ` · Raza: ${r.raza}` : "";
      const sx = r.sexo ? ` · Sexo: ${r.sexo}` : "";
      const ps = r.peso != null ? ` · Peso: ${Number(r.peso)} kg` : "";
      const est = ` · Estado: ${r.estado}`;
      const lt = r.lote_nombre ? ` · Lote: ${r.lote_nombre}` : "";
      const obs = r.observaciones ? ` · Obs: "${r.observaciones}"` : "";
      
      let carenciaStr = "";
      if (r.carencia_hasta) {
        const cDate = new Date(r.carencia_hasta);
        const hoy = new Date();
        cDate.setHours(0, 0, 0, 0);
        hoy.setHours(0, 0, 0, 0);
        if (cDate >= hoy) {
          const fStr = `${String(cDate.getDate()).padStart(2, '0')}/${String(cDate.getMonth() + 1).padStart(2, '0')}/${cDate.getFullYear()}`;
          carenciaStr = ` · ⚠️ RETIRO/CARENCIA HASTA: ${fStr} (${r.carencia_detalle || "Sanidad"})`;
        }
      }

      return `- ${cav} (${cat}${rz}${sx}${ps}${est}${lt}${obs}${carenciaStr})`;
    }).join("\n");
  } catch (e) {
    console.error("[formatoAnimalesIndividualesBrief] Error:", e);
    return "Animales individuales: no disponibles ahora.";
  }
}

const rutaConsultaRegistros = async ({ mensaje, usuario, numeroWhatsapp, clasificacion }) => {
  const t = normTxt(mensaje);
  const wa = H.normalizarWhatsapp(numeroWhatsapp);
  const gate = await gateConsultaRegistros({ mensaje, clasificacion });
  if (gate?.modo === "aclarar" && gate?.repregunta) return gate.repregunta;
  if (gate?.modo === "derivar_registrar") {
    const { rutaRegistrar } = require("./registrar");
    return rutaRegistrar({ mensaje, usuario, numeroWhatsapp });
  }

  const tomaGasto = /\b(gast[oó]|cu[aá]nto gast|mis gastos|categor(i|í)a)\b/.test(t);
  const tomaVenta = /\b(venta|vend[ií]|mis ventas|factur)\b/.test(t);
  const tomaMargen =
    /\b(margen|rentabilidad|balance|resultado|c[uú]enta)\b/.test(t) ||
    /\b(qu[eé] me dej[oó]|c[oó]mo vengo|c[oó]mo estoy)\b/.test(t);
  const tomaInv = /\b(animal|cabez|novill|terner|ganad|stock|inventario|invent)\b/.test(t);
  const tomaLotes =
    /\b(lotes?|parcela|campo(s)?|pastura[s]?|rotacion[es]?|potrero[s]?|verdeo[s]?|alfa(?:lfa)?)\b/.test(t) ||
    (/\b(mis\b|cuant|cual|c[uú]ant|mostr[aá]?|list|r[eé]sume|como|estado|semaforo)\b/.test(t) && /\b(lotes?|pasturas?)\b/.test(t));
  const tomaIndividuales = /\b(individual|caravana|trazabilidad|arete|trazable)\b/.test(t) || 
                           (tomaInv && /\b(lista|cuales|cuales\s+son|mostra|tengo|ver)\b/.test(t));

  const bloques = [];

  if ((tomaGasto && !tomaVenta) || (tomaGasto && t.includes("gast") && !t.includes("vent"))) {
    bloques.push("--- Gastos del mes ---\n" + (await obtenerTextoMisGastos(wa)));
  } else if ((tomaVenta && !tomaGasto) || (t.includes("venta") && !t.includes("gast"))) {
    bloques.push("--- Ventas del mes ---\n" + (await obtenerTextoMisVentas(wa)));
  } else if (tomaMargen || (tomaGasto && tomaVenta)) {
    bloques.push("--- Margen / finanzas ---\n" + (await obtenerTextoMiMargen(wa)));
  }

  if (tomaIndividuales) {
    bloques.push("--- Animales Individuales (Trazabilidad) ---\n" + (await formatoAnimalesIndividualesBrief(usuario.id)));
  } else if (tomaInv) {
    bloques.push("--- Inventario ---\n" + (await formatoInventarioBrief(usuario.id)));
  }

  if (tomaLotes) {
    bloques.push("--- Lotes ---\n" + (await formatoLotesBrief(usuario.id)));
  }

  let bloqueFallback = "";
  if (!bloques.length) {
    try {
      const r = await H.obtenerResumenFinanciero(usuario.id);
      bloqueFallback = `Resumen financiero (JSON):\n${JSON.stringify(r || {}).slice(0, 2000)}`;
    } catch (_e) {
      bloqueFallback = "Finanzas: sin datos o error al leer.";
    }
    if (/\b(animal|invent|inventario|lote)\b/.test(t)) {
      bloqueFallback +=
        "\n\n" +
        "--- Inventario ---\n" +
        (await formatoInventarioBrief(usuario.id)) +
        "\n\n--- Animales Individuales (Trazabilidad) ---\n" +
        (await formatoAnimalesIndividualesBrief(usuario.id)) +
        "\n\n--- Lotes ---\n" +
        (await formatoLotesBrief(usuario.id));
    }
  }

  const payload = [...bloques, bloqueFallback].filter(Boolean).join("\n\n");

  const out = await H.generarConPromptLibre({
    system:
      "Sos AgroHabilis. Respondé en español argentino: resumí los datos del productor para WhatsApp (negritas con * donde ayude). No inventes registros. Si hay datos en la sección 'Animales Individuales (Trazabilidad)', listá TODOS los animales con su caravana, raza, categoría (si dice cabezas asumí que es del tipo detallado en el registro anterior o ternero), peso, estado, lote y cualquier observación de forma clara y detallada. IMPORTANTE: Si un animal tiene un retiro o carencia sanitaria activa (RETIRO/CARENCIA HASTA), es CRÍTICO que lo resaltes en negrita con un emoji de advertencia (⚠️), indicando la fecha límite de carencia y el motivo del retiro para evitar infracciones de faena.",
    user: `Pregunta:\n${mensaje}\n\nDatos internos:\n${payload}`,
  });

  const txt = String(out?.texto || "").trim();
  return txt || "Todavía no tengo registros cargados para mostrar.";
};

module.exports = { rutaConsultaRegistros };
