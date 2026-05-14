# Plan: Arquitectura Tool-First para AgroHabilis

**Objetivo:** eliminar la necesidad de agregar heurísticas o regex para manejar nuevos casos.
El LLM pasa a ser el router; las rutas existentes se exponen como tools con schema JSON.

**Estado de partida (2026-05-14):** el código ya tiene los cimientos —
`unified_turn_loop.js`, `registry.js`, `builtins_router.js`, `AGENT_WHATSAPP_SOLO_AGENTE` —
pero el camino de producción todavía pasa por el clasificador clásico.

---

## Por qué el clasificador + switch es el cuello de botella

| Problema actual | Consecuencia |
|-----------------|--------------|
| Clasificador Groq/Gemini → falla → heurística | Regex crece con cada caso borde |
| `switch(intencion)` en `router.js` | Nuevo tipo de pregunta = código nuevo obligatorio |
| `detectarPreguntaAmbiguaCatchAll` en pipeline | Regex que ya tiene 8 casos y va a seguir creciendo |
| Gate de dominio antes del router | Otra capa con su propia cadena IA + fallback |
| Cada ruta hace su propio `detectarCultivo*`, `esConsultaDolar`, `esConsultaHaciendaVenta` | Lógica de NLU distribuida y duplicada |

Con tool-calling, **todo eso desaparece**: el LLM lee el mensaje y llama directamente
`get_prices({ cultivo: "soja" })` o `get_prices({ variante: "dolar" })`.
No hay switch. No hay regex de intención.

---

## El modelo mental nuevo

```
mensaje WhatsApp
  → system prompt (perfil usuario + historial últimas N interacciones)
  → LLM con tools disponibles
      → tool_call: get_prices({ cultivo, mercado?, variante? })
         ↓  lógica de negocio determinista (rutaPrecio actual, sin cambios)
      → tool_call: get_weather({ zona? })
         ↓  (rutaClima actual)
      → tool_call: register_movement({ tipo, cultivo, cantidad, precio? })
         ↓  (rutaRegistrar actual)
      ...
  → LLM formatea respuesta final con los datos reales
```

**Las rutas no cambian su lógica interna.**
Solo se envuelven en un `registerTool()` con schema JSON descriptivo.
El LLM elige cuál llamar y con qué parámetros.

---

## Etapas de implementación

### Etapa 0 — Preparación (sin romper nada) [~1 sesión]

No toca el camino de producción. Solo sienta bases.

**0.1 — Crear `src/services/agent/tools/domain_tools.js`**

Un archivo nuevo que registra las rutas como tools `domain.*`:

```js
registerTool({
  name: "domain.get_prices",
  description: "Obtiene precios actuales de granos, hacienda, insumos o dólar. " +
    "Usá esta tool cuando el productor pida cualquier cotización o precio.",
  parameters: {
    type: "object",
    properties: {
      cultivo: {
        type: "string",
        description: "Grano: soja, maiz, trigo, girasol, cebada, sorgo. Null si no aplica."
      },
      variante: {
        type: "string",
        enum: ["dolar", "dolar_blue", "hacienda", "insumos"],
        description: "Tipo especial si no es un grano."
      },
      mercado: {
        type: "string",
        description: "Opcional: rosario, ba, cac."
      }
    }
  },
  execute: async (ctx, args) => {
    const { rutaPrecio } = require("../../rutas/precio");
    const patch = {};
    if (args.cultivo) patch.cultivo = args.cultivo;
    if (args.variante === "dolar" || args.variante === "dolar_blue") patch.variante_precio = "dolar";
    if (args.variante === "hacienda") patch.producto = "hacienda";
    if (args.variante === "insumos") patch.producto = "insumos";
    const clasificacion = { ...ctx.clasificacion, intencion: "precio", ...patch };
    const texto = await rutaPrecio({ clasificacion, mensaje: ctx.mensaje, usuario: ctx.usuario });
    return { texto: String(texto || "").trim() };
  }
});
```

Misma idea para las otras rutas:

| Tool name | Ruta actual | Parámetros clave |
|-----------|-------------|------------------|
| `domain.get_prices` | `rutas/precio.js` | `cultivo`, `variante`, `mercado` |
| `domain.get_weather` | `rutas/clima.js` | `zona` (usa perfil si null) |
| `domain.register_movement` | `rutas/registrar.js` | `tipo`, `cultivo`, `cantidad`, `precio`, `unidad` |
| `domain.get_records` | `rutas/consulta_registros.js` | `tipo` (finanzas/inventario/todo) |
| `domain.market_analysis` | `rutas/analisis_mercado.js` | `cultivo`, `horizonte` |
| `domain.internal_analysis` | `rutas/analisis_interno.js` | — |
| `domain.run_command` | `rutas/comando.js` | `comando` (MI RESUMEN, VER COMANDOS, etc.) |
| `domain.agro_general` | `rutas/agro_general.js` | `tema` |

**0.2 — Cargar en `tools/index.js`**

```js
require("./domain_tools"); // nuevo
```

**0.3 — Variable de entorno nueva: `AGENT_TOOL_FIRST_MODE`**

Con `=0` (default por ahora) → comportamiento actual.
Con `=1` → nuevo pipeline tool-first.

Esto permite activar en VPS sin código de branching en el pipeline principal.

---

### Etapa 1 — Pipeline tool-first como modo alternativo [~2 sesiones]

Crear `src/services/agent/ia/tool_first_turn.js` — un loop limpio y simple:

```
1. Armar system prompt con:
   - Descripción del agente (AgroHabilis, WhatsApp, es-AR)
   - Perfil del usuario (zona, cultivos, plan)
   - Historial últimas N interacciones (ya viene de historialReciente)
   - Instrucción: "No inventes cifras. Llamá la tool correcta."

2. Llamada LLM con tools: domain.* + agent.turn_step

3. Loop hasta que el LLM devuelva texto (sin tool_calls):
   - Si llama una domain.* → ejecutar → agregar resultado → continuar
   - Si ya tiene texto → eso es la respuesta final

4. Validación mínima: respuesta no vacía
```

Este loop **no necesita clasificador**. El LLM decide qué tool llamar leyendo el mensaje y el historial.

**Activación en pipeline:**

En `consulta_whatsapp.js`, antes del bloque actual de clasificación:

```js
const { toolFirstModeHabilitado, ejecutarToolFirstTurn } = require("../ia/tool_first_turn");

if (toolFirstModeHabilitado()) {
  const resultado = await ejecutarToolFirstTurn({ usuario, numeroWhatsapp, mensaje: textoTrabajo, historialReciente });
  if (resultado?.texto) {
    await guardarConsulta({ ... respuesta: resultado.texto, iaProvider: "tool_first" });
    return resultado.texto;
  }
  // si falla → cae al camino actual como fallback
}
```

---

### Etapa 2 — System prompt de producción [~1 sesión]

El system prompt es la clave. Tiene que comunicar al LLM exactamente cuándo usar cada tool.

Estructura:

```
Sos AgroHabilis, asistente agropecuario por WhatsApp para productores argentinos.
Respondé siempre en español rioplatense, tono directo y concreto.

REGLA CRÍTICA: No inventes precios, cifras de clima ni datos del campo del productor.
Para eso tenés tools. Siempre llamá la tool correcta antes de responder datos de mercado o campo.

Usuario: [nombre], zona [provincia/partido], cultivos: [lista], plan: [free/basic/pro]

Últimas interacciones:
[historial formateado: Productor: X / Vos: Y]

Tools disponibles:
- domain.get_prices: precios de granos, hacienda, dólar, insumos
- domain.get_weather: clima y alertas para su zona
- domain.register_movement: registrar venta, gasto o movimiento de inventario
- domain.get_records: consultar sus registros y finanzas
- domain.market_analysis: análisis de mercado con noticias
- domain.internal_analysis: análisis basado en los datos del productor
- domain.run_command: ejecutar comandos como MI RESUMEN, VER COMANDOS, etc.
- domain.agro_general: consultas agro que no encajan en otra categoría

Si el mensaje es conversacional sin necesitar datos → respondé directo sin tool.
```

---

### Etapa 3 — Reemplazar `agent.invoke_router` como herramienta de cierre

Con tool-first, `agent.invoke_router` (que delega al switch del router)
pasa a ser el fallback de último recurso, no el camino principal.

El camino principal es: **LLM llama `domain.*` directamente**.

`agent.invoke_router` queda como seguro de red: si el LLM no sabe qué tool usar,
puede llamarlo y el motor clásico responde.

---

### Etapa 4 — Activar por defecto y deprecar el clasificador [después de validación]

Una vez que Etapa 1 y 2 están validadas en producción con métricas reales:

1. Cambiar default de `AGENT_TOOL_FIRST_MODE` a `=1`
2. Mover el clasificador clásico a `clasificador_legacy.js` (no eliminar, útil para analytics)
3. Eliminar `detectarPreguntaAmbiguaCatchAll` del pipeline principal (el LLM maneja esos casos)
4. Eliminar `debeSolicitarAclaracionIntencion` (idem)
5. El gate de dominio pasa a ser una tool opcional `agent.check_domain` que el LLM puede llamar o no

---

## Qué NO cambia en ninguna etapa

- La lógica interna de cada ruta (`rutaPrecio`, `rutaClima`, etc.)
- El acceso a datos (DB, APIs externas, scrapers)
- La sesión WhatsApp
- Los jobs diarios
- El deploy
- La persistencia en `historial_consultas`

---

## Ventajas concretas de este approach

| Antes | Después |
|-------|---------|
| Nueva intención → regex + código de ruta nueva | Nueva capacidad → `registerTool()` con description |
| "El novillo" falla → agregar regex en `precio.js` | LLM infiere `domain.get_prices({ variante: "hacienda" })` |
| "Y con respecto al X" → catch-all regex | LLM lee historial y llama la tool adecuada |
| Clasificador falla → heurística | No hay clasificador: el LLM entiende la intención |
| Agregar Ollama al clasificador = refactor | Agregar modelo = cambiar config de OpenRouter |

---

## Métricas a monitorear durante la transición

- `iaProvider = "tool_first"` en `historial_consultas` → tasa de activación
- `tool_call` más frecuente en trazas → validar que el LLM elige bien
- Tasa de fallback a `agent.invoke_router` → debería bajar con el tiempo
- Latencia por turno → tool-first puede ser 1 llamada menos que clasificador + router

---

## Orden de trabajo recomendado

```
Sesión 1:  Etapa 0 — domain_tools.js con get_prices y get_weather
Sesión 2:  Etapa 0 — rest of domain tools + cargar en index
Sesión 3:  Etapa 1 — tool_first_turn.js + branching en pipeline
Sesión 4:  Etapa 2 — system prompt production-grade
Sesión 5:  Testing en VPS con AGENT_TOOL_FIRST_MODE=1 en staging
Sesión 6+: Ajustes según métricas reales → Etapa 3 y 4
```

---

*Documento creado 2026-05-14. Actualizar conforme avancen las etapas.*
