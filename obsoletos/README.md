# Obsoletos

Archivos fuera del flujo estándar de la app: código o scripts conservados solo como referencia. **No** están referenciados por `npm run` ni por imports activos del backend.

## Contenido

| Ruta | Qué era |
|------|---------|
| `consultas/capa_usuario_llm.js` | Capa Gemini “inventario vs perfil vs mercado” antes del router nuevo; ya no está cableada tras `clasificador` + `rutear`. Variable histórica: `CONSULTA_CAPA_USUARIO_LLM`. |
| `servicios-calculadora-guiar-costo.js` | Flujo conversacional `guiarCalculoCosto` (“calcular costo” + `onboarding_estado`). El módulo vivo `calculadora_costos.js` solo expone `calcularCostoPorHa` para análisis/resúmenes. |
| `scripts-deprecated/` | Scripts antiguos (p. ej. prueba manual `test-respuestas.js`; antes vivían en `scripts/deprecated/`). |

Para reactivar algo de acá hay que moverlo/volver a cablearlo desde el código vivo y revisar tests.
