# Sistema de plantillas centralizado

Este documento describe las plantillas de mensajes usadas por AgroHabilis y su punto de integración.

## `bienvenida`
- **Uso:** primer mensaje post-onboarding.
- **Datos:** precios, dólar y clima (prioriza fresco/en vivo).
- **IA:** dato contextual dentro del contenido de bienvenida.
- **Integración:** `src/services/onboarding.js` vía `renderTemplate("bienvenida", usuario)`.

## `resumen_diario`
- **Uso:** envío automático diario (cron).
- **Datos:** reutiliza `generarResumen()` + noticias frescas.
- **IA:** ya incluida dentro de `generarResumen`.
- **Integración:** `src/jobs/enviador.js` vía `renderTemplate("resumen_diario", usuario)`.

## `mi_resumen`
- **Uso:** comando `MI RESUMEN`.
- **Datos:** base de `generarResumen()` + dólar fresco (marca de actualización).
- **IA:** ya incluida dentro de `generarResumen`.
- **Integración:** `src/config/whatsapp.js`.

## `alerta`
- **Uso:** cuando se dispara una alerta de precio.
- **Datos:** precio actual, historial 30d, dólar fresco.
- **IA:** recomendación corta de decisión.
- **Integración:** `src/services/alertas.js`.

## `analisis_venta`
- **Uso:** `ANALIZAR SOJA/MAIZ/TRIGO...`
- **Datos:** análisis completo existente + noticias frescas.
- **IA:** incluida en `analizarConvenienciaVentaRaw`.
- **Integración:** `src/services/analisis_venta.js` (wrapper por plantilla).

## `consulta`
- **Uso:** consultas libres conversacionales.
- **Datos:** detección de temas + precio/dólar/clima/noticias frescas.
- **IA:** respuesta conversacional en base al contexto.
- **Integración:** `src/services/consultas.js`.

## Motor central

Archivo: `src/templates/index.js`

- Registro único de plantillas.
- API común:
  - `renderTemplate(nombre, usuario, ...args)`
- Resultado:
  - `{ mensaje, datos, meta, template }`
- Logging:
  - imprime las claves de datos usados por cada plantilla.
