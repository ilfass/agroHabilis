# Clasificador y router de consultas WhatsApp

Documenta el flujo principal que reemplaza la cascada histórica dentro de `procesarConsulta`: **clasificador central** (JSON) + **router** que delega en **rutas** por intención.

## Punto de entrada API pública

| Export | Archivo |
|--------|---------|
| `procesarConsulta` | `src/services/consultas/index.js` → `legacy.js` → `procesar_consulta.js` |
| `manejarComandoBot`, `obtenerEstadoBot` | `src/services/consultas/bot_control.js` (sin cambio conceptual) |

`src/services/consultas.js` solo reexporta `consultas/index.js`.

## Flujo de `procesarConsulta`

Archivo: `src/services/consultas/procesar_consulta.js`.

1. **Texto vacío** → respuesta fija: no se recibió consulta.
2. **Comandos de control del bot** (`PAUSAR BOT`, `ACTIVAR BOT`, `ESTADO BOT`) mediante `parseComandoBot` → `manejarComandoBot`. No pasan por clasificación ni guardado en el mismo shape que el resto (según implementación de `manejarComandoBot`).
3. **Perfil** → `obtenerYCompletarPerfil(numeroWhatsapp)`:
   - `obtenerPerfil` + `completarGeolocalizacionSiFalta` (helpers en `legacy_helpers.js`).
   - Flag **`tiene_datos`**: existe al menos un movimiento en `gastos`, `ventas` o `inventario_movimiento` para ese `usuario_id`.
4. **Clasificación** → `clasificarMensaje(textoPregunta, usuario)` (`src/services/clasificador.js`).
5. **Logging** → `logConsultaRoute(numeroWhatsapp, intención, { cultivo, confianza, msClasificador })`.
6. **Enrutado** → `routear({ clasificacion, mensaje, usuario, numeroWhatsapp })` (`src/services/router.js`).
7. **Persistencia** → `guardarConsulta(...)` con `tokensUsados: null` en esta orquestación.

### Export auxiliar para pruebas

En el mismo módulo: `obtenerYCompletarPerfil` (adjunto a `module.exports`) para scripts que necesiten el mismo perfil que usa el pipeline.

## Clasificador (`src/services/clasificador.js`)

Objetivo: producir un **único JSON** con intención y metadatos para el router.

### Salida normalizada

- `intencion` (string, una de las categorías válidas).
- `cultivo`, `producto`, `zona_mencionada` (string o `null`).
- `requiere_datos_propios` (boolean).
- `confianza`: `"alta"` | `"media"` | `"baja"`.

### Cadena de IA (`llamarIAClasificador`)

Orden de preferencia:

1. **Groq**, modelo por defecto `llama-3.1-8b-instant` (`GROQ_MODEL`), con techo de tokens de salida configurable (`CLASIFICADOR_MAX_TOKENS`, por defecto orientado a respuestas cortas).
2. Si Groq no está o falla: **Gemini Flash** vía `generarTextoClasificadorRapido` en `src/services/gemini.js` (`CLASIFICADOR_MAX_OUT`, etc.).
3. Si todo falla o faltan keys: **clasificación heurística** (`clasificarHeuristica`) sin IA.

### Intenciones válidas

`precio`, `analisis_mercado`, `analisis_interno`, `clima`, `registrar`, `consulta_registros`, `agro_general`, `no_agro`, `saludo`, `comando`.

Cualquier valor desconocido se normaliza en el parseo final a `agro_general` donde corresponda.

### Heurística (resumen)

Reglas por palabras clave y patrones: comandos explícitos (p. ej. `MI RESUMEN`), alertas con umbral numérico (`avisame…`), saludos cortos, consultas sobre registros propios, indicios de gasto/venta, clima, precio, más reglas específicas (p. ej. “con mis costos”, “conviene vender”) documentadas en código.

## Router (`src/services/router.js`)

Recibe el objeto `clasificacion` y despacha con un `switch (intencion)`:

| Intención | Ruta | Condición especial |
|-----------|------|--------------------|
| `precio` | `rutas/precio.js` | — |
| `analisis_mercado` | `rutas/analisis_mercado.js` | — |
| `analisis_interno` | `rutas/analisis_interno.js` | Sin `usuario.id` → mensaje de registro |
| `clima` | `rutas/clima.js` | — |
| `registrar` | `rutas/registrar.js` | — |
| `consulta_registros` | `rutas/consulta_registros.js` | Sin `usuario.id` → mensaje de registro |
| `agro_general` | `rutas/agro_general.js` | — |
| `no_agro` | `rutas/no_agro.js` | — |
| `saludo` | `rutas/saludo.js` | — |
| `comando` | `rutas/comando.js` | — |
| `default` | `rutas/agro_general.js` | — |

## Rutas (`src/services/rutas/`)

Cada archivo exporta una función `rutaX({ clasificacion, mensaje, usuario, numeroWhatsapp })` (algunas omiten parámetros no usados).

- **precio**: frescura en BD (~4 h), opcional disparo del recolector CAC, datos de cultivo + humanización + grounding según política existente (helpers desde `legacy_helpers.js`).
- **analisis_mercado**: noticias 24 h (`obtenerNoticiasFrescas` en `templates/base`) + plantilla `consulta`.
- **analisis_interno**: plantilla `analisis_venta` si hay cultivo en perfil con hectáreas; si no, `consulta` enriquecida con texto de perfil y finanzas.
- **clima**: intento de actualizar desde API si BD no tiene corte fresco (~3 h), respuesta puntual + capa opcional de redacción con IA.
- **registrar**: prioriza ventas/gastos con monto vs `registrarVenta` / `registrarGasto`; caso contrario inventario WhatsApp (`manejarInventarioWhatsapp`); stubs de dominio agrícola/ganadero/lote acoplados al flujo de inventario.
- **consulta_registros**: lectura de saldos inventario + resumen financiero + redacción con IA.
- **agro_general**: fragmentos de `docs/contexto-ia/*.md` por similitud liviana + plantilla `consulta`.
- **no_agro**: `responderNoAgroConGrounding` (módulo de grounding).
- **saludo**: plantilla rápida y/o saludo con IA controlada.
- **comando**: planes (`QUIERO PLAN *`), comandos mayúsculas (`MI RESUMEN`, etc.), `inferirComandoNatural` + `ejecutarComandoYHumanizar`, Ver comandos estático.

### Dependencias compartidas

Las rutas importan **`src/services/consultas/legacy_helpers.js`**, que concentra el cableado previo (plantillas, gemini, DB snapshot, humanización, comandos, etc.) sin volver a inflar `legacy.js`.

## `legacy.js` actual

`src/services/consultas/legacy.js` solo reexporta `procesarConsulta` y los comandos del bot. La lógica masiva vive en `legacy_helpers.js` + rutas + clasificador.

## Variables de entorno relevantes

| Variable | Uso |
|----------|-----|
| `GROQ_API_KEY`, `GROQ_MODEL` | Clasificador vía Groq |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Fallback clasificador y rutas con IA |
| `CLASIFICADOR_MAX_TOKENS` | Máx. tokens salida Groq (clasificador) |
| `CLASIFICADOR_MAX_OUT` | Máx. tokens salida Gemini (`generarTextoClasificadorRapido`) |
| `IA_TIMEOUT_MS` | Timeouts compartidos en llamadas HTTP/IA |

Documentar nuevas variables en `.env.example` cuando se agreguen en código.

## Script de prueba

`scripts/test-clasificador.js`

- `CLASIFICADOR_SOLO_HEURISTICA=1`: evita llamadas a IA en clasificación (solo heurística + normalización).
- `MAX_MENSAJES=N`: solo los primeros N mensajes de la batería (útil para no cortar con `head` en shell; `head` puede provocar exit ≠ 0 por SIGPIPE).
- `CARGAR_PERFIL_BD=1`: intenta `obtenerYCompletarPerfil` con `TEST_WHATSAPP` / `TEST_WA`.

Comando npm: `npm run test:clasificador`.

## Archivos fuera del flujo activo

Consultá la carpeta **`obsoletos/`** en la raíz del repo (`obsoletos/README.md`): allí están el antiguo módulo de capa usuario LLM (`consultas/capa_usuario_llm.js`), el flujo **`guiarCalculoCosto`** archivado (`servicios-calculadora-guiar-costo.js`) y scripts deprecados (`scripts-deprecated/`).

## Notas operativas

- Errores de esquema SQL (p. ej. columna `fuente` inexistente) suelen venir de la **BD local** vs expectativas de plantillas o consultas; no son del `switch` del router en sí.
- Evitar `node script.js | head -N` para validar código de salida: usar `MAX_MENSAJES`.

---

*Última actualización alineada con la estructura de ramas por intención y `procesar_consulta.js` como orquestador.*
