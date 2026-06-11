"use strict";

/**
 * Filtro local heurístico (Zero-Token) para detectar intentos de inyección de prompt o jailbreaks.
 * @param {string} consulta - El texto de entrada del usuario.
 * @returns {boolean} true si se detecta un patrón potencial de inyección.
 */
const evaluarPromptInjection = (consulta) => {
  if (!consulta || typeof consulta !== "string") return false;
  
  const texto = consulta.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  // Patrones lingüísticos de inyección de directivas (voseo rioplatense y neutro)
  const patronesJailbreak = [
    /\bolvida\b.*\binstrucciones\b/,
    /\bolvida\b.*\bdirectivas\b/,
    /\bolvida\b.*\bsystem\b/,
    /\bolvida\b.*\bsistema\b/,
    /\bignora\b.*\binstrucciones\b/,
    /\bignora\b.*\bdirectivas\b/,
    /\bignora\b.*\bsystem\b/,
    /\bignora\b.*\bsistema\b/,
    /\bignora\b.*\bde aqui en adelante\b/,
    /\bignora\b.*\bde aca en adelante\b/,
    /\bactua\b.*\bcomo\b/,
    /\bactua\b.*\brol\b/,
    /\bdesactiva\b.*\bseguridad\b/,
    /\bdesactiva\b.*\brestricciones\b/,
    /\bnew\b.*\bsystem\b.*\bprompt\b/,
    /\bnuevo\b.*\bsystem\b.*\bprompt\b/,
    /\bnuevo\b.*\bprompt\b.*\bsistema\b/,
    /\bprompt\b.*\binjection\b/,
    /\bjailbreak\b/,
    /\bbypass\b.*\bsystem\b/,
    /\bdeja\b.*\bde\b.*\basistente\b.*\bagro\b/,
    /\bdeja\b.*\bde\b.*\bser\b.*\bagrohabilis\b/
  ];

  for (const regex of patronesJailbreak) {
    if (regex.test(texto)) {
      return true;
    }
  }

  return false;
};

module.exports = {
  evaluarPromptInjection
};
