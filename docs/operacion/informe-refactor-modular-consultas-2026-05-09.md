# Informe: refactor modular de `src/services/consultas`

**Fecha:** 2026-05-09  
**Alcance:** extracción de lógica desde `legacy.js` hacia módulos dedicados, sin cambiar el comportamiento observable (misma API pública vía `consultas/index.js`).

## Objetivo

- Reducir el tamaño y la complejidad de `legacy.js` (orquestador histórico).
- Aislar dominios (precios, cobertura, comandos, eventos, snapshot de datos, grounding) en archivos con **inyección de dependencias** (`deps` / factory).
- Facilitar pruebas y evolución futura (p. ej. troceo de `procesarConsulta`).

## Última modificación importante (cierre de esta tanda)

- **`ejecutar_comando_whatsapp.js`**: contiene `ejecutarComandoYHumanizar` (MI_RESUMEN, MIS_ALERTAS, MI_MARGEN, REGISTRAR_GASTO/VENTA, CREAR_ALERTA, ANALIZAR_CULTIVO, PLANES) con dependencias inyectadas.
- **`legacy.js`**: delegación mediante wrapper que pasa `renderTemplate`, `listarAlertas`, servicios de gastos/planes/alertas, `humanizarComandoConIA`, `parseCultivo`, `detectarCultivoEnTexto`, etc.

## Módulos introducidos o ampliados en esta línea de trabajo

| Archivo | Responsabilidad |
|---------|------------------|
| `precios_mercado.js` | `responderPrecioPorMercado`, `responderDivisionPorPuerto` |
| `mercado_spot_futuros.js` | Spot Rosario comparable, futuros por cultivo, parseo mes/año de posiciones |
| `datos_cultivo.js` | `responderDatosCultivo` (papa hortícola + granos, política disponible) |
| `ia_grounding.js` | Ampliado con `enriquecerConGroundingAgroSiHaceFalta` (complemento web condicionado) |
| `cobertura_maiz.js` | Texto técnico de cobertura maíz (spot, MATBA, TC, fuentes) |
| `consulta_route_events.js` | Factory `createConsultaRouteEvents`: tabla `consulta_route_events`, registro y log de rutas |
| `consulta_datos_snapshot.js` | Factory `createConsultaDatosSnapshot`: precios agregados, tipo de cambio, alertas, futuros, geocoding Nominatim, clima BD/API |
| `ejecutar_comando_whatsapp.js` | Comandos de plantilla + humanización IA donde corresponde |

La orquestación y el flujo principal (`procesarConsulta`, plantillas, onboarding, etc.) siguen en **`legacy.js`**, pero con menos superficie duplicada.

## Métricas

- **`legacy.js`**: orden de magnitud **~2.230 líneas** al cierre de esta tanda (frente a **~3.700+** al inicio del refactor descrito en el hilo de trabajo).
- **Reducción aproximada:** más de **1.400 líneas** movidas a módulos especializados (el número exacto depende del commit base de comparación).

## Mejoras logradas

1. **Separación por dominio:** precios por mercado, cobertura maíz, datos por cultivo, snapshot de mercado/clima/geo y comandos WhatsApp quedan en archivos acotados.
2. **Inyección explícita:** las funciones extraídas reciben `query`, formateo, normalización, Gemini, etc. vía `deps`, lo que reduce dependencias implícitas globales dentro del cuerpo.
3. **Estado encapsulado:** caché de columnas `tipo_cambio` y flag de schema de eventos de ruta viven en factories (`createConsultaDatosSnapshot`, `createConsultaRouteEvents`), no como `let` sueltos dispersos en `legacy.js`.
4. **Orden de carga más seguro:** casos como `responderDatosCultivo` + `fallbackConsultaTimeoutConCultivo` se reordenaron para evitar referencias antes de inicialización.
5. **Misma superficie pública:** `src/services/consultas/index.js` sigue exportando `procesarConsulta`, `manejarComandoBot`, `obtenerEstadoBot` desde `legacy.js`.

## Pruebas ejecutadas

- `node -e "require('./src/services/consultas/legacy.js')"` (carga del módulo).
- `npm run test:precios:minimos` — en las corridas de esta tanda: **`failures: 0`**.

## Riesgos y mitigaciones

- **Regresión silenciosa:** mitigada con el script de precios mínimos y carga de `legacy.js` tras cada extracción.
- **Orden TDZ en `const`:** los wrappers que referencian otras `const` del mismo archivo deben declararse **después** de sus dependencias (se aplicó en `responderDatosCultivo` / fallback).

## Próximos pasos recomendados

1. **Trocear `procesarConsulta`** en fases (early exits, plantilla `consulta`, ramas mercado/clima/alertas) hacia `procesar_consulta.js` o submódulos por flujo.
2. **Tests dirigidos** a `ejecutar_comando_whatsapp` y `consulta_datos_snapshot` con mocks de `query` (unitarios ligeros).
3. **Documentar** en `README` o manual del proyecto solo un enlace a este informe si se desea visibilidad para el equipo (opcional).

---

*Documento generado como cierre de la tanda de refactor modular de consultas.*
