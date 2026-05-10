# Analisis integral simulacion v4 (realista)

- Fecha analisis: 2026-05-04T19:36:10.498Z
- Fuente principal: `simulacion-7-productores-onboarding-v4-realista-2026-05-04.json`
- Comparativos: `simulacion-7-productores-onboarding-v2-2026-05-04.json`, `simulacion-7-productores-onboarding-v3-post-fixes-2026-05-04.json`

## KPIs globales

| KPI | v2 | v3 | v4 | Lectura |
|---|---:|---:|---:|---|
| Turnos totales | 66 | 66 | 65 | v4 usa guiones mas ricos por perfil |
| Latencia promedio (ms) | 19500 | 7277 | 8625 | sube por fallback+timeout en consultas largas |
| P95 latencia (ms) | 81588 | 22386 | 22963 | cola alta por IA externa |
| "sin datos en base" | 14 | 3 | 3 | mejora vs v2, residual |
| Respuestas con "s/d" | 10 | 10 | 10 | persisten faltantes estructurales |
| Menciones "BOLSA" | 7 | 3 | 1 | normalizado casi completo a MEP |
| Menciones "MEP" | 10 | 20 | 30 | mejora de legibilidad cambiaria |
| Cambios de plan confirmados | 0 | 2 | 1 | routing duro funcionando |
| Fallback "No pude consultar la IA" | 0 | 9 | 16 | aparece por timeout controlado |
| Onboarding con bienvenida | 7 | 7 | 7 | estable en los 7 perfiles |
| Errores [ERROR] | 0 | 0 | 0 | sin errores de ejecucion en transcript |
| Respuestas largas (>1200 chars) | 20 | 9 | 8 | todavia alto para perfiles simples |

## Hallazgos de comportamiento (v4)

- Onboarding completo y consistente para los 7 productores, incluyendo mixtos y nicho.
- Cambios de plan explicitos se resuelven correctamente (BASICO/PRO) con confirmacion directa.
- En consultas tecnicas (carry/spread) sigue faltando data de futuros para cerrar recomendacion cuantitativa.
- Para consultas simples, hay mejora de concision, pero aun aparecen bloques largos en algunos casos.
- El timeout de plantilla evita cuelgues: responde fallback corto en ~20-23s en vez de bloquear mas tiempo.

## Analisis por productor (v4)

| Productor | Turnos | Avg ms | Max ms | Placeholders | Fallback IA | Plan OK | Onboarding OK | Resp largas |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 - Roberto Gimenez | 8 | 4863 | 22303 | 2 | 1 | no | si | 2 |
| 2 - Marcela Sotelo | 12 | 6169 | 22389 | 1 | 2 | no | si | 1 |
| 3 - Nestor Palavecino | 8 | 12139 | 22963 | 1 | 4 | no | si | 1 |
| 4 - Hector Colombo | 9 | 1330 | 11822 | 3 | 0 | si | si | 1 |
| 5 - Ramona Flores | 8 | 16709 | 44024 | 1 | 4 | no | si | 1 |
| 6 - Gustavo Nahuel Paillan | 8 | 12147 | 41813 | 1 | 2 | no | si | 1 |
| 7 - Silvia Mamani | 12 | 8978 | 40323 | 1 | 3 | no | si | 1 |

## Score automatico por productor (0-100)

- Script: [`scripts/score-simulacion.js`](../../scripts/score-simulacion.js).
- Ejecución: `npm run score:sim` (abarca todos los `simulacion-7-productores*.json` en `docs/operacion/`).
- Salida consolidada: [`scores-simulacion-comparativo-2026-05-04.json`](scores-simulacion-comparativo-2026-05-04.json) (`runs`, comparativo **v2↔v3** y **v3↔v4**).

La métrica es **heurística** (limpia placeholders, etiqueta TC, penaliza fallback IA / deriva a solo dolar ante carry-brecha, latencia media, etc.) y sirve para **seguir corridas** sin leer turno a turno. Un **v4** más exigente (typos, objeciones) puede bajar el promedio respecto de **v3** aun mejorando KPIs funcionales — en este bundle: delta promedio v3→v4 de **−8 puntos** con mayor cantidad de fallbacks controlados por timeout.

| Corrida (JSON) | Score promedio (7 productores) |
|---|---:|
| `simulacion-7-productores-onboarding-2026-05-04.json` | 60 |
| `simulacion-7-productores-onboarding-v2-2026-05-04.json` | 60 |
| `simulacion-7-productores-onboarding-v3-post-fixes-2026-05-04.json` | 76 |
| `simulacion-7-productores-onboarding-v4-realista-2026-05-04.json` | 68 |

| Productor | Score v4 |
|---|---:|
| 1 - Roberto Gimenez | 56 |
| 2 - Marcela Sotelo | 81 |
| 3 - Nestor Palavecino | 66 |
| 4 - Hector Colombo | 91 |
| 5 - Ramona Flores | 50 |
| 6 - Gustavo Nahuel Paillan | 66 |
| 7 - Silvia Mamani | 63 |

## Prioridades recomendadas (orden)

1. Reducir dependencia de fallback IA: cache de consulta por intent + cultivo + zona (TTL corto).
2. Respuesta SIMPLE estricta: maximo 4 lineas y sin secciones Lectura/Riesgo salvo pedido explicito.
3. Mensaje unico para faltantes de futuros: "hoy no tengo futuro MATBA para X" en vez de multiples `s/d`.
4. Metrica operativa en produccion: tasa de timeout consulta_template por intent y por productor.
5. Ajustar prompts de horticultura/ganaderia para evitar deriva a granos cuando el usuario no lo pidio.

## Conclusion

- La version v4 mejora funcionalmente (routing de plan y normalizacion cambiaria) y mantiene onboarding solido.
- La mayor deuda sigue en latencia/timeout de IA y brevedad para perfil simple.