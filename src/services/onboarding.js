const { query } = require("../config/database");
const {
  normalizarWhatsapp,
  buscarPorWhatsapp,
  crearUsuario,
  guardarCultivosUsuario,
} = require("../models/usuario");

const MENSAJE_BIENVENIDA = `Hola, soy AgroHabilis 🌾 Tu asistente agropecuario.
Para darte información personalizada necesito conocerte un poco.
¿Cuál es tu nombre?`;

const parseNumero = (texto) => {
  const n = Number(String(texto || "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
};

const parseCultivos = (texto) =>
  String(texto || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase());

const parseCategoriasGanaderas = (texto) =>
  String(texto || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

const detectarPerfilProductivo = (texto = "") => {
  const t = String(texto).trim().toLowerCase();
  if (["1", "agricultura", "agricola"].includes(t)) return "agricultura";
  if (["2", "ganaderia", "ganadería"].includes(t)) return "ganaderia";
  if (["3", "mixto"].includes(t)) return "mixto";
  return null;
};

const obtenerEstadoOnboarding = async (numeroWhatsapp) => {
  const whatsapp = normalizarWhatsapp(numeroWhatsapp);
  if (!whatsapp) return null;

  const result = await query(
    `
      SELECT id, whatsapp, paso_actual, datos_temporales, completado
      FROM onboarding_estado
      WHERE whatsapp = $1
      LIMIT 1
    `,
    [whatsapp]
  );
  return result.rows[0] || null;
};

const crearEstadoOnboarding = async (numeroWhatsapp) => {
  const whatsapp = normalizarWhatsapp(numeroWhatsapp);
  const result = await query(
    `
      INSERT INTO onboarding_estado (whatsapp, paso_actual, datos_temporales, completado)
      VALUES ($1, 1, '{}'::jsonb, false)
      ON CONFLICT (whatsapp) DO UPDATE SET
        paso_actual = 1,
        datos_temporales = '{}'::jsonb,
        completado = false,
        actualizado_en = NOW()
      RETURNING id, whatsapp, paso_actual, datos_temporales, completado
    `,
    [whatsapp]
  );
  return result.rows[0];
};

const actualizarEstadoOnboarding = async ({
  numeroWhatsapp,
  pasoActual,
  datosTemporales,
  completado,
}) => {
  const whatsapp = normalizarWhatsapp(numeroWhatsapp);
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
    [whatsapp, pasoActual, JSON.stringify(datosTemporales || {}), completado]
  );
};

const iniciarOnboarding = async (numeroWhatsapp) => {
  await crearEstadoOnboarding(numeroWhatsapp);
  return MENSAJE_BIENVENIDA;
};

const finalizarOnboarding = async ({ numeroWhatsapp, datos }) => {
  const usuario = await crearUsuario({
    nombre: datos.nombre,
    whatsapp: normalizarWhatsapp(numeroWhatsapp),
    provincia: datos.provincia,
    partido: datos.partido,
  });

  await guardarCultivosUsuario({
    usuarioId: usuario.id,
    cultivos: datos.cultivos || [],
    hectareas: datos.hectareas,
    costoPorHa: datos.costo_por_ha,
  });

  await query(
    `
      INSERT INTO perfil_productivo (usuario_id, tipo, activo)
      VALUES ($1, $2, true)
    `,
    [usuario.id, datos.perfil_productivo || "agricultura"]
  );

  if (["ganaderia", "mixto"].includes(datos.perfil_productivo)) {
    const categorias = Array.isArray(datos.categorias_ganaderas)
      ? datos.categorias_ganaderas
      : [];
    const total = Number(datos.stock_total || 0);
    const porCategoria =
      categorias.length > 0
        ? Math.max(1, Math.floor(total / categorias.length))
        : total > 0
        ? total
        : 0;
    const usadas = categorias.length ? categorias : ["vacas"];
    for (const categoria of usadas) {
      await query(
        `
          INSERT INTO stock_ganadero (usuario_id, categoria, cantidad, fecha)
          VALUES ($1, $2, $3, CURRENT_DATE)
        `,
        [usuario.id, categoria, porCategoria]
      );
    }
  }

  await actualizarEstadoOnboarding({
    numeroWhatsapp,
    pasoActual: 10,
    datosTemporales: datos,
    completado: true,
  });

  const perfilTxt = datos.perfil_productivo || "agricultura";
  const cultivosTxt = (datos.cultivos || []).join(", ") || "sin cultivos";
  const stockTxt =
    ["ganaderia", "mixto"].includes(perfilTxt)
      ? `\n- Stock ganadero aprox: ${datos.stock_total || 0}\n- Categorías: ${(datos.categorias_ganaderas || []).join(", ") || "sin detalle"}`
      : "";

  return `¡Excelente, ${usuario.nombre}! Ya tengo tu perfil:
- Provincia: ${datos.provincia}
- Partido/Depto: ${datos.partido}
- Perfil productivo: ${perfilTxt}
- Cultivos: ${cultivosTxt}
- Hectáreas aprox: ${datos.hectareas ?? 0}
- Costo por ha (USD): ${datos.costo_por_ha ?? 0}${stockTxt}

Ya podés hacer consultas como:
- "¿Cuánto está la soja hoy?"
- "¿Cómo está el dólar?"
- "¿Qué pasa con el clima esta semana?"`;
};

const procesarPasoOnboarding = async (numeroWhatsapp, mensaje) => {
  const texto = String(mensaje || "").trim();
  if (!texto) {
    return "Necesito ese dato para continuar. Escribime tu respuesta.";
  }

  const estado = (await obtenerEstadoOnboarding(numeroWhatsapp)) ||
    (await crearEstadoOnboarding(numeroWhatsapp));
  const datos = estado.datos_temporales || {};

  if (estado.paso_actual === 1) {
    datos.nombre = texto;
    await actualizarEstadoOnboarding({
      numeroWhatsapp,
      pasoActual: 2,
      datosTemporales: datos,
      completado: false,
    });
    return `Hola ${datos.nombre}! ¿En qué provincia trabajás? (ej: Buenos Aires, Córdoba, Santa Fe)`;
  }

  if (estado.paso_actual === 2) {
    datos.provincia = texto;
    await actualizarEstadoOnboarding({
      numeroWhatsapp,
      pasoActual: 3,
      datosTemporales: datos,
      completado: false,
    });
    return "¿Y en qué partido o departamento?";
  }

  if (estado.paso_actual === 3) {
    datos.partido = texto;
    await actualizarEstadoOnboarding({
      numeroWhatsapp,
      pasoActual: 4,
      datosTemporales: datos,
      completado: false,
    });
    return "¿Qué cultivos trabajás? Escribilos separados por coma (ej: soja, maíz, trigo)";
  }

  if (estado.paso_actual === 4) {
    const cultivos = parseCultivos(texto);
    if (!cultivos.length && texto.toLowerCase() !== "ninguno") {
      return "No pude leer tus cultivos. Escribilos separados por coma (ej: soja, maíz, trigo)";
    }
    datos.cultivos = cultivos.length ? cultivos : [];
    await actualizarEstadoOnboarding({
      numeroWhatsapp,
      pasoActual: 5,
      datosTemporales: datos,
      completado: false,
    });
    return "¿Cuántas hectáreas aproximadamente?";
  }

  if (estado.paso_actual === 5) {
    const hectareas = parseNumero(texto);
    if (hectareas === null || hectareas < 0) {
      return "No entendí la cantidad de hectáreas. Escribí un número (ej: 120 o 120.5).";
    }
    datos.hectareas = hectareas;
    await actualizarEstadoOnboarding({
      numeroWhatsapp,
      pasoActual: 6,
      datosTemporales: datos,
      completado: false,
    });
    return "¿Sabés el costo aproximado por hectárea en USD? (podés escribir 0 si no lo sabés)";
  }

  if (estado.paso_actual === 6) {
    const costo = parseNumero(texto);
    if (costo === null || costo < 0) {
      return "No entendí el costo por hectárea. Escribí un número en USD (ej: 450 o 0 si no lo sabés).";
    }
    datos.costo_por_ha = costo;
    await actualizarEstadoOnboarding({
      numeroWhatsapp,
      pasoActual: 7,
      datosTemporales: datos,
      completado: false,
    });
    return `¿Qué tipo de producción tenés?
1️⃣ Agricultura (granos)
2️⃣ Ganadería
3️⃣ Mixto (los dos)`;
  }

  if (estado.paso_actual === 7) {
    const perfil = detectarPerfilProductivo(texto);
    if (!perfil) {
      return "No entendí el perfil. Respondé con 1 (agricultura), 2 (ganadería) o 3 (mixto).";
    }
    datos.perfil_productivo = perfil;
    if (perfil === "agricultura") {
      return finalizarOnboarding({ numeroWhatsapp, datos });
    }
    await actualizarEstadoOnboarding({
      numeroWhatsapp,
      pasoActual: 8,
      datosTemporales: datos,
      completado: false,
    });
    return "¿Cuántas cabezas de ganado tenés aproximadamente?";
  }

  if (estado.paso_actual === 8) {
    const cabezas = parseNumero(texto);
    if (cabezas === null || cabezas < 0) {
      return "No entendí la cantidad de cabezas. Escribí un número (ej: 120).";
    }
    datos.stock_total = Math.round(cabezas);
    await actualizarEstadoOnboarding({
      numeroWhatsapp,
      pasoActual: 9,
      datosTemporales: datos,
      completado: false,
    });
    return "¿Qué categorías manejás? (ej: vacas, terneros, novillos)";
  }

  if (estado.paso_actual === 9) {
    const categorias = parseCategoriasGanaderas(texto);
    if (!categorias.length) {
      return "No entendí las categorías. Escribilas separadas por coma (ej: vacas, terneros).";
    }
    datos.categorias_ganaderas = categorias;
    return finalizarOnboarding({ numeroWhatsapp, datos });
  }

  return "Tu onboarding ya está completo. Ya podés hacer consultas del mercado y clima.";
};

const gestionarOnboarding = async (numeroWhatsapp, mensaje) => {
  const usuario = await buscarPorWhatsapp(numeroWhatsapp);
  const estado = await obtenerEstadoOnboarding(numeroWhatsapp);

  if (usuario && (!estado || estado.completado)) {
    return { enOnboarding: false, respuesta: null };
  }

  if (!estado) {
    const respuesta = await iniciarOnboarding(numeroWhatsapp);
    return { enOnboarding: true, respuesta };
  }

  if (estado.completado && usuario) {
    return { enOnboarding: false, respuesta: null };
  }

  const respuesta = await procesarPasoOnboarding(numeroWhatsapp, mensaje);
  return { enOnboarding: true, respuesta };
};

module.exports = {
  gestionarOnboarding,
  obtenerEstadoOnboarding,
};
