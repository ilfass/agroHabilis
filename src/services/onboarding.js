const axios = require("axios");
const { query } = require("../config/database");
const {
  normalizarWhatsapp,
  buscarPorWhatsapp,
  crearUsuario,
  guardarCultivosUsuario,
  actualizarUsuario,
  obtenerPerfil,
  destinoWhatsappParaEnvio,
} = require("../models/usuario");
const { renderTemplate } = require("../templates");
const { resolverPlanEfectivo, PLAN_PRICES_CACHE } = require("./planes");

const obtenerMensajeBienvenida = () => {
  const pBasico = `$${Number(PLAN_PRICES_CACHE.basico || 22000).toLocaleString("es-AR")}`;
  const pPro = `$${Number(PLAN_PRICES_CACHE.pro || 29000).toLocaleString("es-AR")}`;
  const pProMax = `$${Number(PLAN_PRICES_CACHE.pro_max || 50000).toLocaleString("es-AR")}`;
  return `Hola! Soy AgroHabilis 🌾, tu asistente agropecuario.
Arrancás en Plan GRATIS y podés cambiarlo cuando quieras:
- GRATIS: $0/mes
- BASICO: ${pBasico}/mes (QUIERO PLAN BASICO)
- PRO: ${pPro}/mes (QUIERO PLAN PRO)
- PRO MAX: ${pProMax}/mes (QUIERO PLAN PRO MAX)

Para empezar solo necesito tres datos rápidos.
¿Cuál es tu nombre y apellido?`;
};

const MENSAJE_PASO_2 =
  "¿En qué provincia y partido trabajás?\n" +
  "Separá zonas con guion (-).\n" +
  "Límite por plan: Gratis 1 zona, Básico 3 zonas, Pro 6 zonas.\n" +
  "Formato: Provincia, Partido - Provincia, Partido\n" +
  "Ej: Buenos Aires, Tandil - Córdoba, Río Cuarto";
const MENSAJE_PASO_3 =
  "¿Qué trabajás principalmente?\n" +
  "Podés elegir más de una opción: cultivos y/o ganadería.\n" +
  "Ejemplos:\n" +
  "- soja, maíz, trigo\n" +
  "- ganadería\n" +
  "- soja, maíz y ganadería";
const MENSAJE_PASO_4_GANADERIA =
  "Perfecto. Para personalizar mejor ganadería, decime tipo/categorías de ganado separadas por coma.\n" +
  "Ejemplos:\n" +
  "- vacuno novillos, vacuno terneros\n" +
  "- porcino madres, ovino ovejas\n" +
  "- llama, alpaca";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizarTexto = (texto = "") =>
  String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const parseNumero = (texto) => {
  const n = Number(String(texto || "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
};

const normalizarCultivo = (txt = "") => {
  const t = normalizarTexto(txt);
  if (!t) return null;
  // Variedades de papa deben agruparse bajo "Papa" y no crear cultivo separado.
  if (/(spunta|kennebec|innovator|santana|russet|atlantic|shepody)/.test(t)) return "Papa";
  if (t.includes("soja")) return "Soja";
  if (t.includes("maiz")) return "Maiz";
  if (t.includes("trigo")) return "Trigo";
  if (t.includes("girasol")) return "Girasol";
  if (t.includes("sorgo")) return "Sorgo";
  if (t.includes("cebada")) return "Cebada";
  if (t.includes("papa") || t.includes("patata")) return "Papa";
  return txt
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
};

const parseCultivos = (texto) => {
  const crudo = String(texto || "")
    .replace(/\s+y\s+/gi, ",")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const item of crudo) {
    const norm = normalizarCultivo(item);
    if (!norm) continue;
    const key = normalizarTexto(norm);
    if (key.includes("ganader")) continue;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(norm);
    }
  }
  return out;
};

const parseCategoriasGanaderas = (texto) =>
  String(texto || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

const ESPECIES_GANADERAS = [
  { especie: "vacuno", keys: ["vacuno", "bovino", "novillo", "ternero", "vaca", "vaquillona", "toro"] },
  { especie: "porcino", keys: ["porcino", "cerdo", "lechon", "lechón", "chancho"] },
  { especie: "ovino", keys: ["ovino", "oveja", "cordero", "carnero"] },
  { especie: "caprino", keys: ["caprino", "cabra", "chivo"] },
  { especie: "camelido", keys: ["llama", "alpaca", "guanaco", "vicuña", "vicuna", "camelido"] },
  { especie: "equino", keys: ["equino", "caballo", "yegua"] },
  { especie: "avicola", keys: ["avicola", "avícola", "pollo", "gallina", "ponedora"] },
];

const inferirEspecieGanadera = (categoria = "") => {
  const t = normalizarTexto(categoria);
  const hit = ESPECIES_GANADERAS.find((e) => e.keys.some((k) => t.includes(normalizarTexto(k))));
  return hit?.especie || "otra";
};

const parseGanaderiaEstructurada = (texto = "") => {
  const categorias = parseCategoriasGanaderas(texto);
  const perfiles = categorias.map((c) => ({
    especie: inferirEspecieGanadera(c),
    categoria: c.slice(0, 60),
  }));
  return { categorias, perfiles };
};

const guardarPerfilGanaderoUsuario = async ({ usuarioId, perfiles = [], cantidadTotal = 0 }) => {
  await query("DELETE FROM usuario_ganaderia_perfil WHERE usuario_id = $1", [usuarioId]);
  if (!perfiles.length) return;
  const porCategoria = perfiles.length ? Math.max(1, Math.floor(Number(cantidadTotal || 0) / perfiles.length)) : null;
  for (const p of perfiles) {
    await query(
      `
        INSERT INTO usuario_ganaderia_perfil (usuario_id, especie, categoria, cantidad_estimada, activo)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (usuario_id, especie, categoria)
        DO UPDATE SET cantidad_estimada = EXCLUDED.cantidad_estimada, activo = true
      `,
      [usuarioId, p.especie, p.categoria, porCategoria]
    );
  }
};

const parseProvinciaPartido = (texto = "") => {
  const parts = String(texto)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return { provincia: parts[0], partido: parts.slice(1).join(", ") };
};

const parseZonasProvinciaPartido = (texto = "") => {
  const bloques = String(texto)
    .split(/\s+-\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 5);
  const zonas = [];
  for (const b of bloques) {
    const z = parseProvinciaPartido(b);
    if (!z) continue;
    zonas.push(z);
  }
  return zonas;
};

const geocodificarZona = async ({ partido, provincia }) => {
  if (!partido || !provincia) return { lat: null, lng: null, error: true };
  try {
    const response = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q: `${partido}, ${provincia}, Argentina`,
        format: "json",
        limit: 1,
      },
      timeout: 15000,
      headers: {
        "User-Agent": "AgroHabilis/1.0 (soporte@agrohabilis.com)",
      },
      validateStatus: (s) => s === 200,
    });
    
    // Si la respuesta es un array vacío, Nominatim resolvió ok pero no encontró nada
    if (Array.isArray(response.data) && response.data.length === 0) {
      return { lat: null, lng: null, noMatch: true };
    }

    const row = Array.isArray(response.data) ? response.data[0] : null;
    const lat = Number(row?.lat);
    const lng = Number(row?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { lat: null, lng: null, noMatch: true };
    }
    return { lat, lng };
  } catch (_error) {
    return { lat: null, lng: null, error: true };
  }
};

const guardarZonasUsuario = async ({ usuarioId, zonas = [] }) => {
  if (!usuarioId || !zonas.length) return 0;
  await query("DELETE FROM usuario_zonas WHERE usuario_id = $1", [usuarioId]);
  let insertadas = 0;
  for (let i = 0; i < zonas.length; i += 1) {
    const z = zonas[i];
    await query(
      `
        INSERT INTO usuario_zonas (usuario_id, provincia, partido, lat, lng, prioridad, activa)
        VALUES ($1, $2, $3, $4, $5, $6, true)
      `,
      [usuarioId, z.provincia, z.partido, z.lat ?? null, z.lng ?? null, i + 1]
    );
    insertadas += 1;
  }
  return insertadas;
};

const detectarTipoComercializacion = (texto = "") => {
  const t = normalizarTexto(texto);
  if (["1", "disponible", "pizarra", "solo disponible"].includes(t)) return "disponible";
  if (["2", "futuros", "futuro", "coberturas"].includes(t)) return "futuros";
  return null;
};

const fetchOnboardingRow = async (claveWhatsapp) => {
  if (!claveWhatsapp) return null;
  const result = await query(
    `
      SELECT id, whatsapp, paso_actual, datos_temporales, completado
      FROM onboarding_estado
      WHERE whatsapp = $1
      LIMIT 1
    `,
    [claveWhatsapp]
  );
  return result.rows[0] || null;
};

/**
 * La clave en onboarding_estado es el número canónico; con @lid el jid no coincide.
 * Si hay usuario vinculado (por jid o número), probamos también whatsapp / whatsapp_real guardados.
 */
const obtenerEstadoOnboarding = async (numeroWhatsapp) => {
  const directo = normalizarWhatsapp(numeroWhatsapp);
  const porClave = await fetchOnboardingRow(directo);
  if (porClave) return porClave;

  const usuario = await buscarPorWhatsapp(numeroWhatsapp);
  if (!usuario) return null;
  const alternativas = [
    normalizarWhatsapp(usuario.whatsapp || ""),
    normalizarWhatsapp(usuario.whatsapp_real || ""),
  ].filter((w) => w && w !== directo);

  for (const alt of alternativas) {
    const row = await fetchOnboardingRow(alt);
    if (row) return row;
  }
  return null;
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
    [whatsapp, pasoActual, JSON.stringify(datosTemporales || {}), Boolean(completado)]
  );
};

const iniciarOnboarding = async (numeroWhatsapp) => {
  await actualizarEstadoOnboarding({
    numeroWhatsapp,
    pasoActual: 1,
    datosTemporales: {},
    completado: false,
  });
  return obtenerMensajeBienvenida();
};

const upsertPerfilProductivo = async (usuarioId, tipo) => {
  const current = await query(
    `
      SELECT id
      FROM perfil_productivo
      WHERE usuario_id = $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [usuarioId]
  );
  if (current.rows[0]) {
    await query(
      `
        UPDATE perfil_productivo
        SET tipo = $2, activo = true
        WHERE id = $1
      `,
      [current.rows[0].id, tipo]
    );
    return;
  }
  await query(
    `
      INSERT INTO perfil_productivo (usuario_id, tipo, activo)
      VALUES ($1, $2, true)
    `,
    [usuarioId, tipo]
  );
};

const finalizarOnboarding = async ({ numeroWhatsapp, datos }) => {
  const usuario = await crearUsuario({
    nombre: datos.nombre,
    // Importante: conservar JID (@lid/@c.us) para poder enviar el primer resumen
    // aun cuando no exista numero E.164 resoluble.
    whatsapp: numeroWhatsapp,
    provincia: datos.provincia,
    partido: datos.partido,
    tipo_comercializacion: "disponible",
  });

  await guardarCultivosUsuario({
    usuarioId: usuario.id,
    cultivos: datos.cultivos || [],
    hectareas: null,
    costoPorHa: null,
  });

  await upsertPerfilProductivo(usuario.id, datos.perfil_productivo || "agricultura");

  if (Array.isArray(datos.ganaderia_perfiles) && datos.ganaderia_perfiles.length) {
    await guardarPerfilGanaderoUsuario({
      usuarioId: usuario.id,
      perfiles: datos.ganaderia_perfiles,
      cantidadTotal: Number(datos.ganado_total || 0),
    });
    const porCategoria = datos.ganado_total
      ? Math.max(1, Math.floor(Number(datos.ganado_total) / datos.ganaderia_perfiles.length))
      : 1;
    for (const p of datos.ganaderia_perfiles) {
      await query(
        `
          INSERT INTO stock_ganadero (usuario_id, categoria, cantidad, fecha)
          VALUES ($1, $2, $3, CURRENT_DATE)
        `,
        [usuario.id, p.categoria, porCategoria]
      );
    }
  }

  const zonasCargadas = Array.isArray(datos.zonas) && datos.zonas.length
    ? datos.zonas.slice(0, 5)
    : [{ provincia: datos.provincia, partido: datos.partido }];
  const zonasConGeo = [];
  for (const zona of zonasCargadas) {
    const geo = await geocodificarZona({
      partido: zona.partido,
      provincia: zona.provincia,
    });
    zonasConGeo.push({
      provincia: zona.provincia,
      partido: zona.partido,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
    });
  }
  const zonaPrincipal = zonasConGeo[0] || null;
  await guardarZonasUsuario({
    usuarioId: usuario.id,
    zonas: zonasConGeo,
  });
  if (zonaPrincipal) {
    await actualizarUsuario(usuario.id, {
      provincia: zonaPrincipal.provincia,
      partido: zonaPrincipal.partido,
      lat: zonaPrincipal.lat,
      lng: zonaPrincipal.lng,
    });
  }

  await actualizarEstadoOnboarding({
    numeroWhatsapp,
    pasoActual: 3,
    datosTemporales: { ...datos, onboarding_minimo: true },
    completado: true,
  });

  const { guardarConsulta } = require("../models/consulta");
  const nombreUsuario = datos.nombre ? datos.nombre.split(" ")[0] : "productor";
  const finalReply = `¡Listo, ${nombreUsuario}! Ya registré tus datos y configuré tu establecimiento. 🌾✨\n\nAhora sí, ¿querés que te cuente lo que podés consultarme o hacer conmigo como tu asistente del campo?`;

  try {
    await guardarConsulta({
      usuarioId: usuario.id,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: "Completar Onboarding",
      respuesta: finalReply,
      iaProvider: "heuristica",
    });
  } catch (errLog) {
    console.warn("[onboarding] Error al guardar consulta final de onboarding en historial:", errLog.message);
  }

  return finalReply;
};

const procesarPasoOnboarding = async (numeroWhatsapp, mensaje) => {
  const texto = String(mensaje || "").trim();
  if (!texto) return "Necesito ese dato para continuar.";

  const estado = (await obtenerEstadoOnboarding(numeroWhatsapp)) || {
    paso_actual: 1,
    datos_temporales: {},
  };
  const datos = estado.datos_temporales || {};

  if (estado.paso_actual <= 1) {
    if (texto.split(/\s+/).filter(Boolean).length < 2) {
      return "Necesito nombre y apellido para registrarte. Ejemplo: Juan Pérez";
    }
    datos.nombre = texto;
    await actualizarEstadoOnboarding({
      numeroWhatsapp,
      pasoActual: 2,
      datosTemporales: datos,
      completado: false,
    });
    return MENSAJE_PASO_2;
  }

  if (estado.paso_actual === 2) {
    const zonas = parseZonasProvinciaPartido(texto);
    if (!zonas.length) {
      return "No pude leer la zona. Formato: Provincia, Partido - Provincia, Partido. Ej: Buenos Aires, Tandil - Córdoba, Río Cuarto";
    }

    const zonasValidas = [];
    const zonasNoReconocidas = [];
    for (const z of zonas) {
      const geo = await geocodificarZona({ partido: z.partido, provincia: z.provincia });
      if (geo.noMatch) {
        zonasNoReconocidas.push(`${z.provincia}, ${z.partido}`);
      } else {
        zonasValidas.push({
          provincia: z.provincia,
          partido: z.partido,
          lat: geo.lat,
          lng: geo.lng
        });
      }
    }

    if (zonasNoReconocidas.length > 0) {
      return `Lo siento, no logré reconocer la ubicación: *${zonasNoReconocidas.join(" / ")}*.\n\nPor favor, verificá que los nombres de la Provincia y el Partido estén bien escritos (ejemplo: *Buenos Aires, Tandil*) y volvé a enviármelos.`;
    }

    datos.zonas = zonasValidas;
    datos.provincia = zonasValidas[0].provincia;
    datos.partido = zonasValidas[0].partido;
    await actualizarEstadoOnboarding({
      numeroWhatsapp,
      pasoActual: 3,
      datosTemporales: datos,
      completado: false,
    });
    return MENSAJE_PASO_3;
  }

  if (estado.paso_actual === 3) {
    const norm = normalizarTexto(texto);
    const mencionaGanaderia = norm.includes("ganader");
    const soloGanaderia = mencionaGanaderia && !/soja|maiz|trigo|girasol|sorgo|cebada|papa|patata/.test(norm);
    const cultivos = parseCultivos(texto);
    if (!soloGanaderia && !cultivos.length) {
      return "No pude leer lo que trabajás. Ejemplo: soja, maíz, trigo | ganadería | soja, maíz y ganadería.";
    }
    datos.cultivos = cultivos;
    datos.perfil_productivo = soloGanaderia
      ? "ganaderia"
      : mencionaGanaderia
      ? "mixto"
      : "agricultura";
    if (mencionaGanaderia) {
      await actualizarEstadoOnboarding({
        numeroWhatsapp,
        pasoActual: 4,
        datosTemporales: datos,
        completado: false,
      });
      return MENSAJE_PASO_4_GANADERIA;
    }
    return finalizarOnboarding({ numeroWhatsapp, datos });
  }

  if (estado.paso_actual >= 4) {
    const { categorias, perfiles } = parseGanaderiaEstructurada(texto);
    if (!categorias.length) {
      return "No pude leer tipos de ganado. Escribilos separados por coma. Ej: vacuno novillos, porcino madres.";
    }
    datos.ganaderia_categorias = categorias;
    datos.ganaderia_perfiles = perfiles;
    return finalizarOnboarding({ numeroWhatsapp, datos });
  }

  return MENSAJE_PASO_3;
};

const extraState = (estado) => estado?.datos_temporales?.perfil_extra || null;

const guardarExtraState = async ({ numeroWhatsapp, patch }) => {
  const estado = await obtenerEstadoOnboarding(numeroWhatsapp);
  const base = estado?.datos_temporales || {};
  const merged = {
    ...base,
    perfil_extra: {
      ...(base.perfil_extra || {}),
      ...patch,
      activo: patch?.activo !== undefined ? patch.activo : true,
    },
  };
  await actualizarEstadoOnboarding({
    numeroWhatsapp,
    pasoActual: estado?.paso_actual || 3,
    datosTemporales: merged,
    completado: estado?.completado !== undefined ? estado.completado : true,
  });
};

const limpiarExtraState = async (numeroWhatsapp) => {
  const estado = await obtenerEstadoOnboarding(numeroWhatsapp);
  if (!estado) return;
  const base = estado.datos_temporales || {};
  delete base.perfil_extra;
  await actualizarEstadoOnboarding({
    numeroWhatsapp,
    pasoActual: estado.paso_actual || 3,
    datosTemporales: base,
    completado: estado.completado !== undefined ? estado.completado : true,
  });
};

const menuCompletarPerfil = `Vamos a completar tu perfil para darte mejores recomendaciones.
¿Qué querés agregar?
1️⃣ Hectáreas y costos (para análisis de margen)
2️⃣ Lotes en distintas zonas
3️⃣ Datos de hacienda (si tenés ganado)
4️⃣ Cómo comercializás (disponible o futuros)
5️⃣ Cultivos (agregar o actualizar lista)`;

const agregarAyudaComandos = (texto = "") =>
  `${texto}\n\nSi querés más información procesada (por ejemplo, margen por cultivo), te voy a pedir datos como hectáreas y costo por ha.\nPara ver todos los comandos, escribí: *VER COMANDOS*`;

const iniciarCompletarPerfil = async (numeroWhatsapp) => {
  await guardarExtraState({
    numeroWhatsapp,
    patch: { activo: true, paso: "menu", opcion: null, data: {} },
  });
  return menuCompletarPerfil;
};

const procesarCompletarPerfil = async (numeroWhatsapp, mensaje) => {
  const texto = String(mensaje || "").trim();
  const usuario = await buscarPorWhatsapp(numeroWhatsapp);
  if (!usuario) {
    return {
      enFlujo: true,
      respuesta: "Primero completamos tu registro inicial. Escribime cualquier mensaje y arrancamos.",
    };
  }

  const estado = await obtenerEstadoOnboarding(numeroWhatsapp);
  const extra = extraState(estado);
  if (!extra?.activo) return { enFlujo: false, respuesta: null };

  const perfil = await obtenerPerfil(numeroWhatsapp);
  const planEfectivo = resolverPlanEfectivo({
    plan: perfil?.plan,
    planActivoHasta: perfil?.plan_activo_hasta,
  });
  const maxZonasPorPlan = 999;
  const opcion = extra.opcion;
  const paso = extra.paso;

  if (paso === "menu") {
    const op = normalizarTexto(texto);
    if (!["1", "2", "3", "4", "5"].includes(op)) {
      return { enFlujo: true, respuesta: "Elegí una opción: 1, 2, 3, 4 o 5." };
    }
    if (op === "1") {
      await guardarExtraState({
        numeroWhatsapp,
        patch: { paso: "opt1_hectareas", opcion: "1", data: {} },
      });
      return { enFlujo: true, respuesta: "Perfecto. ¿Cuántas hectáreas trabajás en total?" };
    }
    if (op === "2") {
      await guardarExtraState({
        numeroWhatsapp,
        patch: { paso: "opt2_lotes", opcion: "2", data: {} },
      });
      return {
        enFlujo: true,
        respuesta:
          `Pasame tus zonas así (máximo ${maxZonasPorPlan} por tu plan): Partido, Provincia, Hectáreas - Partido, Provincia, Hectáreas`,
      };
    }
    if (op === "3") {
      await guardarExtraState({
        numeroWhatsapp,
        patch: { paso: "opt3_cabezas", opcion: "3", data: {} },
      });
      return { enFlujo: true, respuesta: "¿Cuántas cabezas tenés aproximadamente?" };
    }
    await guardarExtraState({
      numeroWhatsapp,
      patch: { paso: "opt4_comercializacion", opcion: "4", data: {} },
    });
    if (op === "4") {
      return {
        enFlujo: true,
        respuesta: "¿Cómo comercializás? Respondé: 1 disponible, 2 futuros.",
      };
    }
    await guardarExtraState({
      numeroWhatsapp,
      patch: { paso: "opt5_cultivos", opcion: "5", data: {} },
    });
    return {
      enFlujo: true,
      respuesta:
        "Pasame tus cultivos separados por coma. Ejemplo: soja, maíz, trigo (o escribí 'ganadería' si no querés cultivos).",
    };
  }

  if (opcion === "1") {
    if (paso === "opt1_hectareas") {
      const hectareas = parseNumero(texto);
      if (hectareas === null || hectareas < 0) {
        return { enFlujo: true, respuesta: "No entendí las hectáreas. Escribí un número." };
      }
      await guardarExtraState({
        numeroWhatsapp,
        patch: { paso: "opt1_costo", opcion: "1", data: { hectareas } },
      });
      return { enFlujo: true, respuesta: "¿Y tu costo por hectárea en USD?" };
    }
    if (paso === "opt1_costo") {
      const costo = parseNumero(texto);
      if (costo === null || costo < 0) {
        return { enFlujo: true, respuesta: "No entendí el costo por ha. Escribí un número en USD." };
      }
      if ((perfil?.cultivos || []).length) {
        await guardarCultivosUsuario({
          usuarioId: usuario.id,
          cultivos: perfil.cultivos.map((c) => c.cultivo),
          hectareas: extra.data?.hectareas || null,
          costoPorHa: costo,
        });
      }
      await limpiarExtraState(numeroWhatsapp);
      return {
        enFlujo: true,
        respuesta: agregarAyudaComandos("Listo, guardé hectáreas y costo por ha. ✅"),
      };
    }
  }

  if (opcion === "2" && paso === "opt2_lotes") {
    const lotesRaw = texto
      .split(/\s+-\s+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, maxZonasPorPlan);
    if (!lotesRaw.length) {
      return {
        enFlujo: true,
        respuesta:
          "No pude leer las zonas. Usá el formato: Tandil, Buenos Aires, 120 - Pergamino, Buenos Aires, 80",
      };
    }
    const zonas = [];
    for (const item of lotesRaw) {
      const partes = item
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (partes.length < 2) continue;
      const partido = partes[0];
      const provincia = partes[1];
      const geo = await geocodificarZona({ partido, provincia });
      zonas.push({
        partido,
        provincia,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
      });
    }
    if (!zonas.length) {
      return {
        enFlujo: true,
        respuesta:
          "No pude interpretar zonas válidas. Ejemplo: Tandil, Buenos Aires, 120 - Azul, Buenos Aires, 90",
      };
    }
    await guardarZonasUsuario({ usuarioId: usuario.id, zonas });
    if (zonas[0]) {
      await actualizarUsuario(usuario.id, {
        provincia: zonas[0].provincia,
        partido: zonas[0].partido,
        lat: zonas[0].lat,
        lng: zonas[0].lng,
      });
    }
    const base = estado?.datos_temporales || {};
    base.lotes_declarados = lotesRaw;
    await actualizarEstadoOnboarding({
      numeroWhatsapp,
      pasoActual: estado?.paso_actual || 3,
      datosTemporales: base,
      completado: true,
    });
    await limpiarExtraState(numeroWhatsapp);
    return {
      enFlujo: true,
      respuesta: agregarAyudaComandos(
        `Perfecto, registré ${zonas.length} zona(s) productiva(s). ✅`
      ),
    };
  }

  if (opcion === "3") {
    if (paso === "opt3_cabezas") {
      const cabezas = parseNumero(texto);
      if (cabezas === null || cabezas < 0) {
        return { enFlujo: true, respuesta: "No entendí la cantidad de cabezas." };
      }
      await guardarExtraState({
        numeroWhatsapp,
        patch: { paso: "opt3_categorias", opcion: "3", data: { stock_total: Math.round(cabezas) } },
      });
      return {
        enFlujo: true,
        respuesta:
          "¿Qué categorías/especies manejás? (ej: vacuno novillos, vacuno terneros, porcino madres, ovino ovejas)",
      };
    }
    if (paso === "opt3_categorias") {
      const { categorias, perfiles } = parseGanaderiaEstructurada(texto);
      if (!categorias.length) {
        return { enFlujo: true, respuesta: "No pude leer categorías. Escribilas separadas por coma." };
      }
      const total = Number(extra.data?.stock_total || 0);
      const porCategoria = categorias.length ? Math.max(1, Math.floor(total / categorias.length)) : total;
      await query("DELETE FROM stock_ganadero WHERE usuario_id = $1 AND fecha = CURRENT_DATE", [usuario.id]);
      for (const categoria of categorias) {
        await query(
          `
            INSERT INTO stock_ganadero (usuario_id, categoria, cantidad, fecha)
            VALUES ($1, $2, $3, CURRENT_DATE)
          `,
          [usuario.id, categoria, porCategoria]
        );
      }
      await guardarPerfilGanaderoUsuario({
        usuarioId: usuario.id,
        perfiles,
        cantidadTotal: total,
      });
      const cultivosActivos = await query(
        "SELECT 1 FROM usuario_cultivos WHERE usuario_id = $1 AND activo = true LIMIT 1",
        [usuario.id]
      );
      await upsertPerfilProductivo(usuario.id, cultivosActivos.rows[0] ? "mixto" : "ganaderia");
      await limpiarExtraState(numeroWhatsapp);
      return {
        enFlujo: true,
        respuesta: agregarAyudaComandos("Listo, guardé tus datos de hacienda. ✅"),
      };
    }
  }

  if (opcion === "4" && paso === "opt4_comercializacion") {
    const tipo = detectarTipoComercializacion(texto);
    if (!tipo) {
      return { enFlujo: true, respuesta: "No entendí. Respondé 1 (disponible) o 2 (futuros)." };
    }
    await actualizarUsuario(usuario.id, { tipo_comercializacion: tipo });
    await limpiarExtraState(numeroWhatsapp);
    return {
      enFlujo: true,
      respuesta: agregarAyudaComandos("Perfecto, actualicé tu forma de comercialización. ✅"),
    };
  }

  if (opcion === "5" && paso === "opt5_cultivos") {
    const norm = normalizarTexto(texto);
    const mencionaGanaderia = norm.includes("ganader");
    const soloGanaderia = mencionaGanaderia && !/soja|maiz|trigo|girasol|sorgo|cebada|papa|patata/.test(norm);
    const cultivos = parseCultivos(texto);
    if (!soloGanaderia && !cultivos.length) {
      return {
        enFlujo: true,
        respuesta:
          "No pude leer los cultivos. Ejemplo: soja, maíz, trigo | ganadería | soja, maíz y ganadería.",
      };
    }
    const hectareas = perfil?.cultivos?.[0]?.hectareas ?? null;
    const costoPorHa = perfil?.cultivos?.[0]?.costo_por_ha ?? null;
    await guardarCultivosUsuario({
      usuarioId: usuario.id,
      cultivos,
      hectareas,
      costoPorHa,
    });

    // Si además ya tiene stock ganadero, dejamos perfil mixto.
    const stock = await query(
      `
        SELECT 1
        FROM stock_ganadero
        WHERE usuario_id = $1
        LIMIT 1
      `,
      [usuario.id]
    );
    const nuevoPerfil = soloGanaderia
      ? "ganaderia"
      : mencionaGanaderia || stock.rows[0]
      ? "mixto"
      : "agricultura";
    await upsertPerfilProductivo(usuario.id, nuevoPerfil);

    await limpiarExtraState(numeroWhatsapp);
    return {
      enFlujo: true,
      respuesta: agregarAyudaComandos(
        soloGanaderia
          ? "Listo, dejé tu perfil en ganadería (sin cultivos activos). ✅"
          : `Perfecto, actualicé tus cultivos: ${cultivos.join(", ")} ✅`
      ),
    };
  }

  await limpiarExtraState(numeroWhatsapp);
  return { enFlujo: true, respuesta: "Listo, cerré el flujo de completar perfil." };
};

const gestionarCompletarPerfil = async (numeroWhatsapp, mensaje) => {
  const textoNorm = normalizarTexto(mensaje);
  const estado = await obtenerEstadoOnboarding(numeroWhatsapp);
  const enExtra = Boolean(extraState(estado)?.activo);

  if (textoNorm === "completar perfil") {
    const usuario = await buscarPorWhatsapp(numeroWhatsapp);
    if (!usuario) {
      return {
        enFlujo: true,
        respuesta: "Primero terminamos tu registro inicial. Después usamos COMPLETAR PERFIL.",
      };
    }
    const respuesta = await iniciarCompletarPerfil(numeroWhatsapp);
    return { enFlujo: true, respuesta };
  }

  if (!enExtra) return { enFlujo: false, respuesta: null };
  return procesarCompletarPerfil(numeroWhatsapp, mensaje);
};

/**
 * true si el bot está esperando respuesta en onboarding (no completado)
 * o en el flujo COMPLETAR PERFIL (perfil_extra activo).
 * Usado para no encimar la invitación al resumen diario.
 */
const usuarioPendienteRespuestaOnboarding = async (usuario) => {
  if (!usuario?.id) return false;
  const seen = new Set();
  const pendienteDesdeEstado = (estado) => {
    if (!estado) return false;
    if (!estado.completado) return true;
    return Boolean(extraState(estado)?.activo);
  };
  const tryKey = async (raw) => {
    const s = String(raw || "").trim();
    if (!s) return false;
    const dedupe = s.includes("@") ? s : normalizarWhatsapp(s) || s.replace(/\D/g, "");
    if (!dedupe || seen.has(dedupe)) return false;
    seen.add(dedupe);
    const estado = await obtenerEstadoOnboarding(s);
    return pendienteDesdeEstado(estado);
  };
  if (await tryKey(destinoWhatsappParaEnvio(usuario))) return true;
  if (await tryKey(usuario.whatsapp_jid)) return true;
  if (await tryKey(usuario.whatsapp_real)) return true;
  if (await tryKey(usuario.whatsapp)) return true;
  return false;
};

const gestionarOnboarding = async (numeroWhatsapp, mensaje, numeroReal) => {
  const usuario = await buscarPorWhatsapp(numeroWhatsapp, numeroReal);
  if (usuario && usuario.es_delegado) {
    return { enOnboarding: false, respuesta: null };
  }
  const estado = await obtenerEstadoOnboarding(numeroWhatsapp);
  const perfil = usuario ? await obtenerPerfil(numeroWhatsapp, numeroReal) : null;
  const tieneCultivos =
    Array.isArray(perfil?.cultivos) && perfil.cultivos.length > 0;
  let perfilMinimoCompleto = Boolean(
    perfil?.nombre &&
      perfil?.provincia &&
      perfil?.partido &&
      tieneCultivos
  );
  if (
    !perfilMinimoCompleto &&
    usuario?.id &&
    perfil?.nombre &&
    perfil?.provincia &&
    perfil?.partido
  ) {
    const gan = await query(
      `
        SELECT 1
        FROM perfil_productivo
        WHERE usuario_id = $1
          AND activo = true
          AND tipo IN ('ganaderia', 'mixto')
        LIMIT 1
      `,
      [usuario.id]
    );
    perfilMinimoCompleto = Boolean(gan.rows[0]);
  }

  const datosBasicosEnUsuario = Boolean(
    usuario &&
      String(usuario.nombre || "").trim().length >= 2 &&
      String(usuario.provincia || "").trim() &&
      String(usuario.partido || "").trim()
  );

  // Solo salimos del onboarding si hay estado completado o perfil realmente completo.
  if (usuario && (estado?.completado || perfilMinimoCompleto)) {
    return { enOnboarding: false, respuesta: null };
  }
  // Usuario ya persistido (p. ej. fila onboarding ausente o clave distinta) pero con domicilio productivo: no bienvenida de cero.
  if (usuario && datosBasicosEnUsuario && !estado) {
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
  gestionarCompletarPerfil,
  usuarioPendienteRespuestaOnboarding,
  geocodificarZona,
};
