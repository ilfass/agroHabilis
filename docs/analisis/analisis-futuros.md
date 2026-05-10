# Analisis futuros (backlog operativo)

Este documento concentra analisis e inteligencia a incorporar en AgroHabilis.

## Criterio de uso

- **Estado**:
  - `idea`: todavia no iniciada
  - `validando`: fuente o logica en prueba
  - `en_desarrollo`: implementacion en curso
  - `en_produccion`: disponible para usuarios
- **Prioridad**:
  - `alta`: impacto comercial directo
  - `media`: aporta contexto importante
  - `baja`: complementario

## Backlog inicial

| ID | Analisis | Objetivo de negocio | Fuentes sugeridas | Salida esperada | Plan sugerido | Prioridad | Estado |
|---|---|---|---|---|---|---|---|
| AF-001 | Mercado de Chicago CBOT con comentarios | Dar contexto internacional diario para decisiones de venta local | CBOT (via AFA/otras fuentes validadas) + comentario IA guiado por datos | Bloque WhatsApp: precio + variacion + comentario de contexto | Pro | alta | idea |
| AF-002 | Grafico de posicion | Visualizar curva de posiciones (near/far) para detectar carry/backwardation | MATba/Rofex + CBOT | Mini grafico en dashboard + resumen textual en WhatsApp | Basico/Pro | alta | idea |
| AF-003 | Harina de soja | Incorporar señal del subproducto clave para industria y crushing | Referencias internacionales de meal + fuentes locales | Bloque de precio/variacion y semaforo de impacto en complejo soja | Pro | media | idea |
| AF-004 | Mercado Dalian | Agregar referencia asiática para anticipar sesgo de demanda | Dalian (fuente a validar) | Nota diaria: direccion Dalian y posible impacto local | Pro | media | validando |
| AF-005 | Indice SAFRAS soja Brasil | Medir presión de oferta regional (Brasil) | SAFRAS (indice/estimaciones publicas) | Insight semanal con tendencia y riesgo para precios | Pro | alta | validando |
| AF-006 | FOB soja Paraguay | Mejorar comparativo regional de competitividad FOB | Fuentes oficiales/privadas validadas para Paraguay | Tabla comparativa FOB AR/PY + comentario | Pro | media | idea |
| AF-007 | Precios mundiales del complejo soja | Unificar poroto/harina/aceite para lectura integral | CBOT + referencias FOB + fuentes regionales | Bloque "Complejo soja global" con semaforo | Pro | alta | idea |
| AF-008 | Primas/Premios del complejo soja | Detectar oportunidades por cambios en primas | Fuentes de primas/premios a validar | Alertas cuando prima se expande/contrae sobre umbral | Pro | alta | idea |
| AF-009 | Premios Argentina mercado | Monitorear premio/descuento local respecto de referencia externa | Mercado local + referencia internacional + tipo cambio | Indicador diario de premio AR y recomendacion de timing | Basico/Pro | alta | idea |
| AF-010 | Mercado Matba/Rofex | Profundizar analisis local de futuros y cobertura | API MATba/Rofex + tabla `futuros_posiciones` | Bloque: curva, volumen, variacion, sugerencia de cobertura | Basico/Pro | alta | en_desarrollo |
| AF-011 | Precios FOB Argentina MAGYP | Reforzar ancla oficial de exportacion | MAGYP FOB (`granos_magyp_fob`) | Bloque oficial FOB AR con variacion y uso recomendado | Basico/Pro | alta | en_desarrollo |
| AF-012 | Agenda para el dia miercoles | Generar checklist operativo semanal accionable | Calendario interno + clima + mercado | Mensaje "Agenda del miercoles" con 3-5 tareas priorizadas | Basico/Pro | media | idea |
| AF-013 | Exportacion vs Industria | Medir puja de demanda local por destino | DJVE/exportaciones + indicadores industria (fuente a cerrar) | Indicador de traccion: exportador vs industria | Pro | alta | validando |
| AF-014 | Mapas climaticos | Visual de riesgo por zona para decisiones de campo | Open-Meteo + SMN + capas de mapa | Vista dashboard por region + resumen por usuario | Pro | alta | idea |
| AF-015 | Humedad en suelo de Norteamerica | Anticipar riesgo de oferta global por condicion de suelo | NOAA/USDA/NASA (fuentes a validar) | Insight semanal y alerta de cambio brusco | Pro | media | validando |

## Proxima iteracion recomendada (orden)

1. AF-010 Mercado Matba/Rofex (terminar profundidad y cobertura).
2. AF-011 FOB Argentina MAGYP (estandarizar bloque oficial).
3. AF-001 CBOT con comentarios (daily para Pro).
4. AF-009 Premios Argentina mercado (señal comercial).
5. AF-012 Agenda del miercoles (retencion y accion semanal).

## Definition of Done por analisis

Un analisis pasa a `en_produccion` cuando cumple:

- Fuente validada y monitoreada en `fuentes_monitor`.
- Regla de calculo documentada y testeada.
- Bloque visible en WhatsApp y/o dashboard segun plan.
- Fallback definido cuando falta dato.
- Metrica de uso registrada (lectura, respuesta, accion o conversion a Pro).
