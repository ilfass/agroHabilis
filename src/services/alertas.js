const { query } = require("../config/database");
const { buscarPorWhatsapp, normalizarWhatsapp } = require("../models/usuario");
const { guardarConsulta } = require("../models/consulta");
const { generarConPromptLibre } = require("./gemini");
const { renderTemplate } = require("../templates");

const normalizarTexto = (txt = "") =>
  String(txt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const extraerNumero = (txt = "") => {
  const m = String(txt).match(/(\d[\d\.\,]*)/);
  if (!m) return null;
  return Number(m[1].replace(/\./g, "").replace(",", "."));
};

const detectarCultivo = (txt = "") => {
  const t = normalizarTexto(txt);
  if (t.includes("soja")) return "soja";
  if (t.includes("maiz")) return "maiz";
  if (t.includes("trigo")) return "trigo";
  if (t.includes("girasol")) return "girasol";
  return null;
};

const detectarTipo = (txt = "") => {
  const t = normalizarTexto(txt);
  const baja = t.includes("baja") || t.includes("baje") || t.includes("debajo");
  const sube = t.includes("sube") || t.includes("supere") || t.includes("arriba");
  const dolar = t.includes("dolar");
  if (dolar) return baja ? "dolar_baja" : "dolar_sube";
  if (baja) return "precio_baja";
  return sube || t.includes("llegue") ? "precio_sube" : "precio_sube";
};

const parsearAlerta = (texto) => {
  const valor = extraerNumero(texto);
  if (!Number.isFinite(valor)) {
    throw new Error("No pude identificar el valor objetivo en tu alerta.");
  }
  const tipo = detectarTipo(texto);
  const cultivo = tipo.startsWith("dolar")
    ? normalizarTexto(texto).includes("blue")
      ? "blue"
      : "oficial"
    : detectarCultivo(texto);

  if (!cultivo) {
    throw new Error("No pude identificar cultivo/tipo de dólar en tu alerta.");
  }
  return { cultivo, tipo, valorObjetivo: valor };
};

const configurarAlerta = async (whatsapp, texto) => {
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario) {
    return "Para crear alertas primero necesitás completar tu registro.";
  }
  const parsed = parsearAlerta(texto);
  const result = await query(
    `
      INSERT INTO alertas (usuario_id, cultivo, tipo, valor_objetivo, activa, disparada)
      VALUES ($1, $2, $3, $4, true, false)
      RETURNING id, cultivo, tipo, valor_objetivo
    `,
    [usuario.id, parsed.cultivo, parsed.tipo, parsed.valorObjetivo]
  );
  const alerta = result.rows[0];
  return `✅ Alerta creada (#${alerta.id}): ${alerta.tipo} ${alerta.cultivo} objetivo ${alerta.valor_objetivo}.`;
};

const listarAlertas = async (whatsapp) => {
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario) return "No encontré tu usuario.";
  const result = await query(
    `
      SELECT id, cultivo, tipo, valor_objetivo, activa, disparada, creado_en
      FROM alertas
      WHERE usuario_id = $1 AND activa = true
      ORDER BY id DESC
      LIMIT 20
    `,
    [usuario.id]
  );
  if (!result.rows.length) return "No tenés alertas activas.";
  return [
    "📌 *Tus alertas activas*",
    ...result.rows.map(
      (a) => `#${a.id} - ${a.tipo} ${a.cultivo} objetivo ${a.valor_objetivo}`
    ),
  ].join("\n");
};

const cancelarAlerta = async (whatsapp, idAlerta) => {
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario) return "No encontré tu usuario.";
  const id = Number(idAlerta);
  if (!Number.isInteger(id)) return "ID de alerta inválido.";
  const result = await query(
    `
      UPDATE alertas
      SET activa = false
      WHERE id = $1 AND usuario_id = $2
      RETURNING id
    `,
    [id, usuario.id]
  );
  if (!result.rows[0]) return "No encontré esa alerta para tu usuario.";
  return `🛑 Alerta #${id} desactivada.`;
};

const obtenerPrecioActual = async (cultivo) => {
  const r = await query(
    `
      SELECT precio, moneda, fecha
      FROM precios
      WHERE LOWER(cultivo) = LOWER($1)
      ORDER BY fecha DESC, creado_en DESC
      LIMIT 1
    `,
    [cultivo]
  );
  return r.rows[0] || null;
};

const obtenerDolarActual = async (tipo = "blue") => {
  const r = await query(
    `
      SELECT valor, fecha
      FROM tipo_cambio
      WHERE LOWER(tipo) = LOWER($1)
      ORDER BY fecha DESC
      LIMIT 1
    `,
    [tipo]
  );
  return r.rows[0] || null;
};

const obtenerContextoPrecio = async (cultivo) => {
  const variacion = await query(
    `
      WITH ult AS (
        SELECT fecha, AVG(precio)::numeric(12,2) AS p
        FROM precios
        WHERE LOWER(cultivo)=LOWER($1) AND moneda='ARS'
        GROUP BY fecha
        ORDER BY fecha DESC
        LIMIT 2
      )
      SELECT
        MAX(CASE WHEN rn=1 THEN p END) AS hoy,
        MAX(CASE WHEN rn=2 THEN p END) AS ayer
      FROM (
        SELECT p, ROW_NUMBER() OVER (ORDER BY fecha DESC) AS rn
        FROM ult
      ) x
    `,
    [cultivo]
  );
  const hoy = Number(variacion.rows[0]?.hoy);
  const ayer = Number(variacion.rows[0]?.ayer);
  const pct =
    Number.isFinite(hoy) && Number.isFinite(ayer) && ayer !== 0
      ? Number((((hoy - ayer) / ayer) * 100).toFixed(2))
      : null;

  const tendencia7 = await query(
    `
      SELECT AVG(precio)::numeric(12,2) AS p, fecha
      FROM precios
      WHERE LOWER(cultivo)=LOWER($1) AND moneda='ARS' AND fecha >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY fecha
      ORDER BY fecha ASC
    `,
    [cultivo]
  );
  let tendencia = "estable";
  if (tendencia7.rows.length >= 2) {
    const first = Number(tendencia7.rows[0].p);
    const last = Number(tendencia7.rows[tendencia7.rows.length - 1].p);
    if (last > first) tendencia = "sube";
    if (last < first) tendencia = "baja";
  }
  return { variacionPct: pct, tendencia7d: tendencia };
};

const construirMensajeAlerta = async ({ alerta, valorActual, contexto }) => {
  const base = [
    "🚨 *Alerta AgroHabilis*",
    `La ${alerta.cultivo} llegó a ${valorActual}`,
    `Tu objetivo era ${alerta.valor_objetivo}`,
    "",
    "📊 *Contexto:*",
    `- Variación vs ayer: ${
      contexto.variacionPct === null
        ? "s/d"
        : `${contexto.variacionPct >= 0 ? "▲" : "▼"} ${Math.abs(contexto.variacionPct)}%`
    }`,
    `- Tendencia últimos 7 días: ${contexto.tendencia7d}`,
  ].join("\n");

  try {
    const ia = await generarConPromptLibre({
      system:
        "Sos asesor agro comercial. Das recomendación breve y concreta en español rioplatense.",
      user: `${base}\n\nDame una sección final '💡 Momento de decisión:' en 1-2 líneas.`,
    });
    return { texto: `${base}\n\n💡 *Momento de decisión:*\n${ia.texto}`, tokensUsados: ia.tokensUsados };
  } catch (_e) {
    return {
      texto: `${base}\n\n💡 *Momento de decisión:*\nEvaluá tomar cobertura parcial o fijar precio según tu flujo de caja.`,
      tokensUsados: null,
    };
  }
};

const verificarAlertas = async (opts = {}) => {
  const alertasResult = await query(
    `
      SELECT a.*, u.whatsapp, u.id AS usuario_id_real
      FROM alertas a
      JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.activa = true AND a.disparada = false AND u.activo = true
      ORDER BY a.id ASC
    `
  );

  let disparadas = 0;
  const mensajes = [];

  for (const alerta of alertasResult.rows) {
    let valorActual = null;
    if (alerta.tipo.startsWith("dolar")) {
      const tc = await obtenerDolarActual(alerta.cultivo || "blue");
      valorActual = Number(tc?.valor);
    } else {
      const p = await obtenerPrecioActual(alerta.cultivo);
      valorActual = Number(p?.precio);
    }
    if (!Number.isFinite(valorActual)) continue;

    const objetivo = Number(alerta.valor_objetivo);
    const cumple =
      (alerta.tipo.endsWith("sube") && valorActual >= objetivo) ||
      (alerta.tipo.endsWith("baja") && valorActual <= objetivo);
    if (!cumple) continue;

    const contexto = alerta.tipo.startsWith("dolar")
      ? { variacionPct: null, tendencia7d: "estable" }
      : await obtenerContextoPrecio(alerta.cultivo);
    const msg = await renderTemplate(
      "alerta",
      { id: alerta.usuario_id_real, nombre: null, whatsapp: alerta.whatsapp },
      { ...alerta, valor_actual: valorActual, contexto }
    );

    await query(
      `
        UPDATE alertas
        SET disparada = true, disparada_en = NOW()
        WHERE id = $1
      `,
      [alerta.id]
    );

    if (!opts.soloSimularEnvio) {
      try {
        const { sendMessage } = require("../config/whatsapp");
        await sendMessage(alerta.whatsapp, msg.mensaje);
      } catch (error) {
        console.error("[Alertas] No se pudo enviar WhatsApp:", error.message);
      }
    }

    await guardarConsulta({
      usuarioId: alerta.usuario_id_real,
      whatsapp: normalizarWhatsapp(alerta.whatsapp),
      pregunta: `Alerta disparada #${alerta.id}`,
      respuesta: msg.mensaje,
      tokensUsados: null,
    });

    disparadas += 1;
    mensajes.push({ alertaId: alerta.id, texto: msg.mensaje });
  }

  return { totalEvaluadas: alertasResult.rows.length, disparadas, mensajes };
};

module.exports = {
  configurarAlerta,
  listarAlertas,
  cancelarAlerta,
  verificarAlertas,
};
