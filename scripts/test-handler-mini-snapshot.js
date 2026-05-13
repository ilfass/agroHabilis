#!/usr/bin/env node
/**
 * Snapshot tests de los mini-handlers (paso K de P2#10):
 *  - `strict_suggestion`
 *  - `bot_pausado`
 *  - `cupo_excedido`
 *
 * Uso: npm run test:handler:mini
 */

"use strict";

require("dotenv").config({ override: false });

const Module = require("module");
const path = require("path");

const planesPath = path.join(__dirname, "..", "src", "services", "planes.js");
const consultasIdxPath = path.join(__dirname, "..", "src", "services", "consultas.js");
const botCtrlPath = path.join(__dirname, "..", "src", "services", "consultas", "bot_control.js");

const state = {
  botActivo: true,
  cupoOk: true,
  cupoLimite: 50,
  manejarComandoBotOut: "[mock] bot reactivado",
  parseComandoBotOut: null,
};

require.cache[planesPath] = {
  id: planesPath, filename: planesPath, loaded: true,
  exports: {
    validarCupoConsultasMensual: async () => ({ ok: state.cupoOk, limite: state.cupoLimite, restante: 0 }),
  },
};
require.cache[consultasIdxPath] = {
  id: consultasIdxPath, filename: consultasIdxPath, loaded: true,
  exports: {
    obtenerEstadoBot: async () => state.botActivo,
    manejarComandoBot: async () => state.manejarComandoBotOut,
    procesarConsulta: async () => "",
  },
};
require.cache[botCtrlPath] = {
  id: botCtrlPath, filename: botCtrlPath, loaded: true,
  exports: { parseComandoBot: () => state.parseComandoBotOut },
};
Module._cache = require.cache;

const { handlerStrictSuggestion } = require("../src/services/turn_handlers/strict_suggestion");
const { handlerBotPausado } = require("../src/services/turn_handlers/bot_pausado");
const { handlerCupoExcedido } = require("../src/services/turn_handlers/cupo_excedido");

const sinIA = { replySinIA: async () => {} };

const main = async () => {
  let ok = 0, fail = 0;
  const print = (titulo, passed, det = "") => {
    console.log(`  ${passed ? "✓" : "✗"} ${titulo.padEnd(56)} ${passed ? "" : det}`);
    if (passed) ok += 1; else fail += 1;
  };

  // -------- strict_suggestion --------
  {
    const out = await handlerStrictSuggestion({
      consulta: "Hola, ¿cómo va?",
      comandoAlias: "",
      comandoNatural: "",
    });
    print("strict_suggestion: saludo libre → NO matchea", out.manejado === false);
  }
  {
    /**
     * Modo agente: `mi perfil` no matchea ninguna sugerencia exacta del
     * catálogo (no hay regla `perfil` standalone en sugerirComandoPorTexto)
     * → `strict_suggestion` AHORA debe ceder el turno al pipeline_agente
     * en vez de bloquear con texto fijo "Escribí VER COMANDOS".
     */
    const out = await handlerStrictSuggestion({
      consulta: "mi perfil",
      comandoAlias: "MI PERFIL",
      comandoNatural: "",
    });
    print(
      "strict_suggestion: prefijo MI sin sugerencia exacta → cede al pipeline",
      out.manejado === false
    );
  }
  {
    /**
     * Caso con sugerencia exacta (matchea regla `comando|comandos|ayuda|menu`):
     * sí debe responder directo con la lista corta de comandos.
     */
    const out = await handlerStrictSuggestion({
      consulta: "ayuda",
      comandoAlias: "AYUDA",
      comandoNatural: "AYUDA",
    });
    print(
      "strict_suggestion: 'ayuda' → sugerencia directa (lista corta)",
      out.manejado === true && out.route === "STRICT_SUGGESTION" && /comandos/i.test(out.respuesta || "")
    );
  }
  {
    const out = await handlerStrictSuggestion({
      consulta: "precio soja hoy",
      comandoAlias: "",
      comandoNatural: "",
    });
    print(
      "strict_suggestion: consulta operativa precio→ NO matchea",
      out.manejado === false
    );
  }

  // -------- bot_pausado --------
  state.botActivo = true;
  {
    const out = await handlerBotPausado({ jid: "x@c.us", consulta: "hola", ...sinIA });
    print("bot_pausado: bot activo → NO matchea", out.manejado === false);
  }
  state.botActivo = false;
  state.parseComandoBotOut = null;
  {
    const out = await handlerBotPausado({ jid: "x@c.us", consulta: "cualquier cosa", ...sinIA });
    print(
      "bot_pausado: pausa sin cmd → avisa pausa",
      out.manejado === true && out.route === "BOT_PAUSADO"
    );
  }
  state.parseComandoBotOut = { tipo: "ACTIVAR" };
  state.manejarComandoBotOut = "OK reactivado";
  {
    const out = await handlerBotPausado({ jid: "x@c.us", consulta: "ACTIVAR BOT", ...sinIA });
    print(
      "bot_pausado: pausa con ACTIVAR BOT → procesa cmd",
      out.manejado === true && out.route?.startsWith("CMD_BOT_CTRL_EN_PAUSA")
    );
  }

  // -------- cupo_excedido --------
  {
    const out = await handlerCupoExcedido({ planCtx: { usuario: null } });
    print("cupo_excedido: sin usuario → NO matchea", out.manejado === false);
  }
  state.cupoOk = true;
  {
    const out = await handlerCupoExcedido({
      planCtx: { usuario: { id: 1 }, planEfectivo: "gratis" },
    });
    print("cupo_excedido: cupo OK → NO matchea", out.manejado === false);
  }
  state.cupoOk = false;
  state.cupoLimite = 50;
  {
    const out = await handlerCupoExcedido({
      planCtx: { usuario: { id: 1 }, planEfectivo: "gratis" },
    });
    print(
      "cupo_excedido: cupo excedido → upsell",
      out.manejado === true &&
        out.route === "CUPO_EXCEDIDO" &&
        String(out.respuesta).includes("50")
    );
  }

  console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
  if (fail) process.exit(1);
};

main().catch((e) => { console.error("[handler mini] error:", e?.message || e); process.exit(2); });
