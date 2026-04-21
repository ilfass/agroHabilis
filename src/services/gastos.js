const { query } = require("../config/database");
const { buscarPorWhatsapp } = require("../models/usuario");
const { generarConPromptLibre } = require("./gemini");

const normalizar = (txt = "") =>
  String(txt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const parseMonto = (txt = "") => {
  const m = String(txt).match(/(\d[\d\.\,]*)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const hoy = () => new Date().toISOString().slice(0, 10);
const normalizarPerfil = (v = "") => {
  const t = normalizar(v);
  if (t.includes("ganad")) return "ganaderia";
  return "agricultura";
};

const extraerJson = (texto = "") => {
  const match = String(texto).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_e) {
    return null;
  }
};

const parseoFallbackGasto = (texto = "") => {
  const t = normalizar(texto);
  const monto = parseMonto(texto);
  if (!Number.isFinite(monto)) return null;
  const perfil = /(veterin|vacuna|aliment|ganad|novill|terner|vaca)/.test(t)
    ? "ganaderia"
    : "agricultura";
  let categoria = "otro";
  if (t.includes("semilla")) categoria = "semilla";
  if (t.includes("fertiliz")) categoria = "fertilizante";
  if (t.includes("glifosato") || t.includes("agroquim")) categoria = "agroquimico";
  if (t.includes("arrend")) categoria = "arrendamiento";
  if (t.includes("flete")) categoria = "flete";
  if (t.includes("veterin")) categoria = "veterinario";
  if (t.includes("vacuna") || t.includes("sanidad")) categoria = "sanidad";
  if (t.includes("aliment")) categoria = "alimentacion";
  return {
    perfil,
    categoria,
    descripcion: texto.trim().slice(0, 220),
    monto,
    moneda: "ARS",
    fecha: hoy(),
  };
};

const parseoFallbackVenta = (texto = "") => {
  const t = normalizar(texto);
  const nums = String(texto).match(/\d[\d\.\,]*/g) || [];
  const values = nums
    .map((n) => Number(String(n).replace(/\./g, "").replace(",", ".")))
    .filter((n) => Number.isFinite(n));
  const cantidad = values[0] || null;
  const precioUnitario = values[1] || values[0] || null;
  const productoMatch =
    t.match(/soja|maiz|trigo|girasol|novillo|ternero|vaca|toro|vaquillona/) || [];
  const producto = productoMatch[0] || "producto";
  const unidad = t.includes("ton") ? "toneladas" : t.includes("cabeza") ? "cabezas" : "kg";
  const perfil =
    /(novill|terner|vaca|toro|vaquill)/.test(producto) || /(ganad)/.test(t)
      ? "ganaderia"
      : "agricultura";
  const montoTotal =
    Number.isFinite(cantidad) && Number.isFinite(precioUnitario)
      ? Number((cantidad * precioUnitario).toFixed(2))
      : precioUnitario;
  return {
    perfil,
    producto,
    cantidad,
    unidad,
    precio_unitario: precioUnitario,
    monto_total: montoTotal,
    moneda: "ARS",
    fecha: hoy(),
  };
};

const parsearConIA = async ({ texto, tipo }) => {
  const schema =
    tipo === "gasto"
      ? `{
  "perfil": "agricultura|ganaderia",
  "categoria": "semilla|fertilizante|agroquimico|labor|flete|arrendamiento|sanidad|alimentacion|veterinario|otro",
  "descripcion": "string",
  "monto": 123,
  "moneda": "ARS",
  "fecha": "YYYY-MM-DD"
}`
      : `{
  "perfil": "agricultura|ganaderia",
  "producto": "string",
  "cantidad": 10,
  "unidad": "toneladas|kg|cabezas",
  "precio_unitario": 123,
  "monto_total": 1230,
  "moneda": "ARS",
  "fecha": "YYYY-MM-DD"
}`;

  const ia = await generarConPromptLibre({
    system:
      "Extraes datos estructurados desde texto de productor agro argentino. Respondes SOLO JSON valido sin markdown.",
    user: `Texto: "${texto}"\nFecha actual: ${hoy()}\nDevuelve JSON con este esquema:\n${schema}`,
  });
  return extraerJson(ia.texto);
};

const registrarGasto = async (whatsapp, texto) => {
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario) return "No encontré tu usuario. Completá onboarding primero.";

  let data = null;
  try {
    data = await parsearConIA({ texto, tipo: "gasto" });
  } catch (_e) {
    data = null;
  }
  if (!data) data = parseoFallbackGasto(texto);
  if (!data || !Number.isFinite(Number(data.monto))) {
    return "No pude interpretar el gasto. Probá con: 'gasté 250000 en semilla'.";
  }

  await query(
    `
      INSERT INTO gastos (usuario_id, perfil, categoria, descripcion, monto, moneda, fecha)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      usuario.id,
      normalizarPerfil(data.perfil),
      String(data.categoria || "otro").slice(0, 50),
      data.descripcion || texto.slice(0, 220),
      Number(data.monto),
      data.moneda || "ARS",
      data.fecha || hoy(),
    ]
  );

  const perfilNormalizado = normalizarPerfil(data.perfil);
  return `✅ Gasto registrado: ${data.categoria || "otro"} - $${Number(data.monto).toLocaleString(
    "es-AR"
  )} (${perfilNormalizado}).`;
};

const registrarVenta = async (whatsapp, texto) => {
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario) return "No encontré tu usuario. Completá onboarding primero.";

  let data = null;
  try {
    data = await parsearConIA({ texto, tipo: "venta" });
  } catch (_e) {
    data = null;
  }
  if (!data) data = parseoFallbackVenta(texto);
  if (!data || !Number.isFinite(Number(data.monto_total))) {
    return "No pude interpretar la venta. Probá con: 'vendí 100 toneladas de soja a 430000'.";
  }

  await query(
    `
      INSERT INTO ventas (
        usuario_id, perfil, producto, cantidad, unidad, precio_unitario, monto_total, moneda, fecha
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [
      usuario.id,
      normalizarPerfil(data.perfil),
      String(data.producto || "producto").slice(0, 50),
      data.cantidad || null,
      String(data.unidad || "kg").slice(0, 20),
      data.precio_unitario || null,
      data.monto_total,
      data.moneda || "ARS",
      data.fecha || hoy(),
    ]
  );

  const perfilNormalizado = normalizarPerfil(data.perfil);
  return `✅ Venta registrada: ${data.producto || "producto"} - $${Number(
    data.monto_total
  ).toLocaleString("es-AR")} (${perfilNormalizado}).`;
};

const obtenerResumenFinanciero = async (usuarioId) => {
  const [gastos, ventas, desglose] = await Promise.all([
    query(
      `
        SELECT perfil, COALESCE(SUM(monto),0)::numeric(14,2) AS total
        FROM gastos
        WHERE usuario_id = $1 AND date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)
        GROUP BY perfil
      `,
      [usuarioId]
    ),
    query(
      `
        SELECT perfil, COALESCE(SUM(monto_total),0)::numeric(14,2) AS total
        FROM ventas
        WHERE usuario_id = $1 AND date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)
        GROUP BY perfil
      `,
      [usuarioId]
    ),
    query(
      `
        SELECT categoria, COALESCE(SUM(monto),0)::numeric(14,2) AS total
        FROM gastos
        WHERE usuario_id = $1 AND date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)
        GROUP BY categoria
        ORDER BY total DESC
      `,
      [usuarioId]
    ),
  ]);

  const porPerfil = { agricultura: { gastos: 0, ventas: 0 }, ganaderia: { gastos: 0, ventas: 0 } };
  for (const r of gastos.rows) porPerfil[r.perfil] = { ...(porPerfil[r.perfil] || {}), gastos: Number(r.total) };
  for (const r of ventas.rows) porPerfil[r.perfil] = { ...(porPerfil[r.perfil] || {}), ventas: Number(r.total) };

  const ref = await query(
    `
      SELECT categoria, producto, precio, unidad, fecha
      FROM precios_insumos
      WHERE fecha = (SELECT MAX(fecha) FROM precios_insumos)
      ORDER BY categoria, producto
      LIMIT 10
    `
  );

  const resumen = Object.entries(porPerfil).map(([perfil, vals]) => ({
    perfil,
    gastos: Number(vals.gastos || 0),
    ventas: Number(vals.ventas || 0),
    margen: Number((Number(vals.ventas || 0) - Number(vals.gastos || 0)).toFixed(2)),
  }));

  return {
    porPerfil: resumen,
    desgloseCategorias: desglose.rows.map((r) => ({ categoria: r.categoria, total: Number(r.total) })),
    referenciasInsumos: ref.rows.map((r) => ({
      categoria: r.categoria,
      producto: r.producto,
      precio: Number(r.precio),
      unidad: r.unidad,
      fecha: r.fecha,
    })),
  };
};

const obtenerTextoMisGastos = async (whatsapp) => {
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario) return "No encontré tu usuario.";
  const result = await query(
    `
      SELECT categoria, COALESCE(SUM(monto),0)::numeric(14,2) AS total
      FROM gastos
      WHERE usuario_id = $1 AND date_trunc('month', fecha)=date_trunc('month', CURRENT_DATE)
      GROUP BY categoria
      ORDER BY total DESC
    `,
    [usuario.id]
  );
  if (!result.rows.length) return "No tenés gastos registrados este mes.";
  return [
    "📒 *Tus gastos del mes*",
    ...result.rows.map((r) => `- ${r.categoria}: $${Number(r.total).toLocaleString("es-AR")}`),
  ].join("\n");
};

const obtenerTextoMisVentas = async (whatsapp) => {
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario) return "No encontré tu usuario.";
  const result = await query(
    `
      SELECT producto, COALESCE(SUM(monto_total),0)::numeric(14,2) AS total
      FROM ventas
      WHERE usuario_id = $1 AND date_trunc('month', fecha)=date_trunc('month', CURRENT_DATE)
      GROUP BY producto
      ORDER BY total DESC
    `,
    [usuario.id]
  );
  if (!result.rows.length) return "No tenés ventas registradas este mes.";
  return [
    "💸 *Tus ventas del mes*",
    ...result.rows.map((r) => `- ${r.producto}: $${Number(r.total).toLocaleString("es-AR")}`),
  ].join("\n");
};

const obtenerTextoMiMargen = async (whatsapp) => {
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario) return "No encontré tu usuario.";
  const r = await obtenerResumenFinanciero(usuario.id);
  return [
    "📊 *Resumen financiero mensual*",
    ...r.porPerfil.map(
      (p) =>
        `- ${p.perfil}: gastos $${p.gastos.toLocaleString("es-AR")} | ventas $${p.ventas.toLocaleString(
          "es-AR"
        )} | margen $${p.margen.toLocaleString("es-AR")}`
    ),
    "",
    "*Desglose gastos:*",
    ...(r.desgloseCategorias.length
      ? r.desgloseCategorias.map((d) => `- ${d.categoria}: $${d.total.toLocaleString("es-AR")}`)
      : ["- Sin gastos cargados"]),
  ].join("\n");
};

module.exports = {
  registrarGasto,
  registrarVenta,
  obtenerResumenFinanciero,
  obtenerTextoMisGastos,
  obtenerTextoMisVentas,
  obtenerTextoMiMargen,
};
