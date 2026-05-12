# Propuesta: centralizar controlador de turno (P2#10)

> **Estado:** EN EJECUCIÓN — 9/17 handlers migrados, infraestructura
> completa, deployado en producción con feature flag OFF (comportamiento
> idéntico al anterior). Cada paso es un PR/commit pequeño con QA propio.
>
> **Progreso (al 2026-05-12):**
>
> | Paso | Handler(s) | Estado | Commit |
> |------|-----------|--------|--------|
> | A | infra (`run` + flag + whitelist) | ✅ | `f2ff8ed` |
> | B | `cmd_flete` | ✅ | `f2ff8ed` |
> | C | `cmd_resumen` | ✅ | `7d99dd0` |
> | D | `cmd_alertas` (4 ramas) | ✅ | `d0f432d` |
> | E | `cmd_finanzas` (6 ramas) | ✅ | `2513bce` |
> | K | `strict_suggestion` + `bot_pausado` + `cupo_excedido` | ✅ | `6636ea1` |
> | H | `cmd_borrar_cuenta` | ✅ | `4caf48d` |
> | J | `cmd_completar_perfil` (parcial) | ✅ | `4caf48d` |
> | F | `cmd_perfil_directo` | ⛔ bloqueado | — |
> | G | `cmd_cambio_plan` | ⛔ bloqueado | — |
> | I | `cmd_admin` | ⛔ bloqueado | — |
> | L | `onboarding`, `resumen_interactivo`, `inventario_pendiente`, `cmd_bot_control`, `pipeline_agente` | ⏳ stateful | — |
>
> **Bloqueos identificados** (requieren tarea previa):
>
> - **Paso F (`cmd_perfil_directo`)**: ~8 funciones LOCALES de whatsapp.js
>   no exportadas (`parseEmail`, `esLineaSolamenteCorreo`, `parseZonas`,
>   `parseCultivos`, `parseGanaderiaEstructurada`,
>   `guardarPerfilGanaderoUsuario`, `upsertPerfilProductivo`,
>   `obtenerTextoPerfilUsuario`). Previo: extraer a
>   `src/services/whatsapp_parsers.js` y `src/services/perfil_usuario/...`.
> - **Paso G (`cmd_cambio_plan`)**: lógica de suscripciones MP y planes
>   está mezclada con UI text en whatsapp.js. Previo: extraer
>   `aplicarCambioPlanWhatsapp` a `services/planes/cambio.js`.
> - **Paso I (`cmd_admin`)**: `responderComandoAdmin` y
>   `resetOnboardingNumero` son funciones locales de whatsapp.js con
>   deps anidadas (`normalizarNumero`, `formatearFecha`,
>   `estadoProveedorIA`, `obtenerEstadoSistemaTexto`,
>   `resumenFuentesWhatsapp`). Previo: mover a `services/admin/comandos.js`.
> - **Paso L (stateful)**: handlers con estado conversacional crítico —
>   tocar onboarding puede romper alta de productores. Requiere QA con
>   números reales en staging antes de migrar.
>
> **Próximos pasos recomendados:**
>
> 1. Activar `AGENT_TURN_CONTROLLER=1 AGENT_TURN_CONTROLLER_HANDLERS=cmd_flete`
>    en producción y validar 24h.
> 2. Ir agregando handlers a la whitelist uno por uno; con `cmd_flete`,
>    `cmd_resumen`, `cmd_alertas`, `cmd_finanzas`, `cmd_borrar_cuenta`,
>    `cmd_completar_perfil`, `strict_suggestion`, `bot_pausado` y
>    `cupo_excedido` ya validados, **eliminar el código viejo de
>    whatsapp.js** correspondiente (esto es el paso "13" del plan).
> 3. PR de extracción de funciones locales (preparatorio para F/G/I).
> 4. Migrar F, G, I detrás de flag.
> 5. Migrar paso L (stateful) con QA dedicada en staging.

## 1. Por qué

Hoy `src/config/whatsapp.js > procesarMensajeEntranteWhatsapp` tiene ~900
líneas con `if/else/return` que dispatchan al onboarding, resumen
interactivo, comandos hardcoded (MI NOMBRE / MI EMAIL / MI ZONA / etc.),
flujos de pago, alertas, gastos, ventas, flete, sugerencias estrictas,
chequeo de bot pausado y finalmente el pipeline agente.

**Problemas concretos:**

1. **Prioridad implícita.** Si onboarding está activo y el productor
   manda `MI RESUMEN`, ¿qué gana? Sale del orden textual de los `if`,
   no de un diseño declarado. Cualquier `return` mal puesto cambia el
   contrato sin avisar.
2. **Spaghetti de duplicación.** "Si no hay usuario, decirle que
   complete onboarding" aparece literalmente en ~15 ramas.
3. **Casi imposible de testear.** Cada rama es un mini-flujo que mezcla
   parseo, validación, DB y reply. No hay forma de hacer snapshot.
4. **Riesgo de regresión alto.** Un cambio en el orden (por ejemplo,
   mover `MI RESUMEN` antes de `MIS NOTICIAS`) puede romper N flujos
   sin que ningún test lo detecte.

## 2. Objetivo

Reducir `procesarMensajeEntranteWhatsapp` a:

```js
async function procesarMensajeEntranteWhatsapp(msg) {
  if (msg.from?.includes("@g.us")) return;
  if (msg.from?.includes("@broadcast")) return;
  if (msg.fromMe) return;

  const ctx = await TurnController.buildContext({ msg, client });
  const out = await TurnController.run(ctx);
  // Logging, reply, captura — todo en helpers reutilizables.
  if (out?.respuesta) await ctx.reply(out.respuesta);
}
```

Y mover toda la lógica actual a **handlers individuales** en
`src/services/turn_handlers/*.js`, registrados en el `TurnController`.

## 3. Cadena de decisión propuesta (orden estricto)

| # | Handler | Origen actual en whatsapp.js | Prioridad |
|---|---------|------------------------------|-----------|
| 1 | `cmd_bot_control` | `parseComandoBot` (línea ~1665) | **Siempre primero** |
| 2 | `onboarding` | `gestionarOnboarding` (línea ~1070) | Solo no-admin |
| 3 | `resumen_interactivo` | bloque `est?.flujo === "resumen_interactivo"` (~1100) | Con escape P0#1 |
| 4 | `inventario_pendiente` | hoy vive en `agent/pipeline/consulta_whatsapp.js`, falta extraerlo | Confirmación SI/NO |
| 5 | `cmd_cambio_plan` | `QUIERO PLAN ...` (~1138, ~1167, ~1298, ~1562) | Acepta natural |
| 6 | `cmd_perfil_directo` | `MI NOMBRE` / `MI EMAIL` / `MI ZONA` / `MIS CULTIVOS` / `MI GANADO` / `VER MI PERFIL` / `MI PERFIL MIXTO` (~1393–1560) | Por palabra clave |
| 7 | `cmd_borrar_cuenta` | `BORRAR MIS DATOS` + `SI BORRO MIS DATOS` (~1245–1287) | 2 pasos |
| 8 | `cmd_completar_perfil` | `gestionarCompletarPerfil` (~1657) | Continuación de flujo |
| 9 | `cmd_admin` | `responderComandoAdmin` + `RESET ONBOARDING` (~1589–1619) | Solo admin |
| 10 | `cmd_alertas` | ALERTA / AVISAME / MIS ALERTAS / CANCELAR ALERTA (~1673–1709) | Plan ≥ básico |
| 11 | `cmd_finanzas` | GASTÉ / COMPRÉ / VENDÍ / MIS GASTOS / MIS VENTAS / MI MARGEN (~1711–1778) | Plan pro |
| 12 | `cmd_resumen` | `MI RESUMEN` (~1780) | |
| 13 | `cmd_flete` | `FLETE X A Y` (~1816) | |
| 14 | `strict_suggestion` | "parece comando" (~1838) | Antes de IA libre |
| 15 | `bot_pausado` | `obtenerEstadoBot` (~1852) | |
| 16 | `cupo_excedido` | `validarCupoConsultasMensual` (~1873) | |
| 17 | `pipeline_agente` | `procesarConsulta` actual de `consultas.js` (~1903) | Default final |

## 4. Plan de migración por pasos (PRs separados)

Cada paso es **un PR** con:
- Su propio commit
- Snapshot tests del handler (`scripts/test-handler-X.js`)
- QA manual contra producción staging
- Deploy verificado antes del próximo paso

### Paso A — Infraestructura (sin tocar lógica)
1. ✅ Crear `src/services/agent/turn_controller.js` (este PR).
2. Crear `src/services/turn_handlers/` con un `README.md` que explique
   el patrón handler.
3. Agregar feature flag `AGENT_TURN_CONTROLLER=0` en `.env.example`.

### Paso B — Migrar handler trivial primero: `cmd_flete`
1. Extraer las 21 líneas del FLETE a `turn_handlers/cmd_flete.js`.
2. Registrar con `TurnController.registrarHandler("cmd_flete", fn)`.
3. En `whatsapp.js`, *no* tocar el código actual: solo agregar:
   ```js
   if (process.env.AGENT_TURN_CONTROLLER === "1") {
     const out = await ejecutarTurno(ctx);
     if (out.manejado) {
       if (out.respuesta) await ctx.reply(out.respuesta);
       return;
     }
   }
   ```
   **antes** del código actual. Con flag en 0, no cambia nada.
4. Tests: `scripts/test-handler-flete-snapshot.js`.
5. Deploy con flag en 0. Validar que NO se rompió nada.
6. Activar flag en 1 en staging. Probar `FLETE Tandil A Rosario`.
7. Si OK, eliminar el bloque viejo de FLETE en `whatsapp.js`.

### Paso C — Migrar `cmd_resumen` (MI RESUMEN)
Mismo patrón que paso B.

### Paso D — Migrar `cmd_alertas` (4 sub-handlers en uno)
Familia de comandos relacionados.

### Paso E — Migrar `cmd_finanzas` (6 sub-handlers)
Idem.

### Paso F — Migrar `cmd_perfil_directo` (MI NOMBRE / EMAIL / ZONA / etc.)
Familia más grande, mayor cuidado con tests.

### Paso G — Migrar `cmd_cambio_plan`
Tres puntos hoy (~1138, ~1167, ~1298, ~1562) deben fusionarse en uno.

### Paso H — Migrar `cmd_borrar_cuenta` (2 pasos)
Cuidar el estado entre el pedido y la confirmación.

### Paso I — Migrar `cmd_admin`
Solo afecta admins, riesgo bajo.

### Paso J — Migrar `cmd_completar_perfil`
Flujo conversacional con estado en BD.

### Paso K — Migrar `cmd_borrar_cuenta`, `strict_suggestion`, `bot_pausado`, `cupo_excedido`
Los handlers menos críticos al final.

### Paso L — Migrar `inventario_pendiente` y `resumen_interactivo` y `onboarding`
Los stateful que ya tienen tests (P0#1). Mover desde `agent/pipeline` y desde
`whatsapp.js` a `turn_handlers/*`.

### Paso M — Cleanup
Una vez que TODOS los handlers migraron, eliminar el código viejo en
`whatsapp.js`. `procesarMensajeEntranteWhatsapp` queda en ~15 líneas.

## 5. Tests

Cada handler debe tener:
- **Unit:** `handler(ctxMock) → resultado esperado`, mockeando DB e IA.
- **Snapshot:** comportamiento estable en N inputs típicos.
- **Integración:** opcional, `procesarMensajeEntranteWhatsapp` end-to-end con
  un cliente WhatsApp mockeado.

## 6. Riesgos y mitigación

| Riesgo | Mitigación |
|--------|------------|
| Cambiar orden rompe contrato | Migración con flag OFF por default + A/B en staging |
| Handlers que dependen de estado mutable de `ctx` | `ctx` immutable; cambios vía `patch` explícito |
| Logging/captura/humanización dispersa | Centralizar en `buildContext` (DRY) |
| Tests insuficientes | Cada paso bloqueado hasta tener snapshot del handler que migra |

## 7. Cómo empezar (cuando se decida ejecutar)

1. Leer este documento + `src/services/agent/turn_controller.js`.
2. Elegir un paso (B es el más seguro para empezar).
3. Crear branch `feat/turn-controller-paso-X`.
4. Implementar el handler en `src/services/turn_handlers/`.
5. Tests + commit + deploy con flag OFF.
6. Activar flag en staging.
7. PR review.
8. Merge + deploy a producción.
9. Eliminar el código viejo de `whatsapp.js`.
10. Siguiente paso.

## 8. No hacer

- ❌ Migrar dos handlers en el mismo PR.
- ❌ Cambiar lógica de negocio durante la migración (lift-and-shift, no
  refactor de reglas).
- ❌ Quitar el código viejo de `whatsapp.js` antes de activar el flag.
- ❌ Activar el flag en producción sin pasar antes por staging mínimo 24h.
