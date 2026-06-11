"use strict";

const { runWithVerifyRetry } = require("./verify_retry");

/**
 * Cadena de pasos observe → act → verificar (cada paso usa `runWithVerifyRetry` internamente).
 *
 * @param {{
 *   ctx?: object,
 *   steps: Array<{
 *     name?: string,
 *     observe?: (ctx: object) => Promise<void>|void,
 *     act: (meta: object & { attempt: number; maxAttempts: number }) => Promise<unknown>,
 *     verify: (value: unknown, meta: object & { attempt: number; maxAttempts: number }) => Promise<{ ok: boolean }>|{ ok: boolean },
 *     maxAttempts?: number,
 *   }>,
 * }} opts
 * @returns {Promise<unknown>}
 */
const runObserveActVerifyChain = async ({ ctx = {}, steps = [] }) => {
  let last;
  const trace = [];
  for (const step of steps) {
    const name = String(step.name || "step");
    await step.observe?.(ctx);
    const maxAttempts = step.maxAttempts;
    last = await runWithVerifyRetry({
      maxAttempts,
      execute: (meta) => step.act({ ...ctx, ...meta }),
      verify: (value, meta) => step.verify(value, { ...ctx, ...meta }),
    });
    trace.push({ name, ok: true });
    ctx.last = last;
    ctx.oavTrace = trace;
  }
  return last;
};

module.exports = { runObserveActVerifyChain };
