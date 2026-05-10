"use strict";

const { fechaISOArgentina } = require("../../utils/fecha_ar");
const { inferirEspecieDesdeEtiqueta, normalizarUnidadInsumo } = require("./core");

const norm = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const CULTIVOS = /\b(soja|ma[ií]z|trigo|girasol|sorgo|cebada|papa|patata|arroz|cebolla|pastura[s]?|alfa(?:lfa)?)\w*\b/i;

const detectarConsultaInventario = (texto = "") => {
  const t = norm(texto);
  if (/^(si|no|sip|oka?y|cancelar)$/i.test(String(texto || "").trim())) return false;
  if (!t) return false;
  if (/\binventario\b/.test(t)) return true;
  if (/\b(stock|cargados?|guardado|carg[aá]s)\b/.test(t) && /\b(cu[aá]l|cu[aá]les|cu[aá]nto|que hay|quiero saber)/.test(t))
    return true;
  return (
    (/\bcu[aá]nt(as|os)\s+/.test(t) && /\b(tengo|hay|hay en|hay en el|hay en mi)\b/.test(t)) ||
    /\b(qu[eé]\s+hay\s+en)\b/.test(t) ||
    /\b(estado\s+del\s+lote|c[oó]mo\s+tengo\s+el\s+lote)/.test(t)
  );
};

const detectarAltaInventario = (texto = "") => {
  const t = norm(texto);
  if (!t || t === "si" || t === "no") return false;
  const alta =
    /\b(registr|carg(an|uen|amos|uen|uen|uemos)|guard(ar|[aá]n|uen|uemos)|anot(an|uen|aar|uen)|actualiz|carguen|marcar|carguen)\b/i.test(
      t
    ) ||
    /\b(tengo\s+(\d)|(en\s+)?(el\s+)?(campo|lote|parcela)\b.+(\d))|(\d+).*\b(lote|parcela)\b/i.test(texto || "");
  const cantidadFarm =
    /\b(\d+[.,]?\d*)\s*\b/.test(texto || "") &&
    /\b(h[aá]|hectareas?|cabez|cabs?\.?|cabezas?|vacas|novillos|terneros|cab|tn\b|toneladas?\b)\b/i.test(
      texto || ""
    );
  return Boolean(alta && cantidadFarm);
};

/**
 * Entrada NL heurística. Devuelve null si no está claro → el resto del bot sigue igual.
 */
const detectarVocabularioInsumo = (texto = "") =>
  /\b(urea|glifosato|glif[oó]|2\s*[,.\s]?4\s*[,.\s]?d|map\b|amf|sulfato|fosfat|fit|fertiliz|herbicid|fungicid|insecticid|\bsemilla[s]?\b|insumo[s]?\b|bolsa[s]?\s+de|\btriple\b|balanced|diesel|gasoil|agroquim)\b/i.test(
    texto || ""
  );

const detectarRegistroInsumo = (texto = "") =>
  detectarVocabularioInsumo(texto) && /\d/.test(String(texto || ""));

const parseIntentInventario = (texto = "") => {
  if (detectarConsultaInventario(texto)) return { clase: "consulta" };
  if (detectarAltaInventario(texto) || detectarRegistroInsumo(texto)) return { clase: "registro" };
  const t = norm(texto);
  if (/\blote\b|\bcampo\b|\bparcela\b/.test(t) && /\b\d+[.,]?\d*/.test(t)) return { clase: "registro" };
  return null;
};

function sanitizarNombreProductoInsumo(s = "") {
  return String(s || "")
    .replace(/\s+en(\s+(el|mi|los?))?\s+(lote|campo).*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function efectoPreferidoPorTextoInsumo(texto = "") {
  const s = String(texto || "");
  const t = norm(texto);
  if (/^\s*[+-]/.test(s.trim())) return "delta";
  if (
    /\b(gast[eé]|consum[ií]|us[eé]|apliqu[eé]|aplica|sal[ií]|baj[oó]|rest[oó]|sac[aá]|egres[oó]|egreso)\b/.test(t)
  ) {
    return "delta";
  }
  if (
    /\b(sum[eé]|agreg[ué]|compr[eé]|lleg[oó]|entr[oó]|entraron|ingres[oó]|recib[ií])\b/.test(t) ||
    /^\+\s*\d/.test(s.trim())
  ) {
    return "delta";
  }
  return "replace";
}

function signoDeltaInsumoDesdeTexto(texto = "", efecto) {
  if (efecto !== "delta") return 1;
  const s = String(texto || "").trim();
  if (s.startsWith("-")) return -1;
  if (s.startsWith("+")) return 1;
  const t = norm(texto);
  if (/\b(gast[eé]|consum[ií]|us[eé]|apliqu[eé]|aplica|sal[ií]|baj[oó]|rest[oó]|sac[aá]|egres[oó]|egreso)\b/.test(t))
    return -1;
  if (/\b(sum[eé]|agreg[ué]|compr[eé]|entr[oó]|ingres[oó]|recib[ií])\b/.test(t)) return 1;
  return 1;
}

function parseRegistroInsumoHeuristic(textoOriginal = "") {
  if (!detectarVocabularioInsumo(textoOriginal)) return null;
  const s = String(textoOriginal).replace(/\s+/g, " ").trim();
  const efecto = efectoPreferidoPorTextoInsumo(textoOriginal);
  let m = s.match(/\b(\d+[.,]?\d*)\s*(kg|kilos?|l\.?\b|litros?|lt\b|bolsas?|un(?:idades)?)\s+(?:de\s+)?([^,.;\n]{2,72})/i);
  let num;
  let uRaw;
  let prod;
  if (m) {
    num = Number(String(m[1]).replace(",", "."));
    uRaw = m[2];
    prod = sanitizarNombreProductoInsumo(m[3]);
  } else {
    m = s.match(
      /\b(urea|glifosato|map\b|amf|semillas?\b|fertilizante|herbicida|fungicida|insecticida)[^0-9]{0,52}(\d+[.,]?\d*)\s*(kg|kilos?|l\.?\b|litros?|bolsas?|un(?:idades)?)/i
    );
    if (m) {
      prod = sanitizarNombreProductoInsumo(m[1]);
      num = Number(String(m[2]).replace(",", "."));
      uRaw = m[3];
    }
  }
  if (!m || !Number.isFinite(num) || num <= 0 || !prod) return null;

  const unidadCod = normalizarUnidadInsumo(uRaw);
  const fecha_referencia = fechaISOArgentina();
  const prodTitulo = prod
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");

  if (efecto === "delta") {
    const sg = signoDeltaInsumoDesdeTexto(textoOriginal, efecto);
    return {
      tipo: "registro",
      dominio: "insumo",
      efecto: "delta",
      payload: { producto: prodTitulo, delta: sg * Math.abs(num), unidad: unidadCod },
      lote_nombre_fragmento: extraerNombreLote(textoOriginal),
      campana_nombre_fragmento: extraerNombreCampanaTxt(textoOriginal),
      fecha_referencia,
      texto_original: textoOriginal,
    };
  }

  return {
    tipo: "registro",
    dominio: "insumo",
    efecto: "replace",
    payload: { producto: prodTitulo, cantidad: Math.abs(num), unidad: unidadCod },
    lote_nombre_fragmento: extraerNombreLote(textoOriginal),
    campana_nombre_fragmento: extraerNombreCampanaTxt(textoOriginal),
    fecha_referencia,
    texto_original: textoOriginal,
  };
}

function extraerNombreCampanaTxt(texto = "") {
  const s = String(texto || "").replace(/\s+/g, " ").trim();
  const m = s.match(/\b(?:campa[nñ]a|zafra)\s+([^,.;]+)/i);
  if (!m?.[1]) return null;
  const n = m[1].trim().replace(/^["'`]+|["'`]+$/g, "");
  return n.length >= 2 ? n.slice(0, 80) : null;
}

function extraerNombreLote(texto = "") {
  const s = String(texto || "").replace(/\s+/g, " ").trim();
  const patrons = [
    /\b(?:en|del|de)\s+el\s+(?:lote|campo|parcela)\s+([^,.;]+)/i,
    /\b(?:lote|campo|parcela)\s+(?:nombre\s+)?["']?([^"'.;,]+)["']?/i,
    /\b(?:mi|el)\s+(?:lote|campo)\s+(?:["'])?([^"'.;,]{2,}?)(?:\.|,|\s+tengo\b|\s+hay\b)/i,
  ];
  for (const re of patrons) {
    const m = s.match(re);
    if (m?.[1]) {
      const n = m[1].trim();
      if (n.length >= 2) return n.slice(0, 80);
    }
  }
  return null;
}

function extraerCantidadUniversal(texto = "") {
  const s = String(texto || "").replace(",", ".");
  const mCab = s.match(/\b(\d+[.,]?\d*)\s*(?:cabez|cabs?\.?|cabezas)\b/i);
  if (mCab) return { valor: Number(mCab[1].replace(",", ".")), clase: "ganado" };
  const mNum = s.match(/\b(\d+[.,]?\d*)\s*(?:novillos|vacas|terneros|cabezas|cabs?\.?)?/i);
  if (/\b(novillo|vacas|terneros|cabezas|cab)\b/i.test(s) && mNum && Number.isFinite(Number(mNum[1].replace(",", ".")))) {
    return { valor: Number(mNum[1].replace(",", ".")), clase: "ganado_letras" };
  }
  const mTn = s.match(/\b([-+]?\d+[.,]?\d*)\s*(?:tn\b|toneladas?\b)/i);
  if (mTn && CULTIVOS.test(s)) {
    const raw = Number(String(mTn[1]).replace(",", "."));
    if (Number.isFinite(raw) && raw !== 0 && Math.abs(raw) <= 999999999) {
      return { valor: Math.abs(raw), signo_numero: raw < 0 ? -1 : 1, clase: "grano" };
    }
  }
  const mHa = s.match(/\b(\d+[.,]?\d*)\s*h[aá]s?\b/i);
  if (mHa && CULTIVOS.test(s)) return { valor: Number(mHa[1].replace(",", ".")), clase: "cultivo" };
  const mHa2 = s.match(/\b(\d+[.,]?\d*)\s*h[aá]\b/i);
  if (mHa2) return { valor: Number(mHa2[1].replace(",", ".")), clase: "cultivo_sin_cultivo" };
  const mBare = s.match(/\b(\d+[.,]?\d*)\b/);
  if (mBare && /\b(soja|ma[ií]z|trigo|girasol|sorgo|cebada)\b/i.test(s)) {
    const v = Number(mBare[1].replace(",", "."));
    const before = /(\d+[.,]?\d*)\s*h/i.test(s);
    if (!before && v > 0 && v <= 9999999) return { valor: v, clase: "cultivo_solo_num" };
  }
  return null;
}

function etiquetaGanadoDesdeTexto(texto = "") {
  const t = texto.toLowerCase();
  if (/novillo/.test(t)) return "novillos";
  if (/ternero/.test(t)) return "terneros";
  if (/vaca\b|vacas|\bvo\b/i.test(texto)) return "vacas";
  return "cabezas";
}

function nombreCultivoDesdeTexto(texto = "") {
  const m = texto.match(CULTIVOS);
  if (!m) return null;
  const raw = m[1] || m[0];
  if (/papa|patata/i.test(raw)) return "Papa";
  if (/ma[ií]z/i.test(raw)) return "Maíz";
  if (/alfa/i.test(raw)) return "Alfalfa";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function efectoPreferidoPorTextoGrano(texto = "") {
  const s = String(texto || "");
  const t = norm(texto);
  if (/^\s*[+-]/.test(s.trim())) return "delta";
  if (
    /\b(vend[ií]|entregu[eé]|sac[aá]|egres[oó]|gast[eé]|consum[ií]|baj[oó]|descont[aá]|retir[oó]|salida)\b/.test(t)
  ) {
    return "delta";
  }
  if (/\b(compr[eé]|entr[oó]|ingres[oó]|recib[ií]|sum[eé]|agreg[ué]|lleg[oó])\b/.test(t) || /^\+\s*\d/.test(s.trim())) {
    return "delta";
  }
  return "replace";
}

function signoDeltaGranoDesdeTexto(texto = "", efecto) {
  if (efecto !== "delta") return 1;
  const s = String(texto || "").trim();
  if (s.startsWith("-")) return -1;
  if (s.startsWith("+")) return 1;
  const t = norm(texto);
  if (/\b(vend[ií]|entregu[eé]|sac[aá]|egres[oó]|gast[eé]|consum[ií]|baj[oó]|descont[aá]|retir[oó]|salida)\b/.test(t))
    return -1;
  if (/\b(compr[eé]|entr[oó]|ingres[oó]|recib[ií]|sum[eé]|agreg[ué]|lleg[oó])\b/.test(t)) return 1;
  return 1;
}

/** No resuelve lote_id aquí (lo hace el capa whatsapp/API con tus lotes reales). */
function construirBorradorRegistro(textoOriginal = "") {
  const claseIntent = parseIntentInventario(textoOriginal);
  if (!claseIntent || claseIntent.clase !== "registro") return null;

  const borradorInsumo = parseRegistroInsumoHeuristic(textoOriginal);
  if (borradorInsumo) return borradorInsumo;

  const loteNombre = extraerNombreLote(textoOriginal);
  const campanaNombre = extraerNombreCampanaTxt(textoOriginal);

  const cant = extraerCantidadUniversal(textoOriginal);
  if (!cant || !Number.isFinite(cant.valor)) return null;
  if (cant.clase !== "grano" && cant.valor <= 0) return null;

  const fecha_referencia = fechaISOArgentina();

  if (cant.clase === "grano") {
    const cultivo = nombreCultivoDesdeTexto(textoOriginal);
    if (!cultivo) return null;
    const efectoGr = efectoPreferidoPorTextoGrano(textoOriginal);
    const sgnNum = cant.signo_numero ?? 1;
    if (efectoGr === "delta") {
      const sg = sgnNum < 0 ? -1 : signoDeltaGranoDesdeTexto(textoOriginal, efectoGr);
      return {
        tipo: "registro",
        dominio: "grano",
        efecto: "delta",
        payload: { cultivo, delta: sg * cant.valor },
        lote_nombre_fragmento: loteNombre,
        campana_nombre_fragmento: campanaNombre,
        fecha_referencia,
        texto_original: textoOriginal,
      };
    }
    if (sgnNum < 0) return null;
    return {
      tipo: "registro",
      dominio: "grano",
      efecto: "replace",
      payload: { cultivo, toneladas: cant.valor },
      lote_nombre_fragmento: loteNombre,
      campana_nombre_fragmento: campanaNombre,
      fecha_referencia,
      texto_original: textoOriginal,
    };
  }

  if (cant.clase === "cultivo" || cant.clase === "cultivo_sin_cultivo" || cant.clase === "cultivo_solo_num") {
    const cultivo = nombreCultivoDesdeTexto(textoOriginal);
    if (!cultivo) return null;
    return {
      tipo: "registro",
      dominio: "cultivo",
      efecto: "replace",
      payload: { cultivo, hectareas: cant.valor },
      lote_nombre_fragmento: loteNombre,
      campana_nombre_fragmento: campanaNombre,
      fecha_referencia,
      texto_original: textoOriginal,
    };
  }

  const categoria = etiquetaGanadoDesdeTexto(textoOriginal);
  const especie = inferirEspecieDesdeEtiqueta(categoria);
  return {
    tipo: "registro",
    dominio: "ganado",
    efecto: "replace",
    payload: { especie, categoria, cantidad: Math.round(cant.valor) },
    lote_nombre_fragmento: loteNombre,
    campana_nombre_fragmento: campanaNombre,
    fecha_referencia,
    texto_original: textoOriginal,
  };
}

function construirBorradorConsulta(textoOriginal = "") {
  const intent = parseIntentInventario(textoOriginal);
  if (!intent || intent.clase !== "consulta") return null;
  const loteNombre = extraerNombreLote(textoOriginal);
  return { tipo: "consulta", lote_nombre: loteNombre, texto_original: textoOriginal };
}

module.exports = {
  parseIntentInventario,
  construirBorradorRegistro,
  construirBorradorConsulta,
  detectarConsultaInventario,
  detectarAltaInventario,
  detectarVocabularioInsumo,
  detectarRegistroInsumo,
  parseRegistroInsumoHeuristic,
  extraerNombreLote,
  extraerNombreCampanaTxt,
};
