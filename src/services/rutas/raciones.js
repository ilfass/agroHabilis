"use strict";

const H = require("../consultas/legacy_helpers");

const DIETAS_PERMITIDAS = ["suplementacion", "feedlot", "pastura"];

const rutaRaciones = async ({ clasificacion, mensaje, usuario }) => {
  const t = String(mensaje || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  // 1. Extraer parámetros con IA libre estructurada en JSON
  let parser = {
    cabezas: null,
    peso: null,
    dieta: "suplementacion"
  };

  try {
    const pSystem = [
      "Sos el extractor de parámetros de racionamiento de ganado de AgroHabilis.",
      "Leé la pregunta del productor y devolvé un objeto JSON con los siguientes campos:",
      "- cabezas (number o null): cantidad de cabezas de ganado a alimentar (ej: 120 novillos -> 120).",
      "- peso (number o null): peso vivo promedio por cabeza en kg (ej: 350 kg promedio -> 350).",
      "- dieta (string): 'suplementacion', 'feedlot' o 'pastura'. Asumí 'suplementacion' por defecto.",
      "  - Si menciona 'engorde', 'feedlot', 'intensivo', poné 'feedlot'.",
      "  - Si menciona 'pastos', 'verde', 'pastura', 'directo', 'campo', poné 'pastura'.",
      "Devolvé EXCLUSIVAMENTE un JSON válido (sin fences, sin texto extra).",
    ].join("\n");

    const outParse = await H.generarConPromptLibre({
      system: pSystem,
      user: `Mensaje:\n"${mensaje}"\n\nJSON:`,
    });

    const parsedJson = JSON.parse(
      String(outParse?.texto || "")
        .replace(/^```json/i, "")
        .replace(/^```/i, "")
        .replace(/```$/i, "")
        .trim()
    );

    if (parsedJson) {
      parser = { ...parser, ...parsedJson };
    }
  } catch (e) {
    console.warn("[rutaRaciones] Falló el parsing con IA, aplicando heurísticas básicas:", e.message);
    
    // Heurísticas básicas de fallback
    const matchCabezas = t.match(/\b(\d{1,4})\s*(?:novill|vac|animal|cabez|terner|toro|vaquill|cab)\b/);
    if (matchCabezas) parser.cabezas = Number(matchCabezas[1]);

    const matchPeso = t.match(/\b(\d{2,3})\s*(?:kg|kilo)/);
    if (matchPeso) parser.peso = Number(matchPeso[1]);

    if (t.includes("feedlot") || t.includes("engorde")) {
      parser.dieta = "feedlot";
    } else if (t.includes("pastura") || t.includes("pasto") || t.includes("verde")) {
      parser.dieta = "pastura";
    }
  }

  // 2. Validar que tengamos cabezas y peso, si no repreguntamos amigablemente
  const cabezas = Number(parser.cabezas);
  const peso = Number(parser.peso);

  if (!cabezas || !peso) {
    return [
      `🧮 *AgroHabilis - Formulación de Raciones*`,
      `Para calcular la carga del mixer, necesito que me indiques la **cantidad de cabezas** y el **peso promedio** de los animales.`,
      "",
      `💡 *Ejemplo:* _"Necesito formular una suplementación para 120 novillos de 350 kg promedio. ¿Cuánto cargo en el mixer?"_`,
    ].join("\n");
  }

  const dieta = DIETAS_PERMITIDAS.includes(parser.dieta) ? parser.dieta : "suplementacion";

  // 3. Ejecutar algoritmo agronómico (2.8% base MS)
  const consumoPorc = 2.8;
  const msCab = peso * (consumoPorc / 100);
  const msTotal = msCab * cabezas;

  let wetTotal = 0;
  let racionText = "";

  if (dieta === "suplementacion") {
    const silajeMs = msTotal * 0.70;
    const maizMs = msTotal * 0.25;
    const concMs = msTotal * 0.05;

    const silajeWet = silajeMs / 0.35;
    const maizWet = maizMs / 0.85;
    const concWet = concMs / 0.90;
    wetTotal = silajeWet + maizWet + concWet;

    racionText = [
      `🌾 *Suplementación Balanceada* (70% Silaje, 25% Maíz, 5% Concentrado):`,
      `• *Silaje de Maíz* (35% MS): *${silajeWet.toFixed(0)} kg* (${(silajeWet / cabezas).toFixed(1)} kg/cab)`,
      `• *Maíz Molido* (85% MS): *${maizWet.toFixed(0)} kg* (${(maizWet / cabezas).toFixed(1)} kg/cab)`,
      `• *Concentrado Proteico* (90% MS): *${concWet.toFixed(0)} kg* (${(concWet / cabezas).toFixed(1)} kg/cab)`
    ].join("\n");
  } else if (dieta === "feedlot") {
    const maizMs = msTotal * 0.60;
    const silajeMs = msTotal * 0.35;
    const nucleoMs = msTotal * 0.05;

    const maizWet = maizMs / 0.85;
    const silajeWet = silajeMs / 0.35;
    const nucleoWet = nucleoMs / 0.90;
    wetTotal = maizWet + silajeWet + nucleoWet;

    racionText = [
      `🌽 *Feedlot / Engorde Intensivo* (60% Maíz, 35% Silaje, 5% Núcleo):`,
      `• *Maíz Molido* (85% MS): *${maizWet.toFixed(0)} kg* (${(maizWet / cabezas).toFixed(1)} kg/cab)`,
      `• *Silaje de Planta* (35% MS): *${silajeWet.toFixed(0)} kg* (${(silajeWet / cabezas).toFixed(1)} kg/cab)`,
      `• *Núcleo Invernada* (90% MS): *${nucleoWet.toFixed(0)} kg* (${(nucleoWet / cabezas).toFixed(1)} kg/cab)`
    ].join("\n");
  } else {
    const forrajeWet = msTotal / 0.20;
    wetTotal = forrajeWet;

    racionText = [
      `🌿 *Pastura Base / Consumo Directo* (100% Forraje Verde):`,
      `• *Forraje Verde* (~20% MS): *${forrajeWet.toFixed(0)} kg/día* (${(forrajeWet / cabezas).toFixed(1)} kg/cab)`
    ].join("\n");
  }

  // 4. Retornar plan de carga del mixer formateado hermosamente
  return [
    `🧮 *AGROHABILIS - DIETA Y MIXER*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `👥 *Lote:* *${cabezas} animales* de *${peso} kg* promedio`,
    `📊 *Consumo Diario de Materia Seca (MS):*`,
    `• Por cabeza: *${msCab.toFixed(2)} kg MS/día*`,
    `• Consumo total: *${msTotal.toFixed(0)} kg MS/día*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    racionText,
    `━━━━━━━━━━━━━━━━━━━━`,
    `👉 *PESO HÚMEDO TOTAL A CARGAR (MIXER):*`,
    `🚚 *${wetTotal.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} kg/día*`,
    "",
    `💡 _Fórmula basada en estándares del INTA para recría e invernada._`,
    `_Podés pedirme recalcular cambiando el tipo de dieta (feedlot, pastura o suplementación)._`
  ].join("\n");
};

module.exports = { rutaRaciones };
