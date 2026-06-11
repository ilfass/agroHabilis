"use strict";

/**
 * Analiza una descripción de tratamiento sanitario o de observaciones veterinarias
 * y calcula el período de carencia (retiro) correspondiente en días y el motivo.
 * Basado en las pautas estándar del SENASA en Argentina.
 * 
 * @param {string} observaciones observaciones o texto del tratamiento
 * @returns {{dias: number, motivo: string}|null}
 */
function calcularCarencia(observaciones = "") {
  const t = String(observaciones || "").toLowerCase().trim();
  if (!t) return null;

  // 1. Detectar si el usuario especificó explícitamente la cantidad de días de carencia
  // Ej: "carencia de 15 días", "10 dias de retiro", "carencia: 20 dias"
  const matchExplicit = t.match(/(\d+)\s*(dias?|ds)\s*de?\s*(carencia|retiro|espera)/) || 
                        t.match(/(carencia|retiro|espera)\s*de?\s*:?\s*(\d+)\s*(dias?|ds)/);
  if (matchExplicit) {
    const dias = parseInt(matchExplicit[1] || matchExplicit[2], 10);
    if (Number.isInteger(dias) && dias >= 0) {
      return {
        dias,
        motivo: `Carencia de ${dias} días indicada explícitamente`
      };
    }
  }

  // 2. Vacunas o tratamientos con 0 días
  if (/\b(aftosa|carbunclo|mancha|gangrena|vacun|ceftiofur|hierro|vitamin|antinflamatorio no esteroide)\b/.test(t)) {
    return {
      dias: 0,
      motivo: "Vacunación estándar / Tratamiento con Ceftiofur (0 días de retiro)"
    };
  }

  // 3. Ivermectina / Endectocidas de larga acción (Ej: desparasitario, ivermectina)
  if (/\b(ivermectina|desparasitar|desparasitante|endectocida|antiparasitario|doramectina|abamectina)\b/.test(t)) {
    return {
      dias: 42,
      motivo: "Ivermectina / Desparasitario de larga acción (42 días de carencia obligatoria según SENASA)"
    };
  }

  // 4. Antibióticos comunes de amplio espectro (Ej: oxitetraciclina, penicilina, enrofloxacina)
  if (/\b(antibiotico|penicilina|oxitetraciclina|enrofloxacina|tilosina|gentamicina|estreptomicina|florfenicol|neumonia|infeccion|tratamiento)\b/.test(t)) {
    // Si dice ceftiofur ya fue atrapado arriba (0 días), los otros antibióticos tienen 30 días
    return {
      dias: 30,
      motivo: "Antibiótico / Terapia antimicrobiana estándar (30 días de carencia obligatoria según SENASA)"
    };
  }

  // 5. Antiinflamatorios y otros fármacos de acción media
  if (/\b(dexametasona|meloxicam|flunixin|antiinflamatorio|analgesico)\b/.test(t)) {
    return {
      dias: 7,
      motivo: "Antiinflamatorio de acción media (7 días de carencia obligatoria)"
    };
  }

  return null;
}

module.exports = { calcularCarencia };
