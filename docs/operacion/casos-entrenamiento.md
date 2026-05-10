# Casos de entrenamiento (resumen)

## Caso 1 - Precio puntual soja
- Pregunta: "precios de la soja hoy?"
- Respuesta esperada:
  - Precio referencia + fecha + fuente.
  - Si hay stale, aclarar "último dato disponible".
  - Evitar bloques largos si no piden análisis.

## Caso 2 - Consulta hortícola papa
- Pregunta: "precio papa mcba hoy?"
- Respuesta esperada:
  - Priorizar tabla hortícola/papa (MCBA) sobre mezclas de granos.
  - Mostrar rango/promedio consistente y una línea operativa.
  - No devolver "sin datos" si existe último dato trazable.

## Caso 3 - Seguimiento de calendario
- Turno 1: "qué día es hoy?"
- Turno 2: "y mañana?"
- Respuesta esperada:
  - Mantener contexto calendario.
  - Responder día/fecha, no mercado.

## Caso 4 - Consulta no agro
- Pregunta: "la guerra de irán terminó?"
- Respuesta esperada:
  - Ruta no agro con respuesta breve y verificable.
  - Sin plantilla Mercado/Lectura/Decisión/Riesgo.
  - Si se usa web, enlaces legibles (no URLs kilométricas).

## Caso 5 - Timeout IA en consulta relevante
- Condición: timeout de plantilla.
- Respuesta esperada:
  - Fallback por cultivo cuando se detecta producto (ej: papa, soja).
  - Evitar fallback genérico vacío si hay datos en base.
  - Mensaje breve aclarando que se respondió con base interna.
