# QA WhatsApp Report

- Fecha: 2026-04-30T17:26:08.336Z
- Total: 9
- PASS: 9
- FAIL: 0

## Detalle

### ✅ alias-mi-perfil - Alias MI PERFIL resuelve VER MI PERFIL
- kind: `alias`
- input: `Mí perfil`
- expected: `VER MI PERFIL`
- got: `VER MI PERFIL`

### ✅ alias-mis-productos - Alias MIS PRODUCTOS resuelve VER MI PERFIL
- kind: `alias`
- input: `Cuáles son mis productos`
- expected: `VER MI PERFIL`
- got: `VER MI PERFIL`

### ✅ intent-insumos - Intención natural ver insumos
- kind: `intent`
- input: `ver insumos`
- expected: `__INSUMOS__`
- got: `__INSUMOS__`

### ✅ sanitize-boxed - Limpia tags boxed y request_fx
- kind: `sanitize`
- input: `\boxed{Processed}\nsin datos en base\nrequest_fx('/v1/param?key=x')`
- expected: `sin: \boxed{, request_fx(`
- got: `sin datos en base`

### ✅ suggestion-no-hacienda-operativa - No sugerir comando cuando consulta ternero operativa
- kind: `suggestion`
- input: `Tengo terneros para vender ahora, ¿conviene vender ya o esperar un poco?`
- expected: `sin sugerencia`
- got: ``

### ✅ suggestion-si-comando-alerta - Sugerir alerta para texto ambiguo de alerta
- kind: `suggestion`
- input: `quiero una alerta de precio de soja`
- expected: `ALERTA`
- got: `Detecté una intención de comando.\n👉 Probá con: *ALERTA ... / AVISAME ...*\nSi querés ver todos los comandos, escribí: *VER COMANDOS*`

### ✅ suggestion-no-mi-ganado-con-pregunta - No sugerir comando si MI GANADO viene en consulta natural larga
- kind: `suggestion`
- input: `Ay no, MI GANADO vacuno cria, terneros. Ahora si, me podes decir cuanto esta el ternero y si conviene vender o esperar?`
- expected: `sin sugerencia`
- got: ``

### ✅ suggestion-no-hacienda-con-precio - No sugerir comando en pregunta natural de precio hacienda
- kind: `suggestion`
- input: `Tenes precio de ternero de invernada y si esta firme o flojo?`
- expected: `sin sugerencia`
- got: ``

### ✅ suggestion-no-limones-operativa - No sugerir comando en consulta abierta de producto no mapeado
- kind: `suggestion`
- input: `Y los limones?`
- expected: `sin sugerencia`
- got: ``
