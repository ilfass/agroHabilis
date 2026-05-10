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

/** Cantidad de hectáreas expresada en dígitos o en palabra (diez, veinte…) antes de ha/hectáreas. */
function parseSpanishNumberPhrase(frase = "") {
  const BAS = {
    cero: 0,
    uno: 1,
    un: 1,
    una: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
    trece: 13,
    catorce: 14,
    quince: 15,
    dieciseis: 16,
    diecisiete: 17,
    dieciocho: 18,
    diecinueve: 19,
    veinte: 20,
    veintiuno: 21,
    veintiun: 21,
    veintidos: 22,
    veintitres: 23,
    veinticuatro: 24,
    veinticinco: 25,
    veintiseis: 26,
    veintisiete: 27,
    veintiocho: 28,
    veintinueve: 29,
    treinta: 30,
    cuarenta: 40,
    cincuenta: 50,
    sesenta: 60,
    setenta: 70,
    ochenta: 80,
    noventa: 90,
    cien: 100,
    ciento: 100,
  };

  let p = norm(frase || "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!p) return null;
  /* Compuestos "treinta y cinco", "treinta y uno". */
  const mComp = /^(.+?)\s+y\s+(.+)$/.exec(p);
  if (mComp) {
    const base = BAS[mComp[1]];
    const unidad = BAS[mComp[2]];
    if (
      typeof base === "number" &&
      typeof unidad === "number" &&
      base >= 20 &&
      base % 10 === 0 &&
      base < 100 &&
      unidad >= 1 &&
      unidad <= 9
    ) {
      return base + unidad;
    }
  }
  const v = BAS[p];
  return typeof v === "number" && v > 0 ? v : null;
}

/** Número positivo antes de ha / hectáreas (dígito o palabra tipo "diez"). */
function numeroAntesHaDesdeTexto(textoOriginal = "") {
  const s = String(textoOriginal || "").trim();
  if (!s) return null;
  const mDig = s.match(/\b(\d+[.,]?\d*)\s*h[aá]s?\b/i);
  if (mDig) {
    const v = Number(String(mDig[1]).replace(",", "."));
    if (Number.isFinite(v) && v > 0) return v;
  }
  const mHet = s.match(
    /\b([a-záéíóúñ]+(?:\s+y\s+[a-záéíóúñ]+)?)\s+hect[aá]reas\b/i
  );
  const mHa = mHet || s.match(/\b([a-záéíóúñ]+(?:\s+y\s+[a-záéíóúñ]+)?)\s+h[aá]s?\b/i);
  const frag = String(mHa?.[1] || "").trim();
  const nPal = frag ? parseSpanishNumberPhrase(frag) : null;
  if (nPal != null && Number.isFinite(nPal) && nPal > 0) return nPal;
  return null;
}

/** Cantidad antes de novillos/vacas/etc.: dígitos o palabra («diez»…), incluso con verbo antes («puse diez vacas…»). */
function numeroAntesGanadoDesdeTexto(textoOriginal = "") {
  const s = String(textoOriginal || "").trim();
  if (!s) return null;
  const sufijoGan =
    "(?:novillos|novillo|vacas|vaca|terneros|ternero|cabezas|cabs?\\.?)";
  const digitBefore = new RegExp(`\\b(\\d+[.,]?\\d*)\\s+${sufijoGan}\\b`, "i");
  const mDig = s.match(digitBefore);
  if (mDig) {
    const v = Number(String(mDig[1]).replace(",", "."));
    if (Number.isFinite(v) && v > 0) return v;
  }
  const reSufijo = new RegExp(`\\b${sufijoGan}\\b`, "gi");
  let vm;
  while ((vm = reSufijo.exec(s)) !== null) {
    const antes = s.slice(0, vm.index).trim();
    if (!antes) continue;
    const tokens = antes.split(/\s+/).filter(Boolean);
    const maxVentana = Math.min(4, tokens.length);
    for (let len = maxVentana; len >= 1; len--) {
      const phrase = tokens.slice(tokens.length - len, tokens.length).join(" ").trim();
      if (/^\d+[.,]?\d*$/.test(phrase)) {
        const v = Number(String(phrase).replace(",", "."));
        if (Number.isFinite(v) && v > 0) return v;
      }
      const np = phrase ? parseSpanishNumberPhrase(phrase) : null;
      if (np != null && Number.isFinite(np) && np > 0) return Math.round(np);
    }
  }
  return null;
}

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
  const hectasPalabraOdigito = numeroAntesHaDesdeTexto(texto) != null;
  const ganadoPalabraOdigito = numeroAntesGanadoDesdeTexto(texto) != null;
  const altaSiembraOimplante =
    /\b(sembr\w+|siembr\w+|implant\w+|plant\w+)\b/i.test(t) && hectasPalabraOdigito && CULTIVOS.test(texto || "");
  const altaVerboColoquial = /\b(puse|pusieron|pusimos|met[ií]|metieron|metimos|agregu[eé]|agregamos|sum[eé]|sumamos)\w*\b/i.test(
    t
  );
  const alta =
    /\b(registr|carg(an|uen|amos|uen|uen|uemos)|guard(ar|[aá]n|uen|uemos)|anot(an|uen|aar|uen)|actualiz|carguen|marcar|carguen)\b/i.test(
      t
    ) ||
    /\b(tengo\s+(\d)|(en\s+)?(el\s+)?(campo|lote|parcela)\b.+(\d))|(\d+).*\b(lote|parcela)\b/i.test(texto || "") ||
    altaSiembraOimplante ||
    altaVerboColoquial;
  const cantidadFarm =
    (/\b(\d+[.,]?\d*)\s*\b/.test(texto || "") &&
      /\b(h[aá]|hectareas?|cabez|cabs?\.?|cabezas?|vacas|novillos|terneros|cab|tn\b|toneladas?\b)\b/i.test(
        texto || ""
      )) ||
    hectasPalabraOdigito ||
    ganadoPalabraOdigito;
  return Boolean(alta && cantidadFarm);
};

/**
 * Entrada NL heurística. Devuelve null si no está claro → el resto del bot sigue igual.
 */
const detectarVocabularioInsumo = (texto = "") =>
  /\b(urea|glifosato|glif[oó]\w*|2\s*[,.\s]?4\s*[,.\s]?d|map\b|amf|sulfato\w*|fosfat\w*|fit\w*|fertiliz\w*|herbicid\w*|fungicid\w*|insecticid\w*|semilla[s]?\b|insumo[s]?\b|bolsa[s]?\s+de|triple\b|balanced|diesel|gasoil|agroquim\w*)\b/i.test(
    texto || ""
  );

const detectarRegistroInsumo = (texto = "") =>
  detectarVocabularioInsumo(texto) && /\d/.test(String(texto || ""));

const parecePedidoInformacion = (texto = "") => {
  const t = norm(texto);
  if (!t) return false;
  if (/\?/.test(String(texto || ""))) return true;
  const anclaInventario = /\b(inventario|stock|lote|campo|parcela|establecimiento|saldos?|existencias?)\b/.test(t);
  if (/\b(cuanto|cuantos|cual|cuales|que|como|cuando|donde)\b/.test(t) && /\b(tengo|hay|esta|estan|quedo|quedaron)\b/.test(t))
    return true;
  if (/\b(mostra|decime|quiero saber|consultar)\b/.test(t) && anclaInventario) return true;
  return false;
};

const parseIntentInventario = (texto = "") => {
  const consulta = detectarConsultaInventario(texto) || parecePedidoInformacion(texto);
  const registro = detectarAltaInventario(texto) || detectarRegistroInsumo(texto);
  if (consulta && registro) return { clase: "ambiguo" };
  if (consulta) return { clase: "consulta" };
  if (registro) return { clase: "registro" };
  const t = norm(texto);
  if (
    /\blote\b|\bcampo\b|\bparcela\b/.test(t) &&
    (/\b\d+[.,]?\d*/.test(t) ||
      numeroAntesHaDesdeTexto(texto) != null ||
      numeroAntesGanadoDesdeTexto(texto) != null)
  ) {
    return { clase: "registro" };
  }
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
  const limpiarNombreLote = (raw = "") =>
    String(raw || "")
      .replace(/\s+\b(y|e)\b\s+(met[ií]|pus[eé]|sembr[eé]|registr|carg|guard|anot)\w*.*$/i, "")
      .replace(/\s+\b(met[ií]|pus[eé]|sembr[eé]|registr|carg|guard|anot)\w*.*$/i, "")
      .trim();
  const mNum = s.match(/\b(?:lote|campo|parcela)\s+(\d{1,5})\b/i);
  if (mNum?.[1]) return mNum[1];
  const patrons = [
    /\b(?:en|del|de)\s+el\s+(?:lote|campo|parcela)\s+([^,.;]+)/i,
    /\b(?:lote|campo|parcela)\s+(?:nombre\s+)?["']?([^"'.;,]+)["']?/i,
    /\b(?:mi|el)\s+(?:lote|campo)\s+(?:["'])?([^"'.;,]{2,}?)(?:\.|,|\s+tengo\b|\s+hay\b)/i,
    /* Coloquial: «vacas en el caimán» sin decir «lote»; el capture es el nombre del campo. */
    /\b(?:en|del|de)\s+el\s+([a-záéíóúñ0-9][^,.;?\n]{1,78})(?:\s*\?|\s*$)/i,
  ];
  for (const re of patrons) {
    const m = s.match(re);
    if (m?.[1]) {
      const n = limpiarNombreLote(m[1]);
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
  const nGanPal = numeroAntesGanadoDesdeTexto(texto);
  if (nGanPal != null && /\b(?:novillo|vacas|vaca|terneros|ternero|cabezas|cab)\b/i.test(s)) {
    return { valor: nGanPal, clase: "ganado_letras" };
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
  const desdePalabrasHa =
    numeroAntesHaDesdeTexto(texto) ?? null;
  if (desdePalabrasHa != null && CULTIVOS.test(s) && /\b(h[aá]s?\b|hect[aá]r\w*)/i.test(s)) {
    return { valor: desdePalabrasHa, clase: "cultivo" };
  }
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

function extraerHectareasDesdeTexto(texto = "") {
  const s = String(texto || "").replace(",", ".");
  const m = s.match(/\b(\d+[.,]?\d*)\s*h[aá]s?\b/i);
  if (m) {
    const v = Number(String(m[1]).replace(",", "."));
    if (Number.isFinite(v) && v > 0) return v;
  }
  const desdePalabras = numeroAntesHaDesdeTexto(texto);
  return Number.isFinite(desdePalabras) && desdePalabras > 0 ? desdePalabras : null;
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

function normalizarCategoriaGanadoCategoria(base = "", extra = "") {
  const b = String(base || "").trim().toLowerCase();
  const e = String(extra || "").trim().toLowerCase();
  if (!b && !e) return "";
  if (!e) return b;
  return `${b} ${e}`.replace(/\s+/g, " ").trim();
}

function parseRegistroGanadoMultipleHeuristic(textoOriginal = "") {
  const s = String(textoOriginal || "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (!/\by\b/i.test(s)) return null;
  if (!/\b(vaca|novillo|ternero|toro|vaquillona|cabeza|cab)\w*\b/i.test(s)) return null;

  const re = /(?:^|[\s,;]|y\s+)(\d+[.,]?\d*)\s+([a-záéíóúñ]+)(?:\s+([a-záéíóúñ]+))?/gi;
  let m;
  const items = [];
  let ultimaBaseAnimal = "";

  while ((m = re.exec(s))) {
    const cantidad = Number(String(m[1]).replace(",", "."));
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
    const w1 = String(m[2] || "").toLowerCase();
    const w2 = String(m[3] || "").toLowerCase();
    if (!w1) continue;

    const esAnimal = /(vaca|novillo|ternero|toro|vaquillona|cabeza|cab)\w*/i.test(w1);
    let categoria = "";
    if (esAnimal) {
      ultimaBaseAnimal = w1;
      categoria = normalizarCategoriaGanadoCategoria(w1, w2);
    } else if (ultimaBaseAnimal) {
      categoria = normalizarCategoriaGanadoCategoria(ultimaBaseAnimal, w1);
    } else {
      continue;
    }

    const especie = inferirEspecieDesdeEtiqueta(categoria);
    items.push({
      especie,
      categoria,
      cantidad: Math.round(cantidad),
    });
  }

  if (items.length < 2) return null;
  const fecha_referencia = fechaISOArgentina();
  return {
    tipo: "registro_multiple",
    dominio: "ganado",
    efecto: "replace",
    payload: { items },
    lote_nombre_fragmento: extraerNombreLote(textoOriginal),
    campana_nombre_fragmento: extraerNombreCampanaTxt(textoOriginal),
    fecha_referencia,
    texto_original: textoOriginal,
  };
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

function detectarMixtoCultivoInsumoSinHa(textoOriginal = "", borradorInsumo = null) {
  if (!borradorInsumo || borradorInsumo.dominio !== "insumo") return null;
  const cultivo = nombreCultivoDesdeTexto(textoOriginal);
  if (!cultivo) return null;
  const t = norm(textoOriginal);
  if (!/\b(sembr|siembr|implan|plante)\w*\b/.test(t)) return null;
  if (extraerHectareasDesdeTexto(textoOriginal)) return null;
  return {
    tipo: "registro_mixto_falta_hectareas",
    dominio: "mixto",
    efecto: "replace",
    payload: {
      cultivo,
      insumo: borradorInsumo.payload,
      insumo_efecto: borradorInsumo.efecto === "delta" ? "delta" : "replace",
    },
    lote_nombre_fragmento: extraerNombreLote(textoOriginal),
    campana_nombre_fragmento: extraerNombreCampanaTxt(textoOriginal),
    fecha_referencia: fechaISOArgentina(),
    texto_original: textoOriginal,
  };
}

/** No resuelve lote_id aquí (lo hace el capa whatsapp/API con tus lotes reales). */
function construirBorradorRegistro(textoOriginal = "", intentLiteOverride = null) {
  const claseIntent = intentLiteOverride || parseIntentInventario(textoOriginal);
  if (!claseIntent || claseIntent.clase !== "registro") return null;

  const borradorInsumo = parseRegistroInsumoHeuristic(textoOriginal);
  const mixtoSinHa = detectarMixtoCultivoInsumoSinHa(textoOriginal, borradorInsumo);
  if (mixtoSinHa) return mixtoSinHa;
  if (borradorInsumo) return borradorInsumo;
  const borradorGanadoMulti = parseRegistroGanadoMultipleHeuristic(textoOriginal);
  if (borradorGanadoMulti) return borradorGanadoMulti;

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

function construirBorradorConsulta(textoOriginal = "", intentLiteOverride = null) {
  const intent = intentLiteOverride || parseIntentInventario(textoOriginal);
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
  parseRegistroGanadoMultipleHeuristic,
  extraerHectareasDesdeTexto,
  extraerNombreLote,
  extraerNombreCampanaTxt,
};
