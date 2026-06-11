"use strict";

/**
 * Handler: `cmd_perfil_directo` — comandos directos de perfil del productor.
 *
 * Unifica ocho ramas de `src/config/whatsapp.js`:
 *
 * | # | Comando                  | Línea origen | Acción                                                |
 * |---|--------------------------|--------------|-------------------------------------------------------|
 * | 1 | `MI NOMBRE <texto>`      | ~1393        | `actualizarUsuario({nombre})`                         |
 * | 2 | `MI EMAIL <email>`       | ~1409        | `actualizarUsuario({email})`                          |
 * | 3 | <línea-solo-email>       | ~1424        | `actualizarUsuario({email})` (atajo conversacional)   |
 * | 4 | `MI ZONA ...`            | ~1437        | DELETE+INSERT en `usuario_zonas`                      |
 * | 5 | `MIS CULTIVOS <lista>`   | ~1471        | `guardarCultivosUsuario` + `upsertPerfilProductivo`   |
 * | 6 | `MI PERFIL MIXTO`        | ~1512        | `upsertPerfilProductivo("mixto")`                     |
 * | 7 | `MI GANADO <cats>`       | ~1522        | DELETE+INSERT en `stock_ganadero` + ganaderia_perfil  |
 * | 8 | `VER MI PERFIL`          | ~1556        | `obtenerTextoPerfilUsuario`                           |
 *
 * Migrado en: P2#10 paso F. Las funciones de parseo y helpers de DB
 * que antes eran LOCALES en `whatsapp.js` fueron extraídos antes a
 * `services/whatsapp_parsers.js` y `services/perfil_usuario.js`.
 *
 * Convención común:
 * - Todos requieren usuario registrado (`planCtx.usuario.id`).
 *   Sin usuario → mensaje de onboarding.
 * - El parseo limita por plan (zonas: 1/3/6 según gratis/básico/pro).
 */

const { actualizarUsuario, guardarCultivosUsuario, obtenerPerfil } = require("../../models/usuario");
const { query } = require("../../config/database");
const {
  parseZonas,
  parseCultivos,
  parseEmail,
  esLineaSolamenteCorreo,
  parseGanaderiaEstructurada,
} = require("../whatsapp_parsers");
const {
  guardarPerfilGanaderoUsuario,
  upsertPerfilProductivo,
  obtenerTextoPerfilUsuario,
} = require("../perfil_usuario");

const MSG_SIN_REGISTRO =
  "Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.";

const requiereUsuario = (ctx, route, extraLog) => {
  if (!ctx?.planCtx?.usuario?.id) {
    return { manejado: true, respuesta: MSG_SIN_REGISTRO, route, extraLog };
  }
  return null;
};

const calcularMaxZonas = (planEfectivo) => 999;

/**
 * Reemplaza zonas activas del usuario por la lista nueva (limitada por plan)
 * y marca la primera como provincia/partido principal en `usuarios`.
 */
const guardarZonasUsuario = async ({ usuarioId, zonas, maxZonas }) => {
  const zonasLimitadas = zonas.slice(0, maxZonas);
  await query("DELETE FROM usuario_zonas WHERE usuario_id = $1", [usuarioId]);
  for (let i = 0; i < zonasLimitadas.length; i += 1) {
    const z = zonasLimitadas[i];
    await query(
      `
        INSERT INTO usuario_zonas (usuario_id, provincia, partido, prioridad, activa)
        VALUES ($1, $2, $3, $4, true)
      `,
      [usuarioId, z.provincia, z.partido, i + 1]
    );
  }
  if (zonasLimitadas[0]) {
    await actualizarUsuario(usuarioId, zonasLimitadas[0]);
  }
  return zonasLimitadas;
};

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerCmdPerfilDirecto(ctx) {
  const alias = String(ctx?.comandoAlias || "").toUpperCase();
  const consulta = String(ctx?.consulta || "");
  const usuarioId = ctx?.planCtx?.usuario?.id;

  // ---------- 1) MI NOMBRE <texto> ----------
  if (alias.startsWith("MI NOMBRE ")) {
    const gate = requiereUsuario(ctx, "CMD_MI_NOMBRE");
    if (gate) return gate;
    const nombre = consulta.slice("MI NOMBRE ".length).trim();
    if (!nombre) {
      return {
        manejado: true,
        respuesta: 'Formato: "MI NOMBRE Juan Pérez"',
        route: "CMD_MI_NOMBRE",
      };
    }
    await actualizarUsuario(usuarioId, { nombre });
    return {
      manejado: true,
      respuesta: `✅ Listo, actualicé tu nombre a *${nombre}*.`,
      route: "CMD_MI_NOMBRE",
      extraLog: { nombre },
    };
  }

  // ---------- 2) MI EMAIL <email> ----------
  if (alias.startsWith("MI EMAIL ")) {
    const gate = requiereUsuario(ctx, "CMD_MI_EMAIL");
    if (gate) return gate;
    const email = parseEmail(consulta.replace(/^\s*MI\s+EMAIL\s+/i, "").trim());
    if (!email) {
      return {
        manejado: true,
        respuesta: 'Formato: "MI EMAIL nombre@dominio.com" (o mandá solo el correo).',
        route: "CMD_MI_EMAIL",
      };
    }
    await actualizarUsuario(usuarioId, { email });
    return {
      manejado: true,
      respuesta: `✅ Listo, guardé tu email: *${email}*.\n\n💡 *Tip:* Ahora podés pedirme el plan de suscripción que desees chateando conmigo (ej: *QUIERO PLAN PRO*) y te generaré el link de pago al instante.`,
      route: "CMD_MI_EMAIL",
      extraLog: { email },
    };
  }

  // ---------- 3) línea sólo email (atajo conversacional) ----------
  const emailSolo = esLineaSolamenteCorreo(consulta);
  if (emailSolo) {
    const gate = requiereUsuario(ctx, "CMD_EMAIL_SOLO_LINEA");
    if (gate) return gate;
    await actualizarUsuario(usuarioId, { email: emailSolo });
    return {
      manejado: true,
      respuesta: `✅ Listo, guardé tu email: *${emailSolo}*.\n\n💡 *Tip:* Ahora podés pedirme el plan de suscripción que desees chateando conmigo (ej: *QUIERO PLAN PRO*) y te generaré el link de pago al instante.`,
      route: "CMD_EMAIL_SOLO_LINEA",
      extraLog: { email: emailSolo },
    };
  }

  // ---------- 4) MI ZONA <prov, part [- prov, part]> ----------
  if (alias.startsWith("MI ZONA ")) {
    const gate = requiereUsuario(ctx, "CMD_MI_ZONA");
    if (gate) return gate;
    const zonas = parseZonas(consulta.slice("MI ZONA ".length).trim());
    if (!zonas.length) {
      return {
        manejado: true,
        respuesta: 'Formato: "MI ZONA Buenos Aires, Tandil - Córdoba, Río Cuarto"',
        route: "CMD_MI_ZONA",
      };
    }
    const maxZonas = calcularMaxZonas(ctx?.planCtx?.planEfectivo);
    const zonasLimitadas = await guardarZonasUsuario({ usuarioId, zonas, maxZonas });
    return {
      manejado: true,
      respuesta:
        `✅ Zonas actualizadas:\n` +
        zonasLimitadas.map((z) => `- ${z.provincia}, ${z.partido}`).join("\n"),
      route: "CMD_MI_ZONA",
      extraLog: { cantidad: zonasLimitadas.length, max: maxZonas },
    };
  }

  // ---------- 5) MIS CULTIVOS <lista> ----------
  if (alias.startsWith("MIS CULTIVOS ")) {
    const gate = requiereUsuario(ctx, "CMD_MIS_CULTIVOS");
    if (gate) return gate;
    const cultivos = parseCultivos(consulta.slice("MIS CULTIVOS ".length).trim());
    if (!cultivos.length) {
      return {
        manejado: true,
        respuesta: 'Formato: "MIS CULTIVOS soja, maiz, trigo"',
        route: "CMD_MIS_CULTIVOS",
      };
    }
    const perfilActual = await obtenerPerfil(ctx.jid);
    await guardarCultivosUsuario({
      usuarioId,
      cultivos,
      hectareas: perfilActual?.cultivos?.[0]?.hectareas ?? null,
      costoPorHa: perfilActual?.cultivos?.[0]?.costo_por_ha ?? null,
    });
    /**
     * Decidir el tipo de perfil productivo:
     * - Si ya era ganadero, queda "mixto".
     * - Si tiene stock de hacienda actual, queda "mixto".
     * - Si no, "agricultura".
     */
    const perfilTipoActual = await query(
      `
        SELECT tipo
        FROM perfil_productivo
        WHERE usuario_id = $1 AND activo = true
        ORDER BY id DESC
        LIMIT 1
      `,
      [usuarioId]
    );
    const eraGanadero =
      String(perfilTipoActual.rows[0]?.tipo || "").toLowerCase() === "ganaderia";
    const tieneGanado = await query(
      "SELECT 1 FROM stock_ganadero WHERE usuario_id = $1 LIMIT 1",
      [usuarioId]
    );
    await upsertPerfilProductivo(
      usuarioId,
      tieneGanado.rows[0] || eraGanadero ? "mixto" : "agricultura"
    );
    return {
      manejado: true,
      respuesta: `✅ Cultivos actualizados: *${cultivos.join(", ")}*.`,
      route: "CMD_MIS_CULTIVOS",
      extraLog: { cultivos },
    };
  }

  // ---------- 6) MI PERFIL MIXTO ----------
  if (alias === "MI PERFIL MIXTO") {
    const gate = requiereUsuario(ctx, "CMD_MI_PERFIL_MIXTO");
    if (gate) return gate;
    await upsertPerfilProductivo(usuarioId, "mixto");
    return {
      manejado: true,
      respuesta: "✅ Perfil productivo actualizado a *mixto* (cultivos + ganadería).",
      route: "CMD_MI_PERFIL_MIXTO",
    };
  }

  // ---------- 7) MI GANADO <categorías> ----------
  if (alias.startsWith("MI GANADO ")) {
    const gate = requiereUsuario(ctx, "CMD_MI_GANADO");
    if (gate) return gate;
    const catsTxt = consulta.slice("MI GANADO ".length).trim();
    const { categorias, perfiles } = parseGanaderiaEstructurada(catsTxt);
    if (!categorias.length) {
      return {
        manejado: true,
        respuesta:
          'Formato: "MI GANADO vacuno novillos, vacuno terneros, porcino madres, llama"',
        route: "CMD_MI_GANADO",
      };
    }
    /** Reemplaza stock_ganadero de HOY (no histórico). */
    await query(
      "DELETE FROM stock_ganadero WHERE usuario_id = $1 AND fecha = CURRENT_DATE",
      [usuarioId]
    );
    for (const categoria of categorias) {
      await query(
        `
          INSERT INTO stock_ganadero (usuario_id, categoria, cantidad, fecha)
          VALUES ($1, $2, $3, CURRENT_DATE)
        `,
        [usuarioId, categoria, 1]
      );
    }
    await guardarPerfilGanaderoUsuario({ usuarioId, perfiles });
    const cultivosActivos = await query(
      "SELECT 1 FROM usuario_cultivos WHERE usuario_id = $1 AND activo = true LIMIT 1",
      [usuarioId]
    );
    await upsertPerfilProductivo(usuarioId, cultivosActivos.rows[0] ? "mixto" : "ganaderia");
    const especies = [...new Set(perfiles.map((p) => p.especie))];
    return {
      manejado: true,
      respuesta:
        `✅ Ganado/categorías actualizadas: *${categorias.join(", ")}*.\n` +
        `Especies detectadas: *${especies.join(", ")}*.`,
      route: "CMD_MI_GANADO",
      extraLog: { categorias, especies },
    };
  }

  // ---------- 8) VER MI PERFIL ----------
  if (alias === "VER MI PERFIL") {
    const gate = requiereUsuario(ctx, "CMD_VER_MI_PERFIL");
    if (gate) return gate;
    const textoPerfil = await obtenerTextoPerfilUsuario(usuarioId);
    return {
      manejado: true,
      respuesta: textoPerfil,
      route: "CMD_VER_MI_PERFIL",
    };
  }

  return { manejado: false };
}

module.exports = { handlerCmdPerfilDirecto };
