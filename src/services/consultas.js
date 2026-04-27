const axios = require("axios");
const { query } = require("../config/database");
const { generarRespuestaConsulta } = require("./gemini");
const { guardarConsulta } = require("../models/consulta");
const { parseCultivo } = require("./analisis_venta");
const { guiarCalculoCosto } = require("./calculadora_costos");
const {
  normalizarWhatsapp,
  buscarPorWhatsapp,
  actualizarUsuario,
  obtenerPerfil,
} = require("../models/usuario");
const { renderTemplate } = require("../templates");

const obtenerUltimosPreciosPorCultivos = async (cultivos = []) => {
  const fechaResult = await query("SELECT MAX(fecha) AS fecha FROM precios");
  const fecha = fechaResult.rows[0]?.fecha;
  if (!fecha) return { fecha: null, items: [] };

  const cultivosLimpios = cultivos
    .map((c) => String(c || "").trim())
    .filter(Boolean);

  let preciosResult;
  if (cultivosLimpios.length) {
    preciosResult = await query(
      `
        SELECT cultivo, mercado, precio, moneda, fecha
        FROM precios
        WHERE fecha = $1
          AND LOWER(cultivo) = ANY($2::text[])
        ORDER BY cultivo, mercado
      `,
      [fecha, cultivosLimpios.map((x) => x.toLowerCase())]
    );
  } else {
    preciosResult = await query(
      `
        SELECT cultivo, mercado, precio, moneda, fecha
        FROM precios
        WHERE fecha = $1
        ORDER BY cultivo, mercado
      `,
      [fecha]
    );
  }

  return { fecha, items: preciosResult.rows };
};

const obtenerUltimoTipoCambio = async () => {
  const fechaResult = await query("SELECT MAX(fecha) AS fecha FROM tipo_cambio");
  const fecha = fechaResult.rows[0]?.fecha;
  if (!fecha) return { fecha: null, items: [] };

  const tcResult = await query(
    `
      SELECT tipo, valor, fecha
      FROM tipo_cambio
      WHERE fecha = $1
      ORDER BY tipo
    `,
    [fecha]
  );

  return { fecha, items: tcResult.rows };
};

const obtenerPromedio30DiasCultivo = async (cultivo) => {
  const result = await query(
    `
      SELECT AVG(precio)::numeric(12,2) AS promedio
      FROM precios
      WHERE LOWER(cultivo) = LOWER($1)
        AND moneda = 'ARS'
        AND fecha >= CURRENT_DATE - INTERVAL '30 days'
    `,
    [cultivo]
  );
  const v = Number(result.rows[0]?.promedio);
  return Number.isFinite(v) ? v : null;
};

const obtenerTendencia7DiasCultivo = async (cultivo) => {
  const result = await query(
    `
      SELECT AVG(precio)::numeric(12,2) AS p, fecha
      FROM precios
      WHERE LOWER(cultivo)=LOWER($1)
        AND moneda='ARS'
        AND fecha >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY fecha
      ORDER BY fecha ASC
    `,
    [cultivo]
  );
  if (result.rows.length < 2) return "estable";
  const first = Number(result.rows[0].p);
  const last = Number(result.rows[result.rows.length - 1].p);
  if (last > first) return "sube";
  if (last < first) return "baja";
  return "estable";
};

const obtenerAlertasActivasUsuario = async (usuarioId) => {
  if (!usuarioId) return [];
  const result = await query(
    `
      SELECT id, cultivo, tipo, valor_objetivo
      FROM alertas
      WHERE usuario_id = $1 AND activa = true
      ORDER BY id DESC
      LIMIT 10
    `,
    [usuarioId]
  );
  return result.rows;
};

const obtenerFuturosParaCultivos = async (cultivos = []) => {
  if (!cultivos.length) return [];
  const cultivosNorm = cultivos.map((c) => String(c || "").toLowerCase());
  const result = await query(
    `
      SELECT fp.cultivo, fp.posicion, fp.precio_usd, fp.variacion, fp.volumen, fp.fecha
      FROM futuros_posiciones fp
      JOIN (
        SELECT cultivo, MAX(fecha) AS fecha
        FROM futuros_posiciones
        WHERE LOWER(cultivo) = ANY($1::text[])
        GROUP BY cultivo
      ) ult
        ON LOWER(fp.cultivo) = LOWER(ult.cultivo) AND fp.fecha = ult.fecha
      WHERE LOWER(fp.cultivo) = ANY($1::text[])
      ORDER BY fp.cultivo, fp.posicion
    `,
    [cultivosNorm]
  );
  return result.rows;
};

const geocodificarZona = async ({ partido, provincia }) => {
  if (!partido || !provincia) return null;
  const q = `${partido}, ${provincia}, Argentina`;
  const response = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: {
      q,
      format: "json",
      limit: 1,
    },
    timeout: 30_000,
    headers: {
      "User-Agent": "AgroHabilis/1.0 (soporte@agrohabilis.com)",
    },
    validateStatus: (s) => s === 200,
  });
  const row = Array.isArray(response.data) ? response.data[0] : null;
  if (!row) return null;

  const lat = Number(row.lat);
  const lng = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const completarGeolocalizacionSiFalta = async (perfil) => {
  if (!perfil) return perfil;
  if (perfil.lat !== null && perfil.lng !== null) return perfil;

  try {
    const geo = await geocodificarZona({
      partido: perfil.partido,
      provincia: perfil.provincia,
    });
    if (!geo) return perfil;
    const actualizado = await actualizarUsuario(perfil.id, geo);
    return { ...perfil, lat: actualizado?.lat ?? geo.lat, lng: actualizado?.lng ?? geo.lng };
  } catch (error) {
    console.warn("[Consultas] No se pudo geocodificar zona:", error.message);
    return perfil;
  }
};

const obtenerClimaZona = async ({ lat, lng }) => {
  if (lat === null || lng === null || lat === undefined || lng === undefined) {
    return [];
  }
  const result = await query(
    `
      SELECT fecha, temp_min, temp_max, precipitacion, helada, descripcion
      FROM clima
      WHERE lat = $1 AND lng = $2
      ORDER BY fecha DESC
      LIMIT 7
    `,
    [lat, lng]
  );
  return result.rows.reverse();
};

const normalizarTextoComando = (texto = "") =>
  String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

const normMin = (texto = "") =>
  String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const CULTIVOS_ALIAS = [
  { key: "soja", patrones: ["soja"] },
  { key: "maiz", patrones: ["maiz"] },
  { key: "trigo", patrones: ["trigo"] },
  { key: "girasol", patrones: ["girasol"] },
  { key: "sorgo", patrones: ["sorgo"] },
  { key: "cebada", patrones: ["cebada"] },
  { key: "papa", patrones: ["papa", "patata"] },
];

const detectarCultivoEnTexto = (texto = "") => {
  const t = normMin(texto);
  for (const item of CULTIVOS_ALIAS) {
    if (item.patrones.some((p) => t.includes(p))) return item.key;
  }
  return null;
};

const esAfirmacionBreve = (texto = "") => {
  const t = normMin(texto);
  return ["si", "sí", "dale", "ok", "oka", "de acuerdo", "perfecto"].includes(t);
};

const obtenerUltimaInteraccion = async ({ usuarioId, whatsapp }) => {
  if (usuarioId) {
    const r = await query(
      `
        SELECT pregunta, respuesta, creado_en
        FROM historial_consultas
        WHERE usuario_id = $1
        ORDER BY creado_en DESC
        LIMIT 1
      `,
      [usuarioId]
    );
    if (r.rows[0]) return r.rows[0];
  }
  if (whatsapp) {
    const r = await query(
      `
        SELECT pregunta, respuesta, creado_en
        FROM historial_consultas
        WHERE whatsapp = $1
        ORDER BY creado_en DESC
        LIMIT 1
      `,
      [normalizarWhatsapp(whatsapp)]
    );
    return r.rows[0] || null;
  }
  return null;
};

const responderDatosCultivo = async (cultivo) => {
  const r = await query(
    `
      SELECT fecha, mercado, precio, moneda
      FROM precios
      WHERE LOWER(cultivo) = LOWER($1)
        AND fecha = (SELECT MAX(fecha) FROM precios WHERE LOWER(cultivo) = LOWER($1))
      ORDER BY mercado
      LIMIT 6
    `,
    [cultivo]
  );
  if (!r.rows.length) {
    return `Hoy no tengo datos de ${cultivo} en la base.\nSi querés, te aviso cuando se actualice o lo agregamos a tu seguimiento con COMPLETAR PERFIL.`;
  }
  const fecha = String(r.rows[0].fecha || "").slice(0, 10);
  const lineas = r.rows
    .map(
      (x) => `- ${x.mercado}: ${formatearMoneda(x.precio, x.moneda || "ARS")} (${x.moneda || "ARS"})`
    )
    .join("\n");
  return `Datos de *${cultivo}* (${fecha}):\n${lineas}`;
};

const parseComandoBot = (texto = "") => {
  const cmd = normalizarTextoComando(texto);
  if (cmd === "PAUSAR BOT") return "PAUSAR_BOT";
  if (cmd === "ACTIVAR BOT") return "ACTIVAR_BOT";
  if (cmd === "ESTADO BOT") return "ESTADO_BOT";
  return null;
};

const MARCO_REFERENCIA_HACIENDA = {
  fuente_principal:
    "https://www.mercadoagroganadero.com.ar/dll/preguntas-frecuentes.html",
  indicadores: {
    inmag: {
      descripcion: "Indice Novillo Mercado Agroganadero",
      metodo: "promedio_ponderado_por_peso",
      formula: "SUM(peso_lote * precio_lote) / SUM(peso_lote)",
      reglas_inclusion: [
        "novillos mestizos con peso superior al umbral vigente",
        "novillos overo negro (cualquier peso)",
        "novillos cruza cebu (cualquier peso)",
        "novillos cruza europea (cualquier peso)",
        "novillos conserva (cualquier peso)",
      ],
      cambio_metodologico: {
        referencia: "ONCCA 5701/2005",
        desde_aprox: "2005-12-09",
        nota: "para mestizos se usa umbral de peso superior a 430 kg",
      },
    },
    inmag_sugerido_arrendamientos_rofex: {
      descripcion:
        "serie sugerida para continuidad historica del esquema previo",
      objetivo:
        "evitar quiebres al comparar periodos con distinta metodologia",
    },
    igmag: {
      descripcion: "Indice General Mercado Agroganadero",
      metodo: "promedio general diario de operaciones en pie",
    },
  },
  pautas_ia: [
    "aclarar que INMAG es ponderado por peso y no promedio simple",
    "mencionar fecha y metodologia utilizada",
    "si faltan datos o hay mezcla de series, advertir explicitamente",
  ],
};

const obtenerEstadoBot = async (numeroWhatsapp) => {
  const whatsapp = normalizarWhatsapp(numeroWhatsapp);
  if (!whatsapp) return true;

  const result = await query(
    `
      SELECT bot_activo
      FROM whatsapp_bot_control
      WHERE whatsapp = $1
      LIMIT 1
    `,
    [whatsapp]
  );
  if (!result.rows[0]) return true;
  return Boolean(result.rows[0].bot_activo);
};

const setEstadoBot = async (numeroWhatsapp, botActivo) => {
  const whatsapp = normalizarWhatsapp(numeroWhatsapp);
  if (!whatsapp) {
    throw new Error("Numero invalido para controlar estado del bot");
  }

  await query(
    `
      INSERT INTO whatsapp_bot_control (whatsapp, bot_activo)
      VALUES ($1, $2)
      ON CONFLICT (whatsapp)
      DO UPDATE SET
        bot_activo = EXCLUDED.bot_activo,
        actualizado_en = NOW()
    `,
    [whatsapp, botActivo]
  );
};

const manejarComandoBot = async (numeroWhatsapp, texto) => {
  const comando = parseComandoBot(texto);
  if (!comando) return null;

  if (comando === "PAUSAR_BOT") {
    await setEstadoBot(numeroWhatsapp, false);
    return "Listo, desactive el bot para este chat. Para volver a activarlo escribi: ACTIVAR BOT";
  }

  if (comando === "ACTIVAR_BOT") {
    await setEstadoBot(numeroWhatsapp, true);
    return "Perfecto, el bot quedo activado para este chat.";
  }

  const activo = await obtenerEstadoBot(numeroWhatsapp);
  return activo
    ? "Estado del bot: ACTIVO en este chat."
    : "Estado del bot: PAUSADO en este chat.";
};

const armarContextoDatos = ({
  usuario,
  precios,
  tipoCambio,
  cultivos,
  clima,
  futuros,
  analyticsConsulta = null,
}) => {
  return JSON.stringify(
    {
      unidades_y_significado: {
        precios_ars:
          "Cada fila con moneda ARS es precio de granos por TONELADA (pizarra/plaza local, ej. AFA o CAC), no por kilo ni por hectárea.",
        precios_usd:
          "Cada fila con moneda USD es referencia FOB/exportación u homóloga en dólares por TONELADA (ej. MAGYP FOB oficial), salvo que el campo mercado indique otra convención.",
        tipo_cambio:
          "tipo_cambio.valor es ARS por 1 USD según la categoría (oficial, blue, bolsa, ccl); corresponde a la cotización del día indicado.",
      },
      usuario: usuario
        ? {
            id: usuario.id,
            nombre: usuario.nombre,
            whatsapp: usuario.whatsapp,
            provincia: usuario.provincia,
            partido: usuario.partido,
            lat: usuario.lat,
            lng: usuario.lng,
            plan: usuario.plan,
            activo: usuario.activo,
          }
        : null,
      precios: {
        fecha: precios.fecha,
        items: precios.items,
      },
      tipo_cambio: {
        fecha: tipoCambio.fecha,
        items: tipoCambio.items,
      },
      fuentes_contexto: {
        precios: {
          origen: "base_interna_agrohabilis_tabla_precios",
          fecha: precios.fecha,
        },
        tipo_cambio: {
          origen: "base_interna_agrohabilis_tabla_tipo_cambio",
          fecha: tipoCambio.fecha,
        },
        clima: {
          origen: "base_interna_agrohabilis_tabla_clima",
          fecha_referencia: (clima || []).length ? clima[clima.length - 1]?.fecha : null,
        },
        futuros_matba: {
          origen: "base_interna_agrohabilis_tabla_futuros_posiciones",
          fecha_referencia: (futuros || []).length ? futuros[0]?.fecha : null,
        },
      },
      cultivos_usuario: cultivos,
      futuros_matba: futuros,
      clima_zona_usuario: clima,
      analitica_consulta: analyticsConsulta,
      marco_referencia_hacienda: MARCO_REFERENCIA_HACIENDA,
    },
    null,
    2
  );
};

const formatearMoneda = (valor, moneda = "ARS") => {
  const n = Number(valor);
  if (!Number.isFinite(n)) return "s/d";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: moneda,
    maximumFractionDigits: moneda === "USD" ? 2 : 0,
  }).format(n);
};

const construirRespuestaFallback = ({ usuario, precios, tipoCambio, clima }) => {
  const nombre = usuario?.nombre || "productor";
  const fechaPrecios = precios?.fecha ? String(precios.fecha).slice(0, 10) : "s/d";
  const fechaTc = tipoCambio?.fecha ? String(tipoCambio.fecha).slice(0, 10) : "s/d";

  const preciosTxt = (precios?.items || [])
    .slice(0, 6)
    .map((p) => `- ${p.cultivo} (${p.mercado}): ${formatearMoneda(p.precio, p.moneda)}`)
    .join("\n");

  const tcTxt = (tipoCambio?.items || [])
    .slice(0, 4)
    .map((t) => `- ${t.tipo}: ${formatearMoneda(t.valor, "ARS")}`)
    .join("\n");

  const climaTxt = (clima || [])
    .slice(0, 3)
    .map(
      (c) =>
        `- ${String(c.fecha).slice(0, 10)}: ${c.descripcion || "s/d"} (${c.temp_min}°/${c.temp_max}°)`
    )
    .join("\n");

  return [
    `No pude consultar la IA ahora, ${nombre}, pero te paso los datos disponibles.`,
    "",
    `Precios (${fechaPrecios}):`,
    preciosTxt || "- Sin datos de precios.",
    "",
    `Tipo de cambio (${fechaTc}):`,
    tcTxt || "- Sin datos de tipo de cambio.",
    "",
    "Clima próximos días:",
    climaTxt || "- Sin datos de clima para tu zona.",
    "",
    "Si querés, reintentá tu consulta en unos minutos.",
  ].join("\n");
};

const completarPerfilDesdeConsulta = async (usuario, contexto = {}) => {
  if (!usuario?.id) return "";

  const preguntaNorm = normalizarTextoComando(contexto.pregunta || "").toLowerCase();
  const cultivos = Array.isArray(usuario.cultivos) ? usuario.cultivos : [];
  const costoFaltante = cultivos.length > 0 && cultivos.every((c) => c.costo_por_ha == null);

  const consultaMargen =
    preguntaNorm.includes("margen") ||
    preguntaNorm.includes("rentabilidad") ||
    preguntaNorm.includes("conviene vender") ||
    (preguntaNorm.includes("conviene") && preguntaNorm.includes("vender"));
  if (consultaMargen && costoFaltante) {
    return "💡 Para darte el margen exacto necesito tu costo por hectárea. ¿Lo sabés? Respondé con un número en USD.";
  }

  const consultaHacienda =
    preguntaNorm.includes("hacienda") ||
    preguntaNorm.includes("ganad") ||
    preguntaNorm.includes("novillo") ||
    preguntaNorm.includes("ternero");
  if (consultaHacienda) {
    const stock = await query(
      `
        SELECT 1
        FROM stock_ganadero
        WHERE usuario_id = $1
        LIMIT 1
      `,
      [usuario.id]
    );
    if (!stock.rows[0]) {
      return "💡 ¿Tenés hacienda propia? Si me decís cuántas cabezas tenés puedo darte un análisis más completo.";
    }
  }

  return "";
};

const detectarCultivoConsulta = (texto = "", cultivos = []) => {
  const detectado = detectarCultivoEnTexto(texto);
  if (detectado) return detectado;
  if (cultivos.length === 1) return parseCultivo(cultivos[0]?.cultivo || "");
  return null;
};

const esConsultaVenta = (texto = "") => {
  const t = normalizarTextoComando(texto).toLowerCase();
  if (t.startsWith("analizar ")) return true;
  return [
    "vendo",
    "vender",
    "conviene",
    "espero",
    "precio",
    "margen",
    "ganancia",
    "resultado",
  ].some((k) => t.includes(k));
};

const procesarConsulta = async (numeroWhatsapp, pregunta) => {
  const textoPregunta = String(pregunta || "").trim();
  if (!textoPregunta) {
    return "No recibí la consulta. Escribime tu pregunta y te respondo con datos actualizados.";
  }

  const perfilInicial = await obtenerPerfil(numeroWhatsapp);
  const usuario = await completarGeolocalizacionSiFalta(perfilInicial);
  const cultivos = usuario?.cultivos || [];
  const cultivoDetectado = detectarCultivoConsulta(textoPregunta, cultivos);

  if (esAfirmacionBreve(textoPregunta)) {
    const ultima = await obtenerUltimaInteraccion({
      usuarioId: usuario?.id || null,
      whatsapp: numeroWhatsapp,
    });
    const cultivoPrevio = detectarCultivoConsulta(ultima?.pregunta || "", cultivos);
    if (cultivoPrevio) {
      return responderDatosCultivo(cultivoPrevio);
    }
    const cultivosPerfil = cultivos.map((c) => c.cultivo).filter(Boolean);
    const sugeridos = cultivosPerfil.length
      ? cultivosPerfil.slice(0, 3).join(", ")
      : "soja, maíz, trigo";
    return `Perfecto. Decime puntualmente qué querés ver y te respondo con datos:\n- "Precio de ${sugeridos.split(",")[0]} hoy"\n- "¿Me conviene vender ${sugeridos.split(",")[0]} esta semana?"\n- "Clima de mi zona 7 días"`;
  }

  const consultaDatosCultivo =
    ["datos", "precio", "cotizacion", "cotización", "valor", "mercado"].some((k) =>
      normMin(textoPregunta).includes(k)
    ) && Boolean(cultivoDetectado);
  if (consultaDatosCultivo) {
    return responderDatosCultivo(cultivoDetectado);
  }

  const flujoCosto = await guiarCalculoCosto(numeroWhatsapp, textoPregunta);
  if (flujoCosto?.enFlujo) {
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: flujoCosto.respuesta,
      tokensUsados: null,
    });
    return flujoCosto.respuesta;
  }

  if (usuario?.id && esConsultaVenta(textoPregunta)) {
    const cultivoAnalisis = detectarCultivoConsulta(textoPregunta, cultivos);
    if (!cultivoAnalisis) {
      return "Para analizar venta necesito el cultivo. Probá: ANALIZAR SOJA, ANALIZAR MAIZ o ANALIZAR TRIGO.";
    }
    const cultivoPerfil = cultivos.find(
      (c) => parseCultivo(c.cultivo) === parseCultivo(cultivoAnalisis)
    );
    if (!cultivoPerfil) {
      const actuales = cultivos.map((c) => c.cultivo).filter(Boolean);
      const actualesTxt = actuales.length ? ` Hoy tengo cargado: ${actuales.join(", ")}.` : "";
      return `No tengo ${cultivoAnalisis} en tu perfil.${actualesTxt} Si querés lo agregamos con COMPLETAR PERFIL.`;
    }
    if (!Number.isFinite(Number(cultivoPerfil.hectareas)) || Number(cultivoPerfil.hectareas) <= 0) {
      return `Para analizar ${cultivoAnalisis} necesito tus hectáreas. Respondeme: "${cultivoAnalisis} <hectareas> ha".`;
    }
    const analisisTpl = await renderTemplate("analisis_venta", usuario, cultivoAnalisis);
    const analisis = analisisTpl.mensaje;
    await guardarConsulta({
      usuarioId: usuario.id,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: analisis,
      tokensUsados: null,
    });
    return analisis;
  }

  let texto;
  let tokensUsados = null;
  try {
    const out = await renderTemplate("consulta", usuario, textoPregunta);
    texto = out.mensaje;
  } catch (error) {
    console.error("[Consultas] Falló template consulta, usando fallback:", error.message);
    const precios = await obtenerUltimosPreciosPorCultivos(cultivos.map((c) => c.cultivo));
    const tipoCambio = await obtenerUltimoTipoCambio();
    const clima = usuario ? await obtenerClimaZona(usuario) : [];
    texto = construirRespuestaFallback({ usuario, precios, tipoCambio, clima });
  }

  const preguntaSuave = await completarPerfilDesdeConsulta(usuario, {
    pregunta: textoPregunta,
  });
  if (preguntaSuave) {
    texto = `${texto}\n\n${preguntaSuave}`;
  }

  await guardarConsulta({
    usuarioId: usuario?.id || null,
    whatsapp: normalizarWhatsapp(numeroWhatsapp),
    pregunta: textoPregunta,
    respuesta: texto,
    tokensUsados,
  });

  return texto;
};

module.exports = {
  manejarComandoBot,
  obtenerEstadoBot,
  procesarConsulta,
};
