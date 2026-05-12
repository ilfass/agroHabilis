# Turn handlers — patrón de migración (P2#10)

Cada archivo en esta carpeta exporta **un handler** del `TurnController`
definido en `src/services/agent/turn_controller.js`.

## Patrón

```js
// src/services/turn_handlers/cmd_X.js
"use strict";

const { dependencia1 } = require("...");

/**
 * Handler para X.
 *
 * Origen: `src/config/whatsapp.js` líneas LLL-LLL.
 * Migrado en: P2#10 paso N (commit YYY).
 */
async function handlerCmdX(ctx) {
  // 1. Match: ¿este handler aplica al mensaje?
  if (!matchea(ctx)) return { manejado: false };

  // 2. Pre-condiciones (plan, perfil, etc.).
  if (!ctx.planCtx?.usuario?.id) {
    return {
      manejado: true,
      respuesta: "Primero completamos tu registro. ...",
      route: "CMD_X_SIN_USUARIO",
    };
  }

  // 3. Lógica de negocio.
  const resultado = await hacerAlgo(ctx);

  // 4. Resultado.
  return {
    manejado: true,
    respuesta: resultado,
    route: "CMD_X",
    extraLog: { ... },
  };
}

module.exports = { handlerCmdX };
```

## Registro

En `src/services/turn_handlers/index.js`:

```js
const { registrarHandler } = require("../agent/turn_controller");
const { handlerCmdX } = require("./cmd_X");

registrarHandler("cmd_X", handlerCmdX);
```

## Reglas

1. **No imports masivos.** Cada handler trae solo lo que necesita.
2. **No `msg.reply` ni `client.sendMessage` directos.** Usar `ctx.reply` /
   `ctx.replySinIA` / `ctx.send`.
3. **No logging directo con `console.log`.** Devolver `route` + `extraLog`
   y dejar que el caller registre.
4. **No mutar `ctx`.** Si necesitás cambiar algo, devolverlo en el resultado.
5. **Devolver `{ manejado: false }` rápido** cuando el handler no aplica
   (el controlador pasa al siguiente).
6. **Devolver `{ manejado: true, cederTurno: true }`** si el handler
   identificó el flujo pero quiere que otro lo resuelva (raro; usado por el
   resumen interactivo cuando detecta intent fuerte).

## Tests

Cada handler tiene su test en `scripts/test-handler-X-snapshot.js`,
listado en `package.json`:

```
npm run test:handler:flete
```

## Estado por handler

| Handler | Origen | Estado |
|---------|--------|--------|
| `cmd_flete` | whatsapp.js ~1816 | ✅ migrado (paso B) |
| `cmd_resumen` | whatsapp.js ~1828 | ✅ migrado (paso C) |
| `cmd_alertas` | whatsapp.js ~1721/1734/1746/1402 | ✅ migrado (paso D) |
| `cmd_finanzas` | whatsapp.js ~1759/1778/1795/1806/1817 | ✅ migrado (paso E) |
| `cmd_perfil_directo` | whatsapp.js ~1393–1556 (8 ramas) | ✅ migrado (paso F) |
| `cmd_cambio_plan` | whatsapp.js ~977/1006/1137/1401 (4 ramas) | ✅ migrado (paso G) |
| `cmd_borrar_cuenta` | whatsapp.js ~1293/1315 | ✅ migrado (paso H) |
| `cmd_admin` | whatsapp.js ~1239 + RESET ONBOARDING | ✅ migrado (paso I) |
| `cmd_bot_control` | whatsapp.js ~1316 (`manejarComandoBot`) | ✅ migrado (paso L.1) |
| `onboarding` | whatsapp.js ~716 (`gestionarOnboarding`) | ✅ migrado (paso L.2) |
| `resumen_interactivo` | whatsapp.js ~743 (estado conversación) | ✅ migrado (paso L.3) |
| `inventario_pendiente` | `agent/pipeline/consulta_whatsapp.js` | ⏳ vive en pipeline_agente |
| `pipeline_agente` | flujo general de `procesarConsulta` | ⏳ queda en whatsapp.js (paso M futuro) |
| `cmd_completar_perfil` | whatsapp.js ~1337 | ✅ migrado (paso J — solo rama "iniciar por intent") |
| `strict_suggestion` | whatsapp.js ~1886 | ✅ migrado (paso K) |
| `bot_pausado` | whatsapp.js ~1900 | ✅ migrado (paso K) |
| `cupo_excedido` | whatsapp.js ~1921 | ✅ migrado (paso K) |
| `onboarding` | whatsapp.js ~1070 | ⏳ pendiente (paso L) |
| `resumen_interactivo` | whatsapp.js ~1100 | ⏳ pendiente (paso L) |
| `inventario_pendiente` | agent/pipeline ~86 | ⏳ pendiente (paso L) |
| `cmd_bot_control` | whatsapp.js ~1665 | ⏳ pendiente (paso L) |
| `pipeline_agente` | consultas.js | ⏳ pendiente (paso L) |
