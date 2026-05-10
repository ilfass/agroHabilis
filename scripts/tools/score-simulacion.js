#!/usr/bin/env node
/**
 * Score de calidad por productor (0-100) a partir de JSON de simulación.
 *
 * Rubrica (transparente):
 * - Limpieza (max 28): penaliza fugas ("sin datos en base"), etiqueta BOLSA en TC.
 * - Densidad de datos (max 18): muchos `s/d` sugieren huecos de producto (penalización acotada).
 * - Robustez IA (max 27): penaliza fallback "No pude consultar la IA" por turno.
 * - Coherencia (max 17): penaliza derivas a sólo cotización USD ante pedidos carry/brecha/implícito.
 * - UX latencia (max 10): promedio de ms por conversación del productor.
 *
 * Opcional: bonus plan (+5 máx.) si aparece confirmación explícita de cambio de plan.
 *
 * Uso:
 *   node scripts/tools/score-simulacion.js docs/operacion/simulacion-7-productores-onboarding-v4-realista-2026-05-04.json
 *   node scripts/tools/score-simulacion.js --all
 *   node scripts/tools/score-simulacion.js --compare docs/operacion/simulacion-7-productores-onboarding-v2-2026-05-04.json docs/operacion/simulacion-7-productores-onboarding-v3-post-fixes-2026-05-04.json
 */

const fs = require("fs");
const path = require("path");

function loadJson(p) {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function scoreTurnCoherence(user, bot) {
  const u = (user || "").toLowerCase();
  const b = bot || "";
  if (!u.trim()) return 0;
  const pideMercadoFin =
    /carry|brecha|impl[ií]cito|spread|spot\s*vs|futuro|corto:|mep|matba/i.test(u);
  const soloDolar =
    /Cotización del dólar/i.test(b) &&
    !/spot|futuro|matba|disponible rosario|bcr_gix/i.test(b);
  return pideMercadoFin && soloDolar ? 1 : 0;
}

function tieneBonusPlan(conv) {
  const c = conv || [];
  for (let i = 0; i < c.length; i++) {
    const u = String(c[i].user || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();
    if (
      u === "QUIERO PLAN GRATIS" ||
      u === "QUIERO PLAN BASICO" ||
      u === "QUIERO PLAN PRO"
    ) {
      const b = c[i]?.bot || "";
      if (/plan actualizado/i.test(b)) return 5;
    }
  }
  return 0;
}

function metricsProducer(entry) {
  const conv = entry.conv || [];
  const botConcat = conv.map((c) => c.bot || "").join("\n");
  const ms = conv.map((c) => Number(c.ms) || 0).filter((n) => n > 0);
  const avgMs = ms.length ? ms.reduce((a, n) => a + n, 0) / ms.length : 0;
  const maxMs = ms.length ? Math.max(...ms) : 0;
  const nSinDatosBase = (botConcat.match(/sin datos en base/gi) || []).length;
  const nBolsa = (botConcat.match(/\bBOLSA\b/g) || []).length;
  const nSd = (botConcat.match(/\bs\/d\b/g) || []).length;
  const nFallbackIA = (botConcat.match(/No pude consultar la IA/g) || []).length;
  let misroutes = 0;
  for (const t of conv) {
    misroutes += scoreTurnCoherence(t.user, t.bot);
  }
  const longTurns = conv.filter((t) => (t.bot || "").length > 1200).length;
  const errores = (botConcat.match(/\[ERROR\]/g) || []).length;

  const limpieza = Math.max(
    0,
    28 - Math.min(28, nSinDatosBase * 9 + nBolsa * 4),
  );
  const densidad = Math.max(0, 18 - Math.min(18, nSd * 1.2));
  const robustez = Math.max(0, 27 - Math.min(27, nFallbackIA * 7));
  const coherencia = Math.max(0, 17 - Math.min(17, misroutes * 8));
  let latUx = 10;
  if (avgMs > 4000) latUx -= 2;
  if (avgMs > 9000) latUx -= 3;
  if (avgMs > 15000) latUx -= 3;
  if (avgMs > 22000) latUx -= 2;
  latUx = Math.max(0, latUx);

  let subtotal = limpieza + densidad + robustez + coherencia + latUx;
  subtotal -= Math.min(8, errores * 8);
  subtotal -= Math.min(6, longTurns * 1);

  let bonusPlan = 0;
  if (tieneBonusPlan(conv)) bonusPlan = 5;

  const score = Math.max(0, Math.min(100, Math.round(subtotal + bonusPlan)));

  return {
    productor: entry.productor,
    nombre: entry.nombre,
    whatsapp: entry.whatsapp,
    score,
    breakdown: {
      limpieza: Math.round(limpieza * 10) / 10,
      densidad: Math.round(densidad * 10) / 10,
      robustezIA: Math.round(robustez * 10) / 10,
      coherencia: Math.round(coherencia * 10) / 10,
      latenciaUx: Math.round(latUx * 10) / 10,
      penalErrores: Math.min(8, errores * 8),
      penalRespLargas: Math.min(6, longTurns * 1),
      bonusPlan,
    },
    counts: {
      sinDatosEnBase: nSinDatosBase,
      bolsaLabel: nBolsa,
      sdTokens: Math.round(nSd),
      fallbackIA: nFallbackIA,
      derivaSoloDolar: misroutes,
      respuestasLargas: longTurns,
      erroresBracket: errores,
      turnos: conv.length,
    },
    latency: {
      avgMs: Math.round(avgMs),
      maxMs: Math.round(maxMs),
    },
  };
}

function scoreFile(filePath) {
  const data = loadJson(filePath);
  const rows = (data.out || []).map(metricsProducer);
  const avgScore =
    rows.length > 0
      ? Math.round(
          rows.reduce((a, r) => a + r.score, 0) / rows.length,
        )
      : 0;
  return {
    archivo: path.basename(filePath),
    rutaCompleta: path.resolve(filePath),
    generatedAt: data.generatedAt || null,
    scorePromedio: avgScore,
    productores: rows,
  };
}

function compareFiles(a, b) {
  const A = scoreFile(a);
  const B = scoreFile(b);
  const deltas = [];
  const byP = new Map(B.productores.map((r) => [r.productor, r]));
  for (const pa of A.productores) {
    const pb = byP.get(pa.productor);
    if (!pb) continue;
    deltas.push({
      productor: pa.productor,
      nombre: pa.nombre,
      deltaScore: pb.score - pa.score,
      deltaAvgMs: pb.latency.avgMs - pa.latency.avgMs,
      scoreA: pa.score,
      scoreB: pb.score,
      avgMsA: pa.latency.avgMs,
      avgMsB: pb.latency.avgMs,
      deltaFallbackIA: pb.counts.fallbackIA - pa.counts.fallbackIA,
      deltaSinDatosBase:
        pb.counts.sinDatosEnBase - pa.counts.sinDatosEnBase,
    });
  }
  return {
    base: A.archivo,
    comparado: B.archivo,
    scorePromedioBase: A.scorePromedio,
    scorePromedioComparado: B.scorePromedio,
    deltaPromedioScore: B.scorePromedio - A.scorePromedio,
    porProductor: deltas,
  };
}

function findSimulacionFiles(root) {
  const dir = path.join(root, "docs", "operacion");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(
      (f) =>
        /^simulacion-7-productores.*\.json$/i.test(f) &&
        !/^scores-/i.test(f),
    )
    .map((f) => path.join(dir, f))
    .sort();
}

function main() {
  const argv = process.argv.slice(2);
  const root = path.join(__dirname, "..", "..");

  if (argv[0] === "--compare" && argv.length >= 3) {
    const out = compareFiles(argv[1], argv[2]);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  const files =
    argv[0] === "--all"
      ? findSimulacionFiles(root)
      : argv.length
        ? argv.map((x) => path.resolve(x))
        : [];

  if (!files.length) {
    console.error(
      "Uso: node scripts/tools/score-simulacion.js <archivo.json> | --all | --compare a.json b.json",
    );
    process.exit(1);
  }

  const bundle = {
    scoredAt: new Date().toISOString(),
    runs: files.map((f) => scoreFile(f)),
  };

  const pV2 = path.join(
    root,
    "docs/operacion/simulacion-7-productores-onboarding-v2-2026-05-04.json",
  );
  const pV3 = path.join(
    root,
    "docs/operacion/simulacion-7-productores-onboarding-v3-post-fixes-2026-05-04.json",
  );
  bundle.comparativoV2vsV3 =
    fs.existsSync(pV2) && fs.existsSync(pV3) ? compareFiles(pV2, pV3) : null;

  const pV4 = path.join(
    root,
    "docs/operacion/simulacion-7-productores-onboarding-v4-realista-2026-05-04.json",
  );
  bundle.comparativoV3vsV4 =
    fs.existsSync(pV3) && fs.existsSync(pV4) ? compareFiles(pV3, pV4) : null;

  const outPath = path.join(
    root,
    "docs/operacion/scores-simulacion-comparativo-2026-05-04.json",
  );
  fs.writeFileSync(outPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
  console.error(`Escrito: ${outPath}`);
}

main();
