"use strict";

/**
 * Pasos reutilizables entre gates (conciliación primaria/critic, trazas de paso IA).
 */

const clamp01 = (v, fallback = null) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
};

const confianzaOr = (item, fallback = -1) => {
  const c = clamp01(item?.confianza, null);
  return c == null ? fallback : c;
};

const conciliarPorSeguridad = ({
  primaria = null,
  critic = null,
  prioridadFn = () => 0,
  preferir = "critic",
  tags = {
    seguridad: "critic_loop_seguridad",
    confianza: "critic_loop_confianza",
    tie: "critic_loop_tie",
  },
} = {}) => {
  const a = primaria || null;
  const b = critic || null;
  if (!a && !b) return { salida: null, desacuerdo: false, razon: "sin_datos" };
  if (!a) return { salida: b, desacuerdo: false, razon: "solo_critic" };
  if (!b) return { salida: a, desacuerdo: false, razon: "solo_primaria" };

  if (String(a.tipo || a.modo || "") === String(b.tipo || b.modo || "")) {
    const ca = confianzaOr(a, -1);
    const cb = confianzaOr(b, -1);
    if (cb > ca) {
      return {
        salida: { ...b, motivo: `${b.motivo || "decision"}|${tags.confianza}` },
        desacuerdo: false,
        razon: "misma_decision_conf_critic",
      };
    }
    return { salida: a, desacuerdo: false, razon: "misma_decision" };
  }

  const pa = Number(prioridadFn(a) || 0);
  const pb = Number(prioridadFn(b) || 0);
  if (pb > pa) {
    return {
      salida: { ...b, motivo: `${b.motivo || "decision"}|${tags.seguridad}` },
      desacuerdo: true,
      razon: "gana_critic_seguridad",
    };
  }
  if (pa > pb) {
    return {
      salida: { ...a, motivo: `${a.motivo || "decision"}|${tags.seguridad}` },
      desacuerdo: true,
      razon: "gana_primaria_seguridad",
    };
  }

  const ca = confianzaOr(a, -1);
  const cb = confianzaOr(b, -1);
  if (cb > ca) {
    return {
      salida: { ...b, motivo: `${b.motivo || "decision"}|${tags.confianza}` },
      desacuerdo: true,
      razon: "gana_critic_confianza",
    };
  }
  if (ca > cb) {
    return {
      salida: { ...a, motivo: `${a.motivo || "decision"}|${tags.confianza}` },
      desacuerdo: true,
      razon: "gana_primaria_confianza",
    };
  }

  const preferida = preferir === "primaria" ? a : b;
  return {
    salida: { ...preferida, motivo: `${preferida.motivo || "decision"}|${tags.tie}` },
    desacuerdo: true,
    razon: "empate",
  };
};

const ejecutarPasoConTraza = async ({
  etapa,
  ejecutar,
  normalizar = null,
  trace = null,
  loggerWarn = null,
  warnLabel = null,
} = {}) => {
  try {
    const raw = await ejecutar();
    const normalizado = typeof normalizar === "function" ? normalizar(raw) : raw;
    if (Array.isArray(trace)) {
      trace.push({
        etapa: String(etapa || "paso"),
        ok: true,
        provider: raw?.providerUsed || null,
        model: raw?.model || null,
        salida: raw?.parsed != null ? raw.parsed : undefined,
      });
    }
    return { ok: true, raw, normalizado };
  } catch (e) {
    const msg = String(e?.message || e);
    if (Array.isArray(trace)) {
      trace.push({
        etapa: String(etapa || "paso"),
        ok: false,
        error: msg,
      });
    }
    if (typeof loggerWarn === "function" && warnLabel) {
      loggerWarn(`${warnLabel}: ${msg}`);
    }
    return { ok: false, error: msg };
  }
};

module.exports = {
  clamp01,
  conciliarPorSeguridad,
  ejecutarPasoConTraza,
};
