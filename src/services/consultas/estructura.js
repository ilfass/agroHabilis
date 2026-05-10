"use strict";

const normMinDefault = (texto = "") =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const extraerPosicionesSolicitadas = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMinDefault;
  const t = norm(texto);
  const posiciones = [];
  const mapping = [
    { re: /\bdic(iembre)?\b/, mes: 12 },
    { re: /\babr(il)?\b/, mes: 4 },
    { re: /\bmay(o)?\b/, mes: 5 },
    { re: /\bjun(io)?\b/, mes: 6 },
    { re: /\bjul(io)?\b/, mes: 7 },
  ];
  for (const m of mapping) {
    if (m.re.test(t)) posiciones.push(m.mes);
  }
  return [...new Set(posiciones)];
};

const responderEstructuraMercado = async ({
  pregunta = "",
  cultivoHint = null,
  detectarCultivoEnTextoFn,
  extraerPosicionesSolicitadasFn,
  calcularEstructuraMercadoFn,
} = {}) => {
  if (typeof calcularEstructuraMercadoFn !== "function") return null;
  const detectarCultivoEnTexto =
    typeof detectarCultivoEnTextoFn === "function" ? detectarCultivoEnTextoFn : () => null;
  const extraerPosicionesSolicitadas =
    typeof extraerPosicionesSolicitadasFn === "function" ? extraerPosicionesSolicitadasFn : () => [];
  const cultivo = cultivoHint || detectarCultivoEnTexto(pregunta);
  if (!cultivo) return null;
  const mesesSolicitados = extraerPosicionesSolicitadas(pregunta);
  return calcularEstructuraMercadoFn({
    producto: cultivo,
    mesesSolicitados,
    sanityPct: 30,
  });
};

const monthMap = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const parseFechaConsulta = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMinDefault;
  const t = norm(texto);
  const iso = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
  const dmY = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dmY) {
    const dd = Number(dmY[1]);
    const mm = Number(dmY[2]);
    const yy = dmY[3] ? Number(dmY[3].length === 2 ? `20${dmY[3]}` : dmY[3]) : new Date().getFullYear();
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  const m1 = t.match(/\b([a-záéíóúñ]+)\s+(\d{1,2})\b/);
  if (m1 && monthMap[m1[1]]) {
    const mm = monthMap[m1[1]];
    const dd = Number(m1[2]);
    const yy = new Date().getFullYear();
    return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  const m2 = t.match(/\b(\d{1,2})\s+de?\s*([a-záéíóúñ]+)\b/);
  if (m2 && monthMap[m2[2]]) {
    const mm = monthMap[m2[2]];
    const dd = Number(m2[1]);
    const yy = new Date().getFullYear();
    return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  return null;
};

const obtenerTcImplicitoDia = async (fechaISO = null, { queryFn, toISODateParamFn } = {}) => {
  const query = typeof queryFn === "function" ? queryFn : async () => ({ rows: [] });
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : () => null;
  const fecha =
    fechaISO || toISODateParam((await query("SELECT MAX(fecha) AS fecha FROM tipo_cambio")).rows[0]?.fecha);
  if (!fecha) return null;
  const r = await query(
    `
      SELECT tipo, valor
      FROM tipo_cambio
      WHERE fecha = $1::date
      ORDER BY CASE WHEN LOWER(tipo) IN ('bolsa','mep') THEN 0 ELSE 1 END, tipo
      LIMIT 1
    `,
    [fecha]
  );
  const row = r.rows[0];
  if (!row) return null;
  return { tipo: String(row.tipo || "mep").toUpperCase(), valor: Number(row.valor), fecha };
};

const obtenerDisponibleRosario = async (cultivo = "", { obtenerDisponiblePoliticaResumenUnCultivoFn } = {}) => {
  const obtenerDisponiblePoliticaResumenUnCultivo =
    typeof obtenerDisponiblePoliticaResumenUnCultivoFn === "function"
      ? obtenerDisponiblePoliticaResumenUnCultivoFn
      : async () => null;
  const row = await obtenerDisponiblePoliticaResumenUnCultivo(cultivo);
  if (!row) return null;
  return {
    mercado: row.mercado,
    precio: row.precio,
    moneda: row.moneda,
    fecha: row.fecha,
  };
};

const obtenerFuturoCercano = async (cultivo = "", { queryFn, toISODateParamFn } = {}) => {
  const query = typeof queryFn === "function" ? queryFn : async () => ({ rows: [] });
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : () => null;
  const fecha = toISODateParam(
    (
      await query(`SELECT MAX(fecha) AS fecha FROM futuros_posiciones WHERE LOWER(cultivo)=LOWER($1)`, [cultivo])
    ).rows[0]?.fecha
  );
  if (!fecha) return null;
  const r = await query(
    `
      SELECT posicion, precio_usd, fecha
      FROM futuros_posiciones
      WHERE LOWER(cultivo)=LOWER($1)
        AND fecha = $2::date
      ORDER BY
        CASE
          WHEN LOWER(posicion) ~ '(may|mayo|jul|julio|jun|junio|abr|abril)' THEN 0
          ELSE 1
        END,
        posicion
      LIMIT 1
    `,
    [cultivo, fecha]
  );
  return r.rows[0] || null;
};

const construirBloqueEstructuraCultivo = (
  { cultivo, disp, fut, tc },
  { formatearMonedaFn, toISODateParamFn, etiquetaTipoCambioFn } = {}
) => {
  const formatearMoneda = typeof formatearMonedaFn === "function" ? formatearMonedaFn : (v) => String(v ?? "");
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : () => null;
  const etiquetaTipoCambio =
    typeof etiquetaTipoCambioFn === "function" ? etiquetaTipoCambioFn : (x) => String(x || "");

  const c = String(cultivo || "").toUpperCase();
  if (!disp && !fut) {
    return `${c}: sin referencia consistente de disponible/futuro hoy.`;
  }
  const spotArs = disp && String(disp.moneda || "").toUpperCase() === "ARS" ? Number(disp.precio) : null;
  const dispUsd = disp
    ? String(disp.moneda || "").toUpperCase() === "USD"
      ? Number(disp.precio)
      : Number.isFinite(Number(tc?.valor)) && tc.valor > 0
        ? Number(disp.precio) / Number(tc.valor)
        : null
    : null;
  const futUsd = fut ? Number(fut.precio_usd) : null;
  const spreadPct =
    Number.isFinite(dispUsd) && Number.isFinite(futUsd) && dispUsd !== 0
      ? ((futUsd - dispUsd) / dispUsd) * 100
      : null;
  const estructura = Number.isFinite(spreadPct)
    ? spreadPct > 0.6
      ? "carry"
      : spreadPct < -0.6
        ? "backwardation"
        : "neutral"
    : "s/d";
  const tcFin = Number.isFinite(Number(tc?.valor)) && tc.valor > 0 ? Number(tc.valor) : null;
  const implicitoFx =
    Number.isFinite(spotArs) && Number.isFinite(futUsd) && futUsd > 0 ? spotArs / futUsd : null;
  const implVsMepPct =
    Number.isFinite(implicitoFx) && Number.isFinite(tcFin) && tcFin > 0
      ? ((implicitoFx - tcFin) / tcFin) * 100
      : null;
  const fxTxt = Number.isFinite(implicitoFx)
    ? `${formatearMoneda(implicitoFx, "ARS")}/USD (spot ARS / futuro USD)`
    : "s/d";
  const compMep =
    Number.isFinite(implVsMepPct) && Number.isFinite(tcFin)
      ? `${Math.abs(implVsMepPct).toFixed(1)}% ${implVsMepPct < 0 ? "por debajo" : "por encima"} del ${etiquetaTipoCambio(tc?.tipo || "MEP")} (${formatearMoneda(tcFin, "ARS")})`
      : "s/d";
  return [
    `${c}:`,
    `- Spot disponible (misma referencia que tu resumen): ${disp ? `${String(disp.mercado || "").replace(/_/g, " ")} ${formatearMoneda(disp.precio, disp.moneda || "ARS")} · ${toISODateParam(disp.fecha)}` : "s/d"}`,
    `- Futuro MATBA cercano: ${fut ? `${String(fut.posicion || "s/d").toUpperCase()} = ${formatearMoneda(futUsd, "USD")}` : "s/d"}`,
    `- TC financiero (${etiquetaTipoCambio(tc?.tipo || "MEP")}): ${tc ? formatearMoneda(tc.valor, "ARS") : "s/d"}`,
    `- TC implícito del par spot/futuro: ${fxTxt}`,
    `- Lectura cambiaria: ${compMep} (negativo = grano barato en USD vs financiero; positivo = implícito arriba del MEP).`,
    `- Spread spot USD vs futuro: ${Number.isFinite(spreadPct) ? `${spreadPct.toFixed(1)}%` : "s/d"} (${estructura})`,
  ].join("\n");
};

const obtenerLecturaNovilloFeedlot = async ({ queryFn, toISODateParamFn, formatearMonedaFn } = {}) => {
  const query = typeof queryFn === "function" ? queryFn : async () => ({ rows: [] });
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : () => null;
  const formatearMoneda = typeof formatearMonedaFn === "function" ? formatearMonedaFn : (v) => String(v ?? "");

  const fecha = toISODateParam((await query("SELECT MAX(fecha) AS fecha FROM precios_hacienda")).rows[0]?.fecha);
  if (!fecha) return "NOVILLO: sin datos actualizados.";
  const rangoR = await query(
    `
      SELECT MIN(precio_promedio) AS min, MAX(precio_promedio) AS max, AVG(precio_promedio) AS prom
      FROM precios_hacienda
      WHERE fecha = $1::date
        AND LOWER(categoria) LIKE '%novill%'
    `,
    [fecha]
  );
  const semR = await query(
    `
      SELECT
        AVG(precio_promedio)::numeric(12,2) AS hoy,
        (
          SELECT AVG(precio_promedio)::numeric(12,2)
          FROM precios_hacienda
          WHERE LOWER(categoria) LIKE '%novill%'
            AND fecha >= $1::date - INTERVAL '7 days'
            AND fecha < $1::date
        ) AS prev
      FROM precios_hacienda
      WHERE LOWER(categoria) LIKE '%novill%'
        AND fecha = $1::date
    `,
    [fecha]
  );
  const min = Number(rangoR.rows[0]?.min);
  const max = Number(rangoR.rows[0]?.max);
  const hoy = Number(semR.rows[0]?.hoy);
  const prev = Number(semR.rows[0]?.prev);
  const varPct = Number.isFinite(hoy) && Number.isFinite(prev) && prev > 0 ? ((hoy - prev) / prev) * 100 : null;
  const tono = Number.isFinite(varPct) ? (varPct >= 2 ? "firme" : varPct <= -2 ? "flojo" : "estable") : "estable";
  return [
    "NOVILLO (feedlot):",
    `- Rango real: ${Number.isFinite(min) && Number.isFinite(max) ? `${formatearMoneda(min, "ARS")} - ${formatearMoneda(max, "ARS")}/kg` : "s/d"}`,
    `- Variación semanal: ${Number.isFinite(varPct) ? `${varPct.toFixed(1)}%` : "s/d"} (${tono})`,
    "- Ingreso/volumen: sin dato directo en esta fuente (lectura por precio y variación).",
  ].join("\n");
};

const construirPosturaGranoUnaLinea = ({ disp, fut, tc, etiqueta = "Grano" }, { etiquetaTipoCambioFn } = {}) => {
  const etiquetaTipoCambio =
    typeof etiquetaTipoCambioFn === "function" ? etiquetaTipoCambioFn : (x) => String(x || "");
  if (!disp || !fut || !tc?.valor) return null;
  const spotArs = String(disp.moneda || "").toUpperCase() === "ARS" ? Number(disp.precio) : null;
  const futUsd = Number(fut.precio_usd);
  const tcFin = Number(tc.valor);
  if (!Number.isFinite(spotArs) || !Number.isFinite(futUsd) || futUsd <= 0 || !Number.isFinite(tcFin) || tcFin <= 0) {
    return null;
  }
  const impl = spotArs / futUsd;
  const implVsMepPct = ((impl - tcFin) / tcFin) * 100;
  const dispUsd = spotArs / tcFin;
  const carryPct = ((futUsd - dispUsd) / dispUsd) * 100;
  const partes = [];
  if (implVsMepPct <= -2) {
    partes.push(`implícito ~${Math.abs(implVsMepPct).toFixed(0)}% por debajo del MEP (mucho cambiario en la ecuación)`);
  } else if (implVsMepPct >= 2) {
    partes.push("implícito por encima del MEP (menos atraso cambiario en el spot vs financiero)");
  }
  if (carryPct > 1) partes.push(`carry ~${carryPct.toFixed(1)}% al vencimiento mostrado`);
  if (carryPct < -1) partes.push("estructura más plana o a backwardation en ese tramo");
  if (!partes.length) return null;
  return `${etiqueta}: ${partes.join(" · ")}.`;
};

const responderEstructuraMercadoYFeedlot = async (
  { texto = "", nivel = "TECNICO" } = {},
  {
    normMinFn,
    adaptarRespuestaPorNivelFn,
    queryFn,
    toISODateParamFn,
    formatearMonedaFn,
    etiquetaTipoCambioFn,
    obtenerDisponiblePoliticaResumenUnCultivoFn,
  } = {}
) => {
  const normMin = typeof normMinFn === "function" ? normMinFn : normMinDefault;
  const adaptarRespuestaPorNivel =
    typeof adaptarRespuestaPorNivelFn === "function"
      ? adaptarRespuestaPorNivelFn
      : (_nivel, out) => out?.intermedio || "";
  const query = typeof queryFn === "function" ? queryFn : async () => ({ rows: [] });
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : () => null;
  const formatearMoneda = typeof formatearMonedaFn === "function" ? formatearMonedaFn : (v) => String(v ?? "");
  const etiquetaTipoCambio =
    typeof etiquetaTipoCambioFn === "function" ? etiquetaTipoCambioFn : (x) => String(x || "");
  const obtenerDisponiblePoliticaResumenUnCultivo =
    typeof obtenerDisponiblePoliticaResumenUnCultivoFn === "function"
      ? obtenerDisponiblePoliticaResumenUnCultivoFn
      : async () => null;

  const bloqueDeps = { formatearMonedaFn: formatearMoneda, toISODateParamFn: toISODateParam, etiquetaTipoCambioFn: etiquetaTipoCambio };
  const posturaDeps = { etiquetaTipoCambioFn: etiquetaTipoCambio };
  const dispRosarioDeps = { obtenerDisponiblePoliticaResumenUnCultivoFn: obtenerDisponiblePoliticaResumenUnCultivo };
  const futuroDeps = { queryFn: query, toISODateParamFn: toISODateParam };

  const t = normMin(texto);
  const mencionaHacienda = /(novillo|feedlot|encierre|hacienda|ternero)/.test(t);
  const consultaRelacional = /(relacion|ratio|equivalencia|maiz\/novill|novill\/maiz|maiz.*novill|novill.*maiz)/.test(t);
  const incluirSoja = /soja/.test(t) || !/(soja|maiz|maíz)/.test(t);
  const incluirMaiz = /(maiz|maíz)/.test(t) || !/(soja|maiz|maíz)/.test(t);
  const [dispSoja, futSoja, dispMaiz, futMaiz] = await Promise.all([
    incluirSoja ? obtenerDisponibleRosario("soja", dispRosarioDeps) : Promise.resolve(null),
    incluirSoja ? obtenerFuturoCercano("soja", futuroDeps) : Promise.resolve(null),
    incluirMaiz ? obtenerDisponibleRosario("maiz", dispRosarioDeps) : Promise.resolve(null),
    incluirMaiz ? obtenerFuturoCercano("maiz", futuroDeps) : Promise.resolve(null),
  ]);
  const fechaRef = toISODateParam(dispSoja?.fecha) || toISODateParam(dispMaiz?.fecha) || null;
  const tc = await obtenerTcImplicitoDia(fechaRef, { queryFn: query, toISODateParamFn: toISODateParam });
  const bloques = [];
  if (incluirSoja) {
    bloques.push(construirBloqueEstructuraCultivo({ cultivo: "soja", disp: dispSoja, fut: futSoja, tc }, bloqueDeps));
  }
  if (incluirMaiz) {
    bloques.push(construirBloqueEstructuraCultivo({ cultivo: "maiz", disp: dispMaiz, fut: futMaiz, tc }, bloqueDeps));
  }
  let bloqueNovillo = null;
  if (mencionaHacienda) {
    bloqueNovillo = await obtenerLecturaNovilloFeedlot({ queryFn: query, toISODateParamFn: toISODateParam, formatearMonedaFn: formatearMoneda });
    bloques.push(bloqueNovillo);
  }
  const faltanteClaveRelacion =
    consultaRelacional &&
    (incluirMaiz
      ? !dispMaiz || !futMaiz || !tc?.valor
      : false || /sin datos|s\/d/i.test(String(bloqueNovillo || "")));
  if (faltanteClaveRelacion) return null;
  const soloGranos = /(soja|maiz|maíz)/.test(t) && !/(novillo|feedlot|encierre|hacienda|ternero)/.test(t);
  const lectura = soloGranos
    ? [
        "LECTURA (corta):",
        "- Números con la misma fila de disponible que tu resumen + futuro MATBA + MEP/bolsa del día.",
        "- Si el implícito queda lejos del MEP, antes que “carry puro” suele pesar la mezcla cambiaria.",
      ].join("\n")
    : [
        "LECTURA:",
        "- Referencias homogéneas (disponible priorizado como en resumen + MATBA cercano + mismo TC).",
        "- Si falta una pata (ej: posición MATBA), lo marco y no mezclo FOB para decisión local.",
      ].join("\n");
  const pSoja = construirPosturaGranoUnaLinea({ disp: dispSoja, fut: futSoja, tc, etiqueta: "Soja" }, posturaDeps);
  const pMaiz = construirPosturaGranoUnaLinea({ disp: dispMaiz, fut: futMaiz, tc, etiqueta: "Maíz" }, posturaDeps);
  const accionGranosLines = ["YO HARÍA (orientación, no asesoramiento personalizado):"];
  if (incluirSoja) {
    accionGranosLines.push(pSoja || "- Soja: sin par completo spot+futuro+MEP para sugerir postura.");
  }
  if (incluirMaiz) {
    accionGranosLines.push(pMaiz || "- Maíz: sin par completo spot+futuro+MEP para sugerir postura.");
  }
  accionGranosLines.push(
    "Si no tenés apuro de pesos: conviene operar en tramos (20-40%) en vez de todo o nada, y revalidar cuando el implícito se acerque al MEP o cambie la curva."
  );
  const accionGranos = accionGranosLines.join("\n");
  const accionHacienda = [
    "DECISIÓN HOY (hacienda):",
    "- Si maíz sube y novillo sigue firme, podés estirar encierre corto.",
    "- Si aparece más oferta en novillo (o afloja variación), conviene empezar a vender parcial.",
  ].join("\n");
  const accion = mencionaHacienda ? accionHacienda : accionGranos;
  const intermedio = [bloques.join("\n\n"), "", lectura, "", accion].join("\n");
  const simple = soloGranos
    ? [
        bloques[0] || "Sin estructura consistente hoy.",
        pSoja || pMaiz || "Lectura: faltan datos para una línea clara.",
        "Si no hay apuro: operar en tramos y revalidar.",
      ].join("\n")
    : [
        bloques[0] || "Sin estructura consistente hoy.",
        "Lectura: uso referencias homogéneas para no mezclar mercados.",
        "Acción: si novillo acompaña, estirar corto; si afloja, vender parcial.",
      ].join("\n");
  return adaptarRespuestaPorNivel(nivel, { simple, intermedio, tecnico: intermedio });
};

module.exports = {
  construirBloqueEstructuraCultivo,
  construirPosturaGranoUnaLinea,
  extraerPosicionesSolicitadas,
  obtenerDisponibleRosario,
  obtenerFuturoCercano,
  obtenerLecturaNovilloFeedlot,
  obtenerTcImplicitoDia,
  parseFechaConsulta,
  responderEstructuraMercado,
  responderEstructuraMercadoYFeedlot,
};
