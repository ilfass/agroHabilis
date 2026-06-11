#!/usr/bin/env node
/**
 * Snapshot tests del handler `cmd_perfil_directo` (paso F de P2#10).
 *
 * Cubre las 8 ramas migradas desde whatsapp.js. Mockea
 * `models/usuario`, `config/database`, `services/perfil_usuario`.
 *
 * Uso: npm run test:handler:perfil-directo
 */

"use strict";

require("dotenv").config({ override: false });

const Module = require("module");
const path = require("path");

const usuarioPath = path.join(__dirname, "..", "..", "src", "models", "usuario.js");
const dbPath = path.join(__dirname, "..", "..", "src", "config", "database.js");
const perfilUsuarioPath = path.join(__dirname, "..", "..", "src", "services", "perfil_usuario.js");

const state = {
  actualizarLast: null,
  guardarCultivosLast: null,
  obtenerPerfilOut: { cultivos: [{ hectareas: 80, costo_por_ha: 500 }] },
  queryLog: [],
  perfilTipoActual: "agricultura",
  tieneGanado: false,
  cultivosActivos: false,
  upsertPerfilProductivoLast: null,
  guardarPerfilGanaderoLast: null,
  obtenerTextoPerfilOut: "[mock] perfil",
};

require.cache[usuarioPath] = {
  id: usuarioPath, filename: usuarioPath, loaded: true,
  exports: {
    actualizarUsuario: async (id, patch) => {
      state.actualizarLast = { id, patch };
    },
    guardarCultivosUsuario: async (args) => {
      state.guardarCultivosLast = args;
    },
    obtenerPerfil: async () => state.obtenerPerfilOut,
  },
};

require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: async (sql, params) => {
      state.queryLog.push({ sql: sql.replace(/\s+/g, " ").trim().slice(0, 80), params });
      if (/SELECT tipo FROM perfil_productivo/i.test(sql)) {
        return { rows: state.perfilTipoActual ? [{ tipo: state.perfilTipoActual }] : [] };
      }
      if (/FROM stock_ganadero WHERE usuario_id = \$1 LIMIT 1/i.test(sql)) {
        return { rows: state.tieneGanado ? [{ "?column?": 1 }] : [] };
      }
      if (/FROM usuario_cultivos WHERE usuario_id = \$1 AND activo = true LIMIT 1/i.test(sql)) {
        return { rows: state.cultivosActivos ? [{ "?column?": 1 }] : [] };
      }
      return { rows: [] };
    },
  },
};

require.cache[perfilUsuarioPath] = {
  id: perfilUsuarioPath, filename: perfilUsuarioPath, loaded: true,
  exports: {
    guardarPerfilGanaderoUsuario: async (args) => {
      state.guardarPerfilGanaderoLast = args;
    },
    upsertPerfilProductivo: async (usuarioId, tipo) => {
      state.upsertPerfilProductivoLast = { usuarioId, tipo };
    },
    obtenerTextoPerfilUsuario: async () => state.obtenerTextoPerfilOut,
  },
};
Module._cache = require.cache;

const { handlerCmdPerfilDirecto } = require("../../src/services/turn_handlers/cmd_perfil_directo");

const baseCtx = (extra) => ({
  jid: "549111@c.us",
  consulta: "",
  comandoAlias: "",
  planCtx: { usuario: { id: 7 }, planEfectivo: "pro" },
  ...extra,
});

const reset = () => {
  state.actualizarLast = null;
  state.guardarCultivosLast = null;
  state.queryLog.length = 0;
  state.upsertPerfilProductivoLast = null;
  state.guardarPerfilGanaderoLast = null;
};

let ok = 0, fail = 0;
const print = (titulo, passed, det = "") => {
  console.log(`  ${passed ? "✓" : "✗"} ${titulo.padEnd(64)} ${passed ? "" : det}`);
  if (passed) ok += 1; else fail += 1;
};

(async () => {
  // ---------- MI NOMBRE ----------
  reset();
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      comandoAlias: "MI NOMBRE JUAN PÉREZ",
      consulta: "MI NOMBRE Juan Pérez",
    }));
    print(
      "MI NOMBRE Juan Pérez → actualiza y confirma",
      out.manejado === true &&
        out.route === "CMD_MI_NOMBRE" &&
        state.actualizarLast?.patch?.nombre === "Juan Pérez" &&
        out.respuesta.includes("*Juan Pérez*")
    );
  }
  reset();
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      comandoAlias: "MI NOMBRE ",
      consulta: "MI NOMBRE ",
    }));
    print(
      "MI NOMBRE sin texto → formato",
      out.manejado === true && out.respuesta.includes("Juan Pérez")
    );
  }
  reset();
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      planCtx: { usuario: null },
      comandoAlias: "MI NOMBRE JUAN",
      consulta: "MI NOMBRE Juan",
    }));
    print(
      "MI NOMBRE sin usuario → onboarding",
      out.manejado === true && out.respuesta.includes("onboarding")
    );
  }

  // ---------- MI EMAIL ----------
  reset();
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      comandoAlias: "MI EMAIL JUAN@DOM.COM",
      consulta: "MI EMAIL juan@dom.com",
    }));
    print(
      "MI EMAIL juan@dom.com → guarda email",
      out.manejado === true &&
        state.actualizarLast?.patch?.email === "juan@dom.com" &&
        out.respuesta.includes("*juan@dom.com*")
    );
  }
  reset();
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      comandoAlias: "MI EMAIL CHURRO",
      consulta: "MI EMAIL churro",
    }));
    print(
      "MI EMAIL inválido → mensaje de formato",
      out.manejado === true &&
        state.actualizarLast === null &&
        /nombre@dominio/i.test(out.respuesta)
    );
  }

  // ---------- línea sólo email ----------
  reset();
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      comandoAlias: "JUAN@X.COM",
      consulta: "juan@x.com",
    }));
    print(
      "línea sólo email → guarda atajo",
      out.manejado === true &&
        out.route === "CMD_EMAIL_SOLO_LINEA" &&
        state.actualizarLast?.patch?.email === "juan@x.com"
    );
  }

  // ---------- MI ZONA ----------
  reset();
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      planCtx: { usuario: { id: 7 }, planEfectivo: "gratis" },
      comandoAlias: "MI ZONA BUENOS AIRES, TANDIL - CORDOBA, RIO CUARTO",
      consulta: "MI ZONA Buenos Aires, Tandil - Córdoba, Río Cuarto",
    }));
    print(
      "MI ZONA en plan gratis → guarda todas las zonas (sin límites por plan)",
      out.manejado === true &&
        out.respuesta.includes("Buenos Aires, Tandil") &&
        out.respuesta.includes("Córdoba, Río Cuarto")
    );
  }
  reset();
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      comandoAlias: "MI ZONA BUENOS AIRES, TANDIL",
      consulta: "MI ZONA Buenos Aires, Tandil",
    }));
    print(
      "MI ZONA en plan pro → guarda zona única",
      out.manejado === true &&
        out.respuesta.includes("Buenos Aires, Tandil")
    );
  }
  reset();
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      comandoAlias: "MI ZONA SIN_COMA",
      consulta: "MI ZONA sin_coma",
    }));
    print(
      "MI ZONA mal formato → formato",
      out.manejado === true && /Tandil/.test(out.respuesta)
    );
  }

  // ---------- MIS CULTIVOS ----------
  reset();
  state.tieneGanado = false;
  state.perfilTipoActual = "agricultura";
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      comandoAlias: "MIS CULTIVOS SOJA, MAIZ, TRIGO",
      consulta: "MIS CULTIVOS soja, maiz, trigo",
    }));
    const cultivosGuardados = state.guardarCultivosLast?.cultivos || [];
    print(
      "MIS CULTIVOS soja maiz trigo → guarda y perfil=agricultura",
      out.manejado === true &&
        cultivosGuardados.join(",") === "Soja,Maiz,Trigo" &&
        state.upsertPerfilProductivoLast?.tipo === "agricultura"
    );
  }
  reset();
  state.tieneGanado = true;
  state.perfilTipoActual = "agricultura";
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      comandoAlias: "MIS CULTIVOS SOJA",
      consulta: "MIS CULTIVOS soja",
    }));
    print(
      "MIS CULTIVOS con stock ganadero → perfil=mixto",
      out.manejado === true && state.upsertPerfilProductivoLast?.tipo === "mixto"
    );
  }

  // ---------- MI PERFIL MIXTO ----------
  reset();
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({ comandoAlias: "MI PERFIL MIXTO" }));
    print(
      "MI PERFIL MIXTO → upsert tipo=mixto",
      out.manejado === true && state.upsertPerfilProductivoLast?.tipo === "mixto"
    );
  }

  // ---------- MI GANADO ----------
  reset();
  state.cultivosActivos = true;
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      comandoAlias: "MI GANADO VACUNO NOVILLOS, PORCINO MADRES, LLAMA",
      consulta: "MI GANADO vacuno novillos, porcino madres, llama",
    }));
    const perfilesGanadero = state.guardarPerfilGanaderoLast?.perfiles || [];
    const especies = new Set(perfilesGanadero.map((p) => p.especie));
    print(
      "MI GANADO con cultivos activos → perfil=mixto y 3 especies",
      out.manejado === true &&
        state.upsertPerfilProductivoLast?.tipo === "mixto" &&
        especies.has("vacuno") &&
        especies.has("porcino") &&
        especies.has("camelido")
    );
  }
  reset();
  state.cultivosActivos = false;
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      comandoAlias: "MI GANADO VACUNO NOVILLOS",
      consulta: "MI GANADO vacuno novillos",
    }));
    print(
      "MI GANADO sin cultivos → perfil=ganaderia",
      out.manejado === true && state.upsertPerfilProductivoLast?.tipo === "ganaderia"
    );
  }

  // ---------- VER MI PERFIL ----------
  reset();
  state.obtenerTextoPerfilOut = "👤 *Tu perfil actual*\nNombre: Juan\n...";
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({ comandoAlias: "VER MI PERFIL" }));
    print(
      "VER MI PERFIL → muestra texto",
      out.manejado === true &&
        out.route === "CMD_VER_MI_PERFIL" &&
        /Tu perfil actual/.test(out.respuesta)
    );
  }

  // ---------- no match ----------
  reset();
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({ comandoAlias: "FLETE TANDIL A ROSARIO" }));
    print("no match: FLETE", out.manejado === false);
  }
  reset();
  {
    const out = await handlerCmdPerfilDirecto(baseCtx({
      comandoAlias: "HOLA",
      consulta: "hola",
    }));
    print("no match: HOLA", out.manejado === false);
  }

  console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.error("[handler perfil_directo] error:", e?.message || e);
  console.error(e?.stack);
  process.exit(2);
});
