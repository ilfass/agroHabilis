"use strict";

const { oavStepMaxAttemptsCap } = require("../cursor_mode");

/**
 * Bucle genérico observe → act → verificar: reintenta `execute` hasta `maxAttempts`
 * mientras `verify` devuelva `{ ok: false }`.
 *
 * @template T
 * @param {{
 *   execute: (meta: { attempt: number; maxAttempts: number }) => Promise<T>,
 *   verify: (value: T, meta: { attempt: number; maxAttempts: number }) => Promise<{ ok: boolean }>|{ ok: boolean },
 *   maxAttempts?: number,
 * }} opts
 * @returns {Promise<T>}
 */
const runWithVerifyRetry = async ({ execute, verify, maxAttempts = 2 }) => {
  const cap = oavStepMaxAttemptsCap();
  const max = Math.min(cap, Math.max(1, Math.floor(Number(maxAttempts) || 2)));
  let last = /** @type {T} */ (undefined);
  for (let attempt = 1; attempt <= max; attempt += 1) {
    const meta = { attempt, maxAttempts: max };
    last = await execute(meta);
    const verdict = await verify(last, meta);
    if (verdict && verdict.ok) {
      return last;
    }
  }
  if (typeof last === "string" && last.trim()) {
    return last;
  }
  return typeof last === "string" ? last : "No pude generar respuesta. Probá de nuevo.";
};

module.exports = { runWithVerifyRetry };
