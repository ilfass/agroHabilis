# Arquitectura: consultas WhatsApp (referencia canónica)

Documento corto para **humanos y asistentes**: evita suposiciones obsoletas sobre dónde vive el flujo.

## Orden real del mensaje (consulta libre)

1. `src/config/whatsapp.js` — onboarding, comandos tipo MI RESUMEN, detección de intención auxiliar, etc.
2. `src/services/consultas.js` — **solo** comandos de control del bot (`PAUSAR BOT`, `ACTIVAR BOT`, `ESTADO BOT` vía `consultas/bot_control.js`) y delegación del resto.
3. `src/services/agent/pipeline/consulta_whatsapp.js` — inventario pendiente (si aplica) → **[Tool-first mode]** (si `AGENT_TOOL_FIRST_MODE=1`) → clasificador → diálogo hilo registro → **gate de dominio** → **scout opcional** → **pasos del plan** → **cadena OAV** → rutas → `guardarConsulta` cuando corresponde.

### Camino tool-first (`AGENT_TOOL_FIRST_MODE=1`)

Activado con `AGENT_TOOL_FIRST_MODE=1` + `OPENROUTER_API_KEY`.
Implementado en `agent/ia/tool_first_turn.js`.

El LLM recibe el mensaje + perfil del usuario + historial reciente y llama directamente
una `domain.*` tool sin pasar por el clasificador ni el switch del router:

| Tool | Equivalente clásico | Cuándo usarla |
|------|--------------------|---------------|
| `domain.get_prices` | `rutas/precio.js` | Precios de granos, hacienda, insumos, dólar |
| `domain.get_weather` | `rutas/clima.js` | Clima, pronóstico, alertas |
| `domain.register_movement` | `rutas/registrar.js` | Venta, gasto, stock |
| `domain.get_records` | `rutas/consulta_registros.js` | Mis gastos, ventas, inventario, lotes |
| `domain.market_analysis` | `rutas/analisis_mercado.js` | Análisis de mercado, noticias |
| `domain.my_analysis` | `rutas/analisis_interno.js` | Análisis basado en datos del productor |
| `domain.run_command` | `rutas/comando.js` | MI RESUMEN, VER COMANDOS, PLANES, etc. |
| `domain.agro_general` | `rutas/agro_general.js` | Consultas generales, saludos, ayuda |

Si el modo tool-first no devuelve texto → **fallback silencioso al pipeline clásico** (clasificador + router).
Las domain tools están registradas en `agent/tools/domain_tools.js` y cargadas en `agent/tools/index.js`.

4. Rutas bajo `src/services/rutas/` y helpers en `src/services/consultas/legacy_helpers.js` — plantillas (`renderTemplate("consulta", …)`). La plantilla **`consulta`** arma datos en `recolectarDatos` y en **`renderizar`** (`src/templates/consulta.js`): la capa de redacción usa **`generarConPromptLibre`** (Gemini vía `src/services/gemini.js`), más **grounding** opcional; si la IA falla, queda **respuesta base** (y bloque *Base AgroHabilis* cuando aplique). El agente con tools `consulta_agent_openrouter.js` no se cablea desde `renderizar`. Otras partes del producto usan OpenRouter/Gemini/Groq/Ollama vía `agent/ia/json_chain.js` donde aplique.

## Ayudante local (Ollama), sin costo de API

- **Qué es:** otro proveedor en la misma cadena JSON que ya usan gates y dominio (`src/services/agent/ia/json_chain.js`). Con `OLLAMA_ENABLED=1` se incluye **solo al final** del orden (resguardo): aunque en `AGENT_GATE_IA_ORDER` / `AGENT_DOMINIO_IA_ORDER` escribas `ollama` antes que otros, el código lo **mueve al final** para que nube intente primero.
- **Código:** `src/services/ollama.js` (`generarChatOllama`, `ollamaHabilitado`).
- **Variables:** ver `.env.example` (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS`).
- **Instalación típica:** instalar Ollama, `ollama pull <modelo>`, levantar el servicio; no hace falta cambiar `package.json`.
- **Alcance actual:** entra en **`ejecutarJsonConCadenaIA`** (gate precio, gate consulta registros, comando plan JSON, gate dominio de turno, etc.). El **clasificador** de intención (`clasificador.js`) sigue usando Groq/Gemini; integrar Ollama ahí sería un paso siguiente si querés clasificación casi 100% local.
- **Prueba:** `OLLAMA_ENABLED=1 npm run test:ollama` (chat directo, orden resguardo, `ejecutarJsonConCadenaIA` solo por Ollama).

## Tools (registro tipo MCP) y plan visible para admin

- **Registro:** `src/services/agent/tools/registry.js` (`registerTool`, `invokeTool`, `listTools`). Built-ins: `tools/builtins.js` + `tools/builtins_workspace.js` + `tools/builtins_consulta_ctx.js` (carga al importar `tools/index.js`). Incluye **`agent.turn_step`**, **`agent.workspace_doc`**, **`agent.consulta_datos_compactos`** (payload interno de la plantilla consulta), **`agent.historial_snippet`** (últimas filas de `historial_consultas` por WhatsApp).
- **Tool-calling (scout):** con `AGENT_TOOL_LOOP_SCOUT=1` y OpenRouter, el modelo puede ejecutar tools vía API chat completions; el texto «Hallazgos scout:…» se guarda en `clasificacion.agentScoutContext` y `rutaAgroGeneral` lo antepone al prompt de plantilla (no sustituye al router completo).
- **Persistencia:** al guardar la consulta, los pasos se serializan como primer elemento de `ia_provider_trace`: `{ "type": "agent_plan", "steps": [...] }` (el productor sigue sin verlo en el chat; está en BD).
- **Verify/retry:** `src/services/agent/plan/verify_retry.js` y composición **`runObserveActVerifyChain`** en `plan/oav_chain.js` (hoy un solo paso `router`; permite sumar más pasos observe/act/verify sin reescribir el pipeline).
- **Cola (consulta async):** tabla `agent_tarea_fila` + `AGENT_CONSULTA_ASYNC=1`: el handler de WhatsApp encola y responde al instante; un **interval en el mismo proceso Node** drena y envía con el cliente WA ya conectado (segundo proceso OS opcional solo para scripts tipo `npm run agent:cola-once`, que procesa una fila sin enviar WA). Tareas `processing` viejas se reabren a `pending` (timeout `AGENT_COLA_STUCK_MINUTES`). **Admin:** `GET /api/dashboard/admin/agent-cola`.
- **Panel admin:** `GET /api/dashboard/admin/agent-plan?limit=40` (misma auth que el resto de `/api/dashboard/admin/*`) devuelve hasta N filas que ya incluyen bloque `agent_plan` con pasos (filtrado en SQL sobre `ia_provider_trace` JSONB). `GET /api/dashboard/admin/agent-tools` lista las herramientas registradas (nombre, descripción, esquema) para depuración. `GET /api/dashboard/admin/agent-cola` resume la cola async (`agent_tarea_fila`).

## Qué **no** asumir

- **`consultas.js` no concentra** la lógica de clasificación, router ni plantilla `consulta`; es entrada fina + control de bot.
- **`consultas/procesar_consulta.js`** es un shim que reexporta `../consultas.js` (útil para scripts por ruta histórica); **no** es el orquestador del pipeline.
- **No existen** en el árbol activo: `src/services/agent_gate.js`, `agent_orchestrator.js`, `agent_prompt_builders.js`, `src/services/consultas/index.js`, `src/services/consultas/legacy.js`. La IA JSON compartida está en `src/services/agent/ia/json_chain.js`; prompts en `agent/prompts/builders.js`; pasos/conciliación en `agent/orchestration/pasos.js`.
- Los módulos de **`docs/contexto-ia/`** son guías de **contenido** por tema agro; **no** describen el cableado Node (clasificador, router, archivos).

## Documentación relacionada

- Flujo detallado clasificador + router: [clasificador-y-router-consultas.md](./clasificador-y-router-consultas.md)
- Plantilla `consulta`: [templates.md](./templates.md)
- Limpieza de shims y reexports: `src/services/obsoletos/MANIFEST.txt`
- Auditoría general del repo: [auditoria-repo-desde-raiz-2026-05-11.txt](./auditoria-repo-desde-raiz-2026-05-11.txt)

## Carpeta `src/services/agent/`

| Ruta | Rol |
|------|-----|
| `pipeline/consulta_whatsapp.js` | Turno completo post-`consultas.js` |
| `gates/dominio_turno.js` | Agro operativo vs fuera de foco |
| `ia/json_chain.js` | Cadena de proveedores para JSON (OpenRouter, Gemini, Groq, **Ollama** opcional) |
| `ia/tool_loop_scout.js` | Tool-calling OpenRouter (scout opcional antes del router) |
| `prompts/builders.js` | System prompts versionados |
| `orchestration/pasos.js` | Conciliación / trazas de pasos IA |
| `tools/` | Registro de herramientas + built-ins (`turn_step`, `workspace_doc`, `historial_snippet`) |
| `plan/verify_retry.js` | Reintento genérico observe→act→verify por paso |
| `plan/oav_chain.js` | Cadena de pasos (hoy: router con verify/retry; extensible) |
| `queue/tarea_fila.js` | Cola PG `agent_tarea_fila` (consulta async opcional) |
| `queue/drenar_consulta_whatsapp.js` | Drenado + reclaim de processing colgado |
| `src/services/ollama.js` | Cliente HTTP Ollama (`/api/chat`); lo consume `agent/ia/json_chain.js` |
