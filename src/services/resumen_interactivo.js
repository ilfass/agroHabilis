const { query } = require("../config/database");
const { generarConPromptLibre, generarConGroundingGoogleSearch } = require("./gemini");
const { resolverPlanEfectivo } = require("./planes");
const {
  guardarResumen,
  marcarResumenEnviado,
  prepararDatosResumenInteractivo,
  obtenerRadarWeb,
} = require("./resumen");
const {
  obtenerEstado,
  guardarEstado,
  limpiarEstado,
  marcarInvitacionResumenHoy,
} = require("./conversacion_estado");
const { obtenerClima } = require("../scrapers/clima");
const { usuarioPendienteRespuestaOnboarding } = require("./onboarding");
const { clasificarHeuristica, clasificarMensaje } = require("./clasificador");
const {
  esProbableNoAgroDeportesOcio,
  esActualidadGeopoliticaSinAnclaAgro,
} = require("./intent_classifier");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ventana para responder cada paso del resumen interactivo (invitación, pronóstico, noticias). */
const HORAS_EXPIRACION_RESUMEN_INTERACTIVO = 6;

const groundingExplicitamenteOff = () => {
  const v = String(process.env.GEMINI_GROUNDING_ENABLED || process.env.GEMINI_GROUNDING || "")
    .trim()
    .toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
};

/** Misma política que consultas: opt-out explícito; si no, ON con GEMINI_API_KEY. */
const groundingHabilitadoParaResumen = () => {
  if (groundingExplicitamenteOff()) return false;
  const v = String(process.env.GEMINI_GROUNDING_ENABLED || process.env.GEMINI_GROUNDING || "")
    .trim()
    .toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  return Boolean(process.env.GEMINI_API_KEY?.trim());
};

const brechaOficialBluePct = (ctx) => {
  const items = ctx.tipoCambio?.items || [];
  const of = items.find((t) => String(t.tipo || "").toLowerCase() === "oficial");
  const bl = items.find((t) => String(t.tipo || "").toLowerCase() === "blue");
  const vo = Number(of?.valor);
  const vb = Number(bl?.valor);
  if (!Number.isFinite(vo) || !Number.isFinite(vb) || vo <= 0) return null;
  return Number((((vb - vo) / vo) * 100).toFixed(1));
};

const sanitizarSalidaDatosClave = (txt = "") => {
  let t = String(txt || "").trim();
  t = t.replace(/\n+Nota:.*$/is, "").trim();
  t = t.replace(/\n+No se encontraron fuentes[^\n]*$/i, "").trim();
  return t;
};

const normalizarMsg = (t = "") =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const esAfirmativo = (t) => {
  const s = normalizarMsg(t).replace(/\s+/g, " ");
  if (!s) return false;
  if (/^(👍|✅)/.test(s)) return true;
  if (/^(ok|okey|okay|dale|sip|claro|va)\b/.test(s)) return true;
  if (s === "s" || s === "y" || s === "yes") return true;
  if (/^(asi|así)\b/.test(s)) return false;
  return /^s[ií]\b/.test(s) || s === "si" || s === "sí";
};

const esNegativo = (t) => {
  const s = normalizarMsg(t).replace(/\s+/g, " ");
  if (!s) return false;
  if (/^(👎|nop|no|nope|ahora\s+no|después|despues|negativo|mejor\s+no)/.test(s)) return true;
  if (s === "n") return true;
  return /^no\b/.test(s);
};

/**
 * Cuando estamos en el flujo guiado de Resumen Interactivo y el usuario manda algo que NO es
 * sí/no pero claramente quiere otra cosa (precio, clima, comando, off-topic explícito, etc.),
 * vale más cancelar el flujo y delegar al pipeline normal que insistir con "respondé sí o no".
 *
 * Conservador a propósito: solo retorna `true` cuando hay señal fuerte. Si el mensaje es corto
 * y ambiguo, sigue tratándose como respuesta sí/no inválida.
 */
const mensajeTieneIntencionFueraDelFlujoResumen = async (mensaje = "", usuario = null) => {
  const raw = String(mensaje || "").trim();
  if (!raw) return false;
  if (esAfirmativo(raw) || esNegativo(raw)) return false;

  try {
    const c = await clasificarMensaje(raw, usuario);
    const intentOperativo = new Set([
      "precio",
      "clima",
      "registrar",
      "consulta_registros",
      "comando",
      "analisis_mercado",
      "analisis_interno",
      "no_agro",
      "agro_general",
    ]);
    if (intentOperativo.has(c?.intencion)) {
      return true;
    }
  } catch (_e) {
    /* fallback abajo */
  }

  return false;
};

const TEXTO_PAUSA_RESUMEN =
  "Pauso el resumen y te respondo lo que pediste 👌\n_Si querés volver a verlo, escribime *MI RESUMEN*._";

const normalizar = (txt = "") =>
  String(txt || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const futurosPorCultivo = (futuros, cultivo) =>
  (futuros || []).filter((f) => normalizar(f.cultivo) === normalizar(cultivo)).slice(0, 2);

const formatearMoneda = (valor, moneda = "ARS") => {
  const n = Number(valor);
  if (!Number.isFinite(n)) return "s/d";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: moneda,
    maximumFractionDigits: moneda === "USD" ? 2 : 0,
  }).format(n);
};

const emojiCultivo = (cultivo) => {
  const k = normalizar(cultivo);
  if (k.includes("soja")) return "🫘";
  if (k.includes("maiz")) return "🌽";
  if (k.includes("trigo")) return "🌾";
  if (k.includes("girasol")) return "🌻";
  if (k.includes("cebada")) return "🌾";
  if (k.includes("sorgo")) return "🌾";
  if (k.includes("papa")) return "🥔";
  return "🌱";
};

const futuroParaCultivo = (futuros, cultivo) => {
  const n = normalizar(cultivo);
  const rows = (futuros || []).filter((f) => normalizar(f.cultivo) === n);
  if (!rows.length) return null;
  const f = rows[0];
  const usd = Number(f.precio_usd);
  if (!Number.isFinite(usd)) return null;
  const pos = f.posicion ? String(f.posicion) : "referencia";
  return `${formatearMoneda(usd, "USD")} (${pos})`;
};

const bloqueDolarCompacto = (tipoCambio) => {
  const items = Array.isArray(tipoCambio?.items) ? tipoCambio.items : [];
  const by = new Map(items.map((it) => [String(it?.tipo || "").toLowerCase(), it]));
  const orden = [
    ["oficial", "Oficial"],
    ["blue", "Blue"],
    ["mep", "MEP"],
  ];
  const lineas = [];
  for (const [k, label] of orden) {
    const tc = by.get(k);
    if (!tc) continue;
    const compra = Number(tc.compra);
    const venta = Number(tc.valor);
    const compraTxt = Number.isFinite(compra) ? `compra ${formatearMoneda(compra, "ARS")}` : null;
    const ventaTxt = Number.isFinite(venta) ? `venta ${formatearMoneda(venta, "ARS")}` : "venta s/d";
    lineas.push(`- *${label}:* ${compraTxt ? `${compraTxt} · ${ventaTxt}` : ventaTxt}`);
  }
  if (!lineas.length) return "💵 *Dólar*\nSin datos recientes.";
  return ["💵 *Dólar (ARS)*", ...lineas].join("\n");
};

async function obtenerReferenciaHacienda(usuarioId) {
  const perfilGanadero = await query(
    `
      SELECT categoria
      FROM usuario_ganaderia_perfil
      WHERE usuario_id = $1 AND activo = true
      ORDER BY especie, categoria
    `,
    [usuarioId]
  );
  const categoriasPreferidas = (perfilGanadero.rows || []).map((p) => normalizar(p.categoria)).filter(Boolean);

  let precioRef = null;
  if (categoriasPreferidas.length) {
    const precioPreferido = await query(
      `
        SELECT categoria, precio_promedio, fecha
        FROM precios_hacienda
        WHERE lower(categoria) = ANY($1::text[])
        ORDER BY fecha DESC
        LIMIT 1
      `,
      [categoriasPreferidas]
    );
    precioRef = precioPreferido.rows[0] || null;
  }
  if (!precioRef) {
    const precioNovillo = await query(
      `
        SELECT categoria, precio_promedio, fecha
        FROM precios_hacienda
        WHERE categoria IN ('novillo', 'novillito', 'ternero')
        ORDER BY fecha DESC
        LIMIT 1
      `
    );
    precioRef = precioNovillo.rows[0] || null;
  }
  if (!precioRef?.categoria) return null;

  const hist = await query(
    `
      SELECT precio_promedio, fecha
      FROM precios_hacienda
      WHERE categoria = $1
      ORDER BY fecha DESC
      LIMIT 2
    `,
    [precioRef.categoria]
  );
  const hoy = Number(hist.rows[0]?.precio_promedio);
  const ayer = Number(hist.rows[1]?.precio_promedio);
  let senal = "estable";
  if (Number.isFinite(hoy) && Number.isFinite(ayer)) {
    if (hoy > ayer * 1.008) senal = "firme";
    else if (hoy < ayer * 0.992) senal = "flojo";
  }

  return {
    categoria: precioRef.categoria,
    precio_kg: hoy,
    fecha: hist.rows[0]?.fecha || precioRef.fecha,
    senal,
    mercado: "referencia Liniers / plazas",
  };
}

function generarBloqueCultivos(ctx, incluirDolar = true) {
  const metricas = ctx.metricas || [];
  const futuros = ctx.futuros || [];
  const lineas = [];
  lineas.push("📊 *Tus cultivos hoy*");
  lineas.push("━━━━━━━━━━━━━━━━━");
  for (const m of metricas) {
    const fechaFila = m.fecha_referencia || ctx.precios?.fecha;
    const fechaBase = fechaFila
      ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" }).format(new Date(fechaFila))
      : "hoy";
    const emoji = emojiCultivo(m.cultivo);
    const ars = Number(m.precio_ars);
    const usd = Number(m.precio_usd);
    const disp =
      Number.isFinite(ars) && ars > 0
        ? formatearMoneda(ars, "ARS")
        : Number.isFinite(usd) && usd > 0
          ? `${formatearMoneda(usd, "USD")}/tn (ref. FOB/USD)`
          : "s/d";
    const fut = futuroParaCultivo(futuros, m.cultivo);
    lineas.push(
      `${emoji} *${m.cultivo}* · ${fechaBase}`,
      `Disponible (referencia): *${disp}*`,
      fut ? `Futuro cercano: *${fut}*` : `Futuro cercano: *s/d*`,
      ""
    );
  }
  if (!metricas.length) {
    lineas.push("Todavía no tenés cultivos cargados: escribí *COMPLETAR PERFIL* para sumarlos.");
  }
  if (incluirDolar) lineas.push(bloqueDolarCompacto(ctx.tipoCambio));
  return lineas.filter((x, i, a) => !(x === "" && a[i + 1] === "")).join("\n");
}

/** Usa ctx ya cargado (evita doble query de tipo de cambio). */
async function generarBloqueHaciendaConCtx(ctx, incluirDolar = true) {
  const ref = await obtenerReferenciaHacienda(ctx.perfil.id);
  const lineas = ["📊 *Tu hacienda hoy*", "━━━━━━━━━━━━━━━━━"];
  if (!ref || !Number.isFinite(ref.precio_kg)) {
    lineas.push("Referencia ganadera: *s/d* hoy.");
  } else {
    const f = ref.fecha
      ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" }).format(new Date(ref.fecha))
      : "hoy";
    lineas.push(
      `🐄 *${ref.categoria}* · ${f}`,
      `${ref.mercado}: *${formatearMoneda(ref.precio_kg, "ARS")}/kg*`,
      `Señal (vs corte previo): *${ref.senal}*`
    );
  }
  if (incluirDolar) lineas.push("", bloqueDolarCompacto(ctx.tipoCambio));
  return lineas.join("\n");
}

async function generarBloquePreciosUsuario(ctx) {
  const tipo = String(ctx.perfil?.perfil_productivo || "agricultura").toLowerCase();
  const partes = [];
  if (tipo === "agricultura" || tipo === "mixto") {
    partes.push(generarBloqueCultivos(ctx, false));
  }
  if (tipo === "ganaderia" || tipo === "mixto") {
    partes.push(await generarBloqueHaciendaConCtx(ctx, false));
  }
  const cuerpo = partes.filter(Boolean).join("\n\n");
  const dolar = bloqueDolarCompacto(ctx.tipoCambio);
  if (!cuerpo.trim()) return dolar;
  return `${cuerpo}\n\n${dolar}`;
}

const TZ_AR = "America/Argentina/Buenos_Aires";

function fechaIsoHoyArgentina() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_AR,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

function sumarDiasIso(iso, dias) {
  const [y, M, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, M - 1, d));
  t.setUTCDate(t.getUTCDate() + dias);
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function claveFechaClima(c) {
  if (!c?.fecha) return "";
  if (c.fecha instanceof Date) return c.fecha.toISOString().slice(0, 10);
  const s = String(c.fecha);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/**
 * Si falta hoy / mañana / pasado mañana (calendario AR) en los datos de ctx,
 * intenta completar con forecast en vivo (WeatherAPI u Open-Meteo).
 */
async function climaFusionadoPronostico(ctx) {
  const base = Array.isArray(ctx.clima) ? ctx.clima : [];
  const hoyIso = fechaIsoHoyArgentina();
  const targets = [hoyIso, sumarDiasIso(hoyIso, 1), sumarDiasIso(hoyIso, 2)];
  const targetSet = new Set(targets);

  const by = new Map();
  for (const c of base) {
    const k = claveFechaClima(c);
    if (k) by.set(k, c);
  }

  const faltaAlguno = targets.some((t) => !by.has(t));
  if (!faltaAlguno) return base;

  const lat = ctx.perfil?.lat;
  const lng = ctx.perfil?.lng;
  if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return base;
  }

  try {
    const vivo = await obtenerClima(Number(lat), Number(lng));
    for (const row of vivo || []) {
      const k = claveFechaClima(row);
      if (!k) continue;
      if (targetSet.has(k)) {
        by.set(k, row);
      } else if (!by.has(k)) {
        by.set(k, row);
      }
    }
  } catch (e) {
    console.warn("[Resumen interactivo] obtenerClima (relleno pronóstico):", e.message);
  }

  return [...by.values()].sort((a, b) => claveFechaClima(a).localeCompare(claveFechaClima(b)));
}

function labelDiaPronostico(isoFila, isoHoy) {
  const manana = sumarDiasIso(isoHoy, 1);
  const pasado = sumarDiasIso(isoHoy, 2);
  let etiqueta;
  if (isoFila === isoHoy) etiqueta = "Hoy";
  else if (isoFila === manana) etiqueta = "Mañana";
  else if (isoFila === pasado) etiqueta = "Pasado mañana";
  else {
    const wd = new Intl.DateTimeFormat("es-AR", {
      timeZone: TZ_AR,
      weekday: "long",
    }).format(new Date(`${isoFila}T15:00:00-03:00`));
    etiqueta = wd.charAt(0).toUpperCase() + wd.slice(1);
  }
  const corta = new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ_AR,
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${isoFila}T15:00:00-03:00`));
  return `${etiqueta} (${corta})`;
}

async function generarBloquePronostico(ctx) {
  const clima = await climaFusionadoPronostico(ctx);
  const partido = ctx.perfil?.partido || "tu zona";
  const hoyIso = fechaIsoHoyArgentina();
  const targets = [hoyIso, sumarDiasIso(hoyIso, 1), sumarDiasIso(hoyIso, 2)];
  const by = new Map();
  for (const c of clima || []) {
    const k = claveFechaClima(c);
    if (k && !by.has(k)) by.set(k, c);
  }
  const lineas = [
    `🌤️ *Pronóstico en ${partido}*`,
    "_Próximos 3 días calendario (Argentina): hoy, mañana y pasado mañana._",
    "━━━━━━━━━━━━━━━━━",
  ];
  const diasConDatos = [];
  for (const iso of targets) {
    const d = by.get(iso);
    if (d) {
      diasConDatos.push(d);
      const desc = d.descripcion || "s/d";
      const min = Number.isFinite(Number(d.temp_min)) ? Math.round(Number(d.temp_min)) : "s/d";
      const max = Number.isFinite(Number(d.temp_max)) ? Math.round(Number(d.temp_max)) : "s/d";
      const mmRaw = Number(d.precipitacion);
      const mm = Number.isFinite(mmRaw) ? mmRaw.toFixed(1) : "0";
      lineas.push(`${labelDiaPronostico(iso, hoyIso)}: ${desc} · ${min}°/${max}° · ${mm}mm`);
    } else {
      lineas.push(
        `${labelDiaPronostico(iso, hoyIso)}: sin dato (ni base ni pronóstico en vivo para esta fecha).`
      );
    }
  }
  if (diasConDatos.some((d) => d.helada)) {
    lineas.push("⚠️ Riesgo de helada en el período.");
  }
  return lineas.join("\n");
}

async function generarDatosClavePorProducto(ctx) {
  const rubrosDetalle = [];
  for (const m of ctx.metricas || []) {
    const ars = Number(m.precio_ars);
    const usd = Number(m.precio_usd);
    const varArs = m.variacion_ars;
    rubrosDetalle.push({
      tipo: "cultivo",
      nombre: m.cultivo,
      precio_ars: Number.isFinite(ars) && ars > 0 ? ars : null,
      precio_usd: Number.isFinite(usd) && usd > 0 ? usd : null,
      variacion_ars_dia: Number.isFinite(Number(varArs)) ? Number(varArs) : null,
      hectareas: m.hectareas,
      costo_por_ha: m.costo_por_ha,
      margen_estimado_ars_ha: Number.isFinite(Number(m.margen_estimado)) ? m.margen_estimado : null,
      futuros: futurosPorCultivo(ctx.futuros, m.cultivo).map((f) => ({
        posicion: f.posicion,
        precio_usd: Number(f.precio_usd),
        variacion: f.variacion,
      })),
    });
  }
  const tipoPerfil = String(ctx.perfil?.perfil_productivo || "agricultura").toLowerCase();
  let refHacienda = null;
  if (tipoPerfil === "ganaderia" || tipoPerfil === "mixto") {
    refHacienda = await obtenerReferenciaHacienda(ctx.perfil.id);
    if (refHacienda?.categoria) {
      rubrosDetalle.push({
        tipo: "hacienda",
        nombre: refHacienda.categoria,
        precio_ars_kg: Number.isFinite(refHacienda.precio_kg) ? refHacienda.precio_kg : null,
        senal: refHacienda.senal,
      });
    }
  }
  if (!rubrosDetalle.length) {
    return (
      "🔑 *Datos clave de hoy*\n" +
      "Cargá cultivos o categorías ganaderas en tu perfil para personalizar este bloque."
    );
  }

  const brecha = brechaOficialBluePct(ctx);
  const snapshot = {
    zona: `${ctx.perfil?.partido || ""}, ${ctx.perfil?.provincia || ""}`.trim(),
    tipo_comercializacion: ctx.perfil?.tipo_comercializacion || "disponible",
    brecha_oficial_vs_blue_pct: brecha,
    rubros: rubrosDetalle,
  };

  const system = `Sos analista senior de mercado AgroHabilis (Argentina). El usuario YA vio en WhatsApp precios referenciales y dólar (compra/venta): NO repitas esos importes ni hagas listados de precios.

Tarea: para cada rubro del JSON, en el MISMO ORDEN, exactamente UNA línea con formato:
*Nombre del rubro:* análisis breve y sustentado en los datos del JSON (variación diaria en ARS si existe, spread vs futuro si hay futuros, margen vs costo si hay hectáreas/costo, señal ganadera si aplica, brecha cambiaria si aporta al encadenamiento comercial).

Reglas estrictas:
- PROHIBIDO texto genérico tipo "permanece estable en la zona de X" sin conectar con un número o mecanismo del JSON.
- PROHIBIDO párrafo final tipo "Nota:", "No se encontraron fuentes", "consultá fuentes generales".
- Si un cultivo no tiene precio (null): proponé UNA acción operativa concreta (logística, calidad, plaza alternativa) sin inventar cifras.
- Máximo 155 caracteres por línea después de "*Rubro:*".
- Solo líneas *Rubro:* ... sin viñetas adicionales.`;

  const user = `Datos JSON (usá solo esto + conocimiento general de mercado, sin inventar precios nuevos):\n${JSON.stringify(
    snapshot,
    null,
    2
  )}`;

  try {
    const ia = await generarConPromptLibre({ system, user });
    const txt = sanitizarSalidaDatosClave(String(ia?.texto || "").trim());
    if (txt) return `🔑 *Datos clave de hoy*\n${txt.slice(0, 2200)}`;
  } catch (e) {
    console.warn("[Resumen interactivo] Datos clave IA:", e.message);
  }

  const fallback = rubrosDetalle
    .map((r) => {
      if (r.tipo === "cultivo" && Number.isFinite(r.variacion_ars_dia)) {
        const dir = r.variacion_ars_dia > 0 ? "subió" : r.variacion_ars_dia < 0 ? "bajó" : "igual";
        return `*${r.nombre}:* El disponible ${dir} respecto del cierre previo en base (sin dato de plaza puntual).`;
      }
      if (r.tipo === "hacienda" && r.senal) {
        return `*${r.nombre}:* Señal ${r.senal}: conviene cruzar con faena/plaza y arbitraje de categoría antes de cerrar.`;
      }
      return `*${r.nombre}:* Revisá plaza y calidad antes de cerrar; el mercado viene con volatilidad.`;
    })
    .join("\n");
  return `🔑 *Datos clave de hoy*\n${fallback}`;
}

const limpiarTituloNoticia = (txt = "") =>
  String(txt || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const DELIM_NOTICIA = "###AGRO_NOT###";

/**
 * Parte texto del grounding en hasta 3 bloques usando el delimitador pedido al modelo.
 */
function parsearBloquesNoticiasGrounding(texto) {
  const raw = String(texto || "").trim();
  if (!raw) return [];
  const partes = raw
    .split(DELIM_NOTICIA)
    .map((s) => s.trim())
    .filter(Boolean);
  return partes.slice(0, 3);
}

function formatearItemNoticia(i, bloque) {
  const lineas = bloque.split("\n").map((l) => l.trim()).filter(Boolean);
  const tit = lineas[0] || "Sin título";
  let fuente = "web";
  let bajadaStart = 1;
  const idxFuente = lineas.findIndex((l) => /^fuente\s*:/i.test(l));
  if (idxFuente >= 0) {
    fuente = lineas[idxFuente].replace(/^fuente\s*:\s*/i, "").trim() || fuente;
    bajadaStart = idxFuente + 1;
  }
  const idxBaj = lineas.findIndex((l) => /^bajada\s*:/i.test(l));
  let bajada;
  if (idxBaj >= 0) {
    bajada = lineas.slice(idxBaj).join("\n").replace(/^bajada\s*:\s*/i, "").trim();
  } else {
    bajada = lineas.slice(bajadaStart).join("\n").trim() || "Sin bajada.";
  }
  return [`*${i + 1}. ${tit}* (${fuente})`, limpiarTituloNoticia(bajada).slice(0, 520), ""].join("\n");
}

async function noticiasDesdeRadar(datos, max = 3) {
  const perfilTipo = String(datos.perfil?.perfil_productivo || "agricultura").toLowerCase();
  const { noticias } = await obtenerRadarWeb({
    perfilTipo,
    cultivos: datos.cultivos || [],
  });
  return (noticias || []).slice(0, max);
}

async function generarBloqueNoticias(_usuarioId, datos) {
  const cultivosTxt =
    (datos.cultivos || []).map((c) => c.cultivo).filter(Boolean).join(", ") || "mercado agro argentino";
  const zona = `${datos.perfil?.partido || ""}, ${datos.perfil?.provincia || "Argentina"}`.trim();

  let bloquesGrounding = [];
  if (groundingHabilitadoParaResumen()) {
    try {
      const prompt = [
        "Usá Google Search (navegación web real).",
        `Buscá 3 noticias agropecuarias MUY recientes (ideal últimas 24-72 h) relevantes para un productor en: ${zona}.`,
        `Productos/cultivos de interés: ${cultivosTxt}.`,
        "Evitá tres veces el mismo tipo de artículo SEO de \"precio X en Rosario hoy\"; priorizá diversidad: política, clima agro, hacienda, logística, internacional si impacta.",
        "Cada noticia: titular distinto, medio distinto si podés.",
        "",
        "Respondé SOLO con el contenido de las 3 noticias, sin introducción ni cierre.",
        `Separá cada noticia con una línea que contenga EXACTAMENTE: ${DELIM_NOTICIA}`,
        "Formato INTERNO de cada bloque (texto plano):",
        "Primera línea: titular breve.",
        "Segunda línea: Fuente: nombre del sitio o diario.",
        "Siguientes líneas: Bajada: 2 a 4 oraciones con el hecho concreto (quién, qué, cuándo, impacto).",
        "",
        "Ejemplo de estructura (sin copiar el ejemplo):",
        `${DELIM_NOTICIA}`,
        "...",
      ].join("\n");

      const g = await generarConGroundingGoogleSearch({
        prompt,
        contextLabel: "resumen_interactivo.noticias_google",
      });
      bloquesGrounding = parsearBloquesNoticiasGrounding(g.texto);
    } catch (e) {
      console.warn("[Resumen interactivo] Noticias Google grounding:", e.message);
    }
  }

  const radar = await noticiasDesdeRadar(datos, 6);
  const armarDesdeRadar = (arr) => {
    const lineas = ["📰 *Tres noticias para vos*", "━━━━━━━━━━━━━━━━━"];
    for (let i = 0; i < Math.min(3, arr.length); i += 1) {
      const n = arr[i];
      const tit = limpiarTituloNoticia(n.titulo || "Sin título");
      const bajada = limpiarTituloNoticia(n.resumen || "Sin bajada en la fuente.").slice(0, 520);
      lineas.push(`*${i + 1}. ${tit}* (${n.fuente || "agro"})`, bajada, "");
    }
    return lineas.join("\n").trim();
  };

  if (!bloquesGrounding.length) {
    if (!radar.length) {
      return "📰 *Noticias*\nNo pude obtener titulares (ni web ni base). Probá más tarde.";
    }
    return armarDesdeRadar(radar);
  }

  const lineasOut = ["📰 *Tres noticias para vos*", "_Búsqueda web (Google vía Gemini)._", "━━━━━━━━━━━━━━━━━"];
  for (let i = 0; i < bloquesGrounding.length; i += 1) {
    lineasOut.push(formatearItemNoticia(i, bloquesGrounding[i]));
  }

  let idxRadar = 0;
  while (lineasOut.filter((l) => /^\*\d+\./.test(l)).length < 3 && idxRadar < radar.length) {
    const n = radar[idxRadar];
    idxRadar += 1;
    const tit = limpiarTituloNoticia(n.titulo || "");
    if (!tit || bloquesGrounding.some((b) => b.includes(tit.slice(0, 40)))) continue;
    const i = lineasOut.filter((l) => /^\*\d+\./.test(l)).length;
    if (i >= 3) break;
    const bajada = limpiarTituloNoticia(n.resumen || "Sin bajada.").slice(0, 520);
    lineasOut.push(`*${i + 1}. ${tit}* (${n.fuente || "agro"})`, bajada, "");
  }

  let texto = lineasOut.join("\n").trim();
  // No anexar redirects de Vertex (kilométricos e inútiles en WhatsApp); el titular ya suele traer el medio.
  texto = String(texto || "")
    .split("\n")
    .filter((line) => !/https?:\/\/vertexaisearch\.cloud\.google\.com/i.test(line.trim()))
    .join("\n")
    .trim();
  return texto.slice(0, 3900);
}

function generarBloqueQuePuedoHacer(usuario) {
  const bullets = [
    "💡 *¿Qué más puedo hacer por vos?*",
    "━━━━━━━━━━━━━━━━━",
    "- Responder *preguntas de mercado*",
    "- *Cruzar* datos públicos y climatológicos con los de tu campo",
    "- *Registrar* labores, stock de hacienda y movimientos en tus lotes",
    "- *Programar alertas* de precio de granos y hacienda",
  ];

  const detalle = [
    "",
    "*Preguntas de mercado:*",
    "→ ¿Conviene vender soja esta semana?",
    "→ ¿Cómo viene el maíz en Chicago?",
    "",
    "*Cruzar datos:*",
    "→ Con mi costo de siembra, ¿a qué precio recupero la inversión?",
    "→ Si el dólar sube 5%, ¿cómo me afecta el margen?",
    "",
    "*Registrar tu campo:*",
    "→ Hay 45 vacas en el lote norte",
    "→ Sembré 80 kg de semilla de trigo en el lote 2",
    "→ Apliqué glifosato en 50 hectáreas",
    "",
    "*Alertas de precio:*",
    "→ Avisame cuando la soja supere $440.000",
    "→ Alerta si el novillo baja de $4.500/kg",
  ];

  return `${bullets.join("\n")}\n${detalle.join("\n")}`;
}

const partesYaIncluyenQuePuedoHacer = (partes) =>
  (partes || []).some((p) => String(p).includes("¿Qué más puedo hacer"));

async function persistirResumenFinal(usuarioId, partes) {
  const texto = (partes || []).filter(Boolean).join("\n\n──────────────\n\n");
  const guardado = await guardarResumen({
    usuarioId,
    texto,
    tokensUsados: null,
  });
  await marcarResumenEnviado(guardado.id);
  return guardado.id;
}

const PAUSA_ENTRE_MS = 1200;

function textoInvitacionResumen(nombre) {
  const n = nombre || "productor";
  return [
    `Hola *${n}* 👋`,
    "Ya tenés tu resumen de hoy listo.",
    "¿Lo recibís? *(sí / no)*",
  ].join("\n");
}

/** Solo guarda el flujo en DB. La marca “invitación ya enviada hoy” la pone `marcarInvitacionResumenHoy` tras un envío real. */
async function registrarEstadoInvitacionResumen(usuario, options = {}) {
  if (!usuario?.id) return;
  const whatsappNorm = String(usuario.whatsapp || "").replace(/\D/g, "");
  if (!whatsappNorm) return;
  await guardarEstado(
    whatsappNorm,
    "resumen_interactivo",
    "esperando_confirmacion",
    { usuario_id: usuario.id },
    options.horasExpiracion ?? HORAS_EXPIRACION_RESUMEN_INTERACTIVO
  );
}

/**
 * @param {object} usuario fila usuarios (id, nombre, whatsapp, plan, plan_activo_hasta)
 * @param {{ enviar: (texto: string) => Promise<unknown>, horasExpiracion?: number }} options
 * @returns {Promise<{ omitido: boolean, motivo?: string }>}
 */
async function iniciarResumen(usuario, options = {}) {
  const enviar = options.enviar;
  if (typeof enviar !== "function") {
    throw new Error("iniciarResumen: se requiere options.enviar(texto)");
  }
  if (await usuarioPendienteRespuestaOnboarding(usuario)) {
    console.log(
      `[resumen_interactivo] Omito invitación usuario_id=${usuario.id}: onboarding o COMPLETAR PERFIL pendiente`
    );
    return { omitido: true, motivo: "onboarding_pendiente" };
  }
  const texto = textoInvitacionResumen(usuario.nombre);
  await enviar(texto);
  await marcarInvitacionResumenHoy(usuario.id);
  await registrarEstadoInvitacionResumen(usuario, {
    horasExpiracion: options.horasExpiracion,
  });
  return { omitido: false };
}

/**
 * @returns {Promise<boolean>} true si el mensaje quedó en este flujo
 */
async function procesarRespuestaResumen({ whatsapp, mensaje, enviar }) {
  if (typeof enviar !== "function") return false;
  const wa = String(whatsapp || "").replace(/\D/g, "");
  if (!wa) return false;

  const estado = await obtenerEstado(wa);
  if (!estado || estado.flujo !== "resumen_interactivo") return false;

  const paso = estado.paso;
  const ctxJson = estado.contexto && typeof estado.contexto === "object" ? estado.contexto : {};
  const usuarioId = ctxJson.usuario_id;
  if (!usuarioId) {
    await enviar(
      "Hubo un problema con el resumen guiado. Escribí de nuevo *MI RESUMEN* para arrancar."
    );
    await limpiarEstado(wa);
    return true;
  }

  const rUsuario = await query(
    `
      SELECT id, nombre, plan, plan_activo_hasta, whatsapp
      FROM usuarios
      WHERE id = $1
      LIMIT 1
    `,
    [usuarioId]
  );
  const usuario = rUsuario.rows[0];
  if (!usuario) {
    await enviar(
      "No encontré tu usuario para seguir el resumen. Escribí *MI RESUMEN* cuando quieras."
    );
    await limpiarEstado(wa);
    return true;
  }

  if (paso === "esperando_confirmacion") {
    if (esNegativo(mensaje)) {
      await enviar("Cuando quieras pedilo escribiendo *MI RESUMEN* 👋");
      await sleep(PAUSA_ENTRE_MS);
      const que = generarBloqueQuePuedoHacer(usuario);
      await enviar(que);
      await persistirResumenFinal(usuarioId, [
        "(Resumen no solicitado en el primer paso.)",
        que,
      ]);
      await limpiarEstado(wa);
      return true;
    }
    if (!esAfirmativo(mensaje)) {
      if (await mensajeTieneIntencionFueraDelFlujoResumen(mensaje, usuario)) {
        await limpiarEstado(wa);
        await enviar(TEXTO_PAUSA_RESUMEN);
        return false;
      }
      await enviar("Para seguir, respondé *sí* o *no* (¿querés el resumen de hoy?).");
      return true;
    }

    const datos = await prepararDatosResumenInteractivo(usuarioId);
    if (!datos) {
      await enviar("No pude armar tu resumen ahora. Probá *MI RESUMEN* en unos minutos.");
      await limpiarEstado(wa);
      return true;
    }

    const partes = [];
    const bPrecios = await generarBloquePreciosUsuario(datos);
    partes.push(bPrecios);
    await enviar(bPrecios);
    await sleep(PAUSA_ENTRE_MS);

    const bDato = await generarDatosClavePorProducto(datos);
    partes.push(bDato);
    await enviar(bDato);
    await sleep(PAUSA_ENTRE_MS);

    const zona = datos.perfil?.partido || "tu zona";
    const preguntaProno = `¿Querés el *pronóstico* para *hoy, mañana y pasado mañana* en ${zona}? *(sí / no)*`;
    partes.push(preguntaProno);
    await enviar(preguntaProno);

    await guardarEstado(
      wa,
      "resumen_interactivo",
      "esperando_pronostico",
      {
        usuario_id: usuarioId,
        partesResumen: partes,
      },
      HORAS_EXPIRACION_RESUMEN_INTERACTIVO
    );
    return true;
  }

  if (paso === "esperando_pronostico") {
    let partes = Array.isArray(ctxJson.partesResumen) ? [...ctxJson.partesResumen] : [];

    if (esAfirmativo(mensaje)) {
      const datos = await prepararDatosResumenInteractivo(usuarioId);
      const pro = datos ? await generarBloquePronostico(datos) : "🌤️ *Pronóstico*\nSin datos.";
      partes.push(pro);
      await enviar(pro);
      await sleep(PAUSA_ENTRE_MS);
    } else if (esNegativo(mensaje)) {
      partes.push("(Pronóstico no solicitado.)");
      const que = generarBloqueQuePuedoHacer(usuario);
      partes.push(que);
      await enviar(que);
      await sleep(PAUSA_ENTRE_MS);
    } else {
      if (await mensajeTieneIntencionFueraDelFlujoResumen(mensaje, usuario)) {
        await persistirResumenFinal(usuarioId, [
          ...partes,
          "(Resumen interrumpido: el usuario cambió de tema.)",
        ]);
        await limpiarEstado(wa);
        await enviar(TEXTO_PAUSA_RESUMEN);
        return false;
      }
      await enviar("Respondé *sí* para el pronóstico (hoy + 2 días), o *no* para saltearlo.");
      return true;
    }

    const preguntaNoti =
      "¿Querés un *resumen de noticias* con *3 titulares* y su *bajada* (prioridad a tus productos)? *(sí / no)*";
    partes.push(preguntaNoti);
    await enviar(preguntaNoti);

    await guardarEstado(
      wa,
      "resumen_interactivo",
      "esperando_noticias",
      { usuario_id: usuarioId, partesResumen: partes },
      HORAS_EXPIRACION_RESUMEN_INTERACTIVO
    );
    return true;
  }

  if (paso === "esperando_noticias") {
    let partes = Array.isArray(ctxJson.partesResumen) ? [...ctxJson.partesResumen] : [];

    if (esAfirmativo(mensaje)) {
      const datos = await prepararDatosResumenInteractivo(usuarioId);
      const bloque = datos
        ? await generarBloqueNoticias(usuarioId, datos)
        : "📰 *Noticias*\nSin datos.";
      partes.push(bloque);
      await enviar(bloque);
      await sleep(PAUSA_ENTRE_MS);
    } else if (esNegativo(mensaje)) {
      partes.push("(Noticias no solicitadas.)");
    } else {
      if (await mensajeTieneIntencionFueraDelFlujoResumen(mensaje, usuario)) {
        await persistirResumenFinal(usuarioId, [
          ...partes,
          "(Resumen interrumpido en el paso de noticias: el usuario cambió de tema.)",
        ]);
        await limpiarEstado(wa);
        await enviar(TEXTO_PAUSA_RESUMEN);
        return false;
      }
      await enviar("Respondé *sí* para 3 noticias con bajada, o *no* para saltearlas.");
      return true;
    }

    if (!partesYaIncluyenQuePuedoHacer(partes)) {
      const que = generarBloqueQuePuedoHacer(usuario);
      partes.push(que);
      await enviar(que);
    }

    await persistirResumenFinal(usuarioId, partes);
    await limpiarEstado(wa);
    return true;
  }

  await limpiarEstado(wa);
  return true;
}

module.exports = {
  iniciarResumen,
  textoInvitacionResumen,
  registrarEstadoInvitacionResumen,
  procesarRespuestaResumen,
  generarBloquePreciosUsuario,
  generarBloquePronostico,
  generarDatosClavePorProducto,
  /** @deprecated usar generarDatosClavePorProducto */
  generarDatoClave: generarDatosClavePorProducto,
  generarBloqueNoticias,
  generarBloqueQuePuedoHacer,
  esAfirmativo,
  esNegativo,
  mensajeTieneIntencionFueraDelFlujoResumen,
};
