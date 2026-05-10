const axios = require("axios");
const { query } = require("../config/database");
const path = require("path");

const FUENTES_PATH = path.join(__dirname, "..", "config", "fuentes.js");
const cargarFuentesConfig = () => {
  try {
    delete require.cache[require.resolve(FUENTES_PATH)];
  } catch (_e) {}
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(FUENTES_PATH);
};

const flattenFuentes = (cfg = null) => {
  const fuentesCfg = cfg || cargarFuentesConfig();
  const rows = [];
  const walk = (node, path = []) => {
    if (Array.isArray(node)) {
      node.forEach((f) => rows.push({ ...f, categoria: path[0] || "general", grupo: path.slice(1).join("/") || "principal" }));
      return;
    }
    if (node && typeof node === "object") {
      Object.entries(node).forEach(([k, v]) => walk(v, [...path, k]));
    }
  };
  walk(fuentesCfg, []);
  return rows;
};

const fuentesActivas = () => flattenFuentes().filter((f) => f.activa);

const verificarFuente = async (fuente) => {
  const start = Date.now();
  try {
    const timeout = Number(process.env.FUENTES_TIMEOUT_MS || 12000);
    const response = await axios.get(fuente.url, {
      timeout,
      headers: { "User-Agent": "AgroHabilis/1.0 (monitor-fuentes)" },
      validateStatus: () => true,
    });
    const elapsed = Date.now() - start;
    if (response.status >= 200 && response.status < 400) {
      const status = elapsed > 8000 ? "lento" : "ok";
      return { status, tiempoMs: elapsed, errorMsg: null };
    }
    return {
      status: "error",
      tiempoMs: elapsed,
      errorMsg: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: "error",
      tiempoMs: Date.now() - start,
      errorMsg: String(error.message || "Error desconocido"),
    };
  }
};

const persistirEstadoFuente = async (fuente, verificacion) => {
  await query(
    `
      INSERT INTO fuentes_estado (fuente_id, nombre, status, tiempo_ms, error_msg, verificado_en)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `,
    [
      fuente.id,
      fuente.nombre || fuente.id,
      verificacion.status,
      verificacion.tiempoMs,
      verificacion.errorMsg,
    ]
  );
};

const verificarFuentes = async () => {
  const activas = fuentesActivas();
  const detalle = [];
  for (const fuente of activas) {
    const v = await verificarFuente(fuente);
    await persistirEstadoFuente(fuente, v);
    detalle.push({
      fuenteId: fuente.id,
      nombre: fuente.nombre,
      categoria: fuente.categoria,
      grupo: fuente.grupo,
      region: fuente.region || fuente.cobertura || "n/d",
      productos: fuente.productos || fuente.variables || [],
      status: v.status,
      tiempoMs: v.tiempoMs,
      errorMsg: v.errorMsg,
    });
  }
  const ok = detalle.filter((d) => d.status === "ok").length;
  const lento = detalle.filter((d) => d.status === "lento").length;
  const error = detalle.filter((d) => d.status === "error").length;
  return {
    total: detalle.length,
    ok,
    lento,
    error,
    detalle,
    verificadoEn: new Date().toISOString(),
  };
};

const obtenerEstadoFuentes = async () => {
  const result = await query(
    `
      SELECT DISTINCT ON (fuente_id)
        fuente_id, nombre, status, tiempo_ms, error_msg, verificado_en
      FROM fuentes_estado
      ORDER BY fuente_id, verificado_en DESC
    `
  );
  const latestById = new Map(result.rows.map((r) => [r.fuente_id, r]));

  const activas = fuentesActivas().map((f) => {
    const last = latestById.get(f.id);
    return {
      id: f.id,
      nombre: f.nombre,
      categoria: f.categoria,
      grupo: f.grupo,
      region: f.region || f.cobertura || "n/d",
      productos: f.productos || f.variables || [],
      url: f.url,
      oficial: Boolean(f.oficial),
      status: last?.status || "sin_verificar",
      tiempoMs: last?.tiempo_ms ?? null,
      errorMsg: last?.error_msg ?? null,
      verificadoEn: last?.verificado_en || null,
    };
  });

  const resumen = {
    total: activas.length,
    ok: activas.filter((x) => x.status === "ok").length,
    lento: activas.filter((x) => x.status === "lento").length,
    error: activas.filter((x) => x.status === "error").length,
    sinVerificar: activas.filter((x) => x.status === "sin_verificar").length,
  };

  const agrupadas = activas.reduce((acc, item) => {
    if (!acc[item.categoria]) acc[item.categoria] = [];
    acc[item.categoria].push(item);
    return acc;
  }, {});

  return { resumen, activas, agrupadas };
};

const resumenFuentesWhatsapp = async () => {
  const data = await obtenerEstadoFuentes();
  const lines = [
    "🛰️ *Estado de fuentes activas*",
    `- Total: ${data.resumen.total}`,
    `- OK: ${data.resumen.ok}`,
    `- Lentas: ${data.resumen.lento}`,
    `- Error: ${data.resumen.error}`,
    `- Sin verificar: ${data.resumen.sinVerificar}`,
    "",
  ];

  data.activas.slice(0, 12).forEach((f) => {
    const icon = f.status === "ok" ? "🟢" : f.status === "lento" ? "🟡" : f.status === "error" ? "🔴" : "⚪";
    const when = f.verificadoEn ? new Date(f.verificadoEn).toLocaleString("es-AR") : "nunca";
    lines.push(`${icon} ${f.nombre} (${f.categoria})`);
    lines.push(`   ${f.status.toUpperCase()} · ${when}`);
  });
  return lines.join("\n");
};

module.exports = {
  flattenFuentes,
  fuentesActivas,
  verificarFuentes,
  obtenerEstadoFuentes,
  resumenFuentesWhatsapp,
};
