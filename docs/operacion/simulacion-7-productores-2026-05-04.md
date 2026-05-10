# Simulacion controlada - 7 productores (2026-05-04)

## Alcance

- Ejecucion real contra backend local (onboarding + flujo completar perfil).
- 7 productores, 7 turnos por productor.
- Numeros de WhatsApp de prueba separados por productor.
- Se evito IA libre para mantener entorno controlado y reproducible.

## Hallazgo critico transversal

- En los 7 casos fallo el envio del primer resumen al finalizar onboarding:
  - `column "compra" does not exist`
  - Respuesta al usuario: `No pude enviarte el primer resumen en este momento. Escribi MI RESUMEN...`

## Productor 1 - Roberto Gimenez

1. U: Hola
   B: Bienvenida + planes + pedido de nombre.
2. U: Roberto Gimenez
   B: Pide provincia/partido (admite zonas separadas por guion).
3. U: Buenos Aires, Pergamino - Cordoba, Marcos Juarez - Entre Rios, Gualeguaychu
   B: Limita a 1 zona por plan Gratis y avisa que ignora 2 zonas.
4. U: soja, maiz, trigo y girasol
   B: Falla primer resumen (`column "compra" does not exist`).
5. U: COMPLETAR PERFIL
   B: Menu de 5 opciones.
6. U: 4
   B: Pide elegir comercializacion (1 disponible, 2 futuros).
7. U: 2
   B: Confirma actualizacion de comercializacion.

## Productor 2 - Marcela Sotelo

1. Hola -> bienvenida.
2. Nombre -> pide zona.
3. Zona -> pide actividad principal.
4. `soja, trigo y ganaderia` -> pide categorias ganaderas.
5. `vacuno cria, vacuno terneros` -> falla primer resumen.
6. `COMPLETAR PERFIL` -> abre menu.
7. `3` -> pide cantidad de cabezas.

## Productor 3 - Nestor Palavecino

1. Hola -> bienvenida.
2. Nombre -> pide zona.
3. Balcarce -> pide actividad.
4. `papa` -> falla primer resumen.
5. `COMPLETAR PERFIL` -> menu.
6. `1` -> pide hectareas.
7. `60` -> pide costo por ha en USD.

## Productor 4 - Hector Colombo

1. Hola -> bienvenida.
2. Nombre -> pide zona.
3. Venado Tuerto -> pide actividad.
4. `soja, maiz y ganaderia` -> pide categorias ganaderas.
5. `vacuno novillos` -> falla primer resumen.
6. `COMPLETAR PERFIL` -> menu.
7. `3` -> pide cantidad de cabezas.

## Productor 5 - Ramona Flores

1. Hola -> bienvenida.
2. Nombre -> pide zona.
3. Tucuman/Famailla -> pide actividad.
4. `limon, cana de azucar` -> falla primer resumen.
5. `COMPLETAR PERFIL` -> menu.
6. `5` -> pide cultivos separados por coma.
7. `limon, cana de azucar` -> confirma actualizacion de cultivos.

## Productor 6 - Gustavo Nahuel Paillan

1. Hola -> bienvenida.
2. Nombre -> pide zona.
3. Rio Negro/General Roca -> pide actividad.
4. `manzana, pera` -> falla primer resumen.
5. `COMPLETAR PERFIL` -> menu.
6. `4` -> pide comercializacion.
7. `1` -> confirma comercializacion disponible.

## Productor 7 - Silvia Mamani

1. Hola -> bienvenida.
2. Nombre -> pide zona.
3. Jujuy/Humahuaca -> pide actividad.
4. `papa andina, quinoa y ganaderia` -> pide categorias ganaderas.
5. `llama, alpaca` -> falla primer resumen.
6. `COMPLETAR PERFIL` -> menu.
7. `3` -> pide cantidad de cabezas.

## Observaciones operativas

- El onboarding base responde rapido (3ms a 40ms en la mayoria de turnos).
- El paso que intenta armar primer resumen demora ~4-4.8s y termina en error de esquema SQL.
- La restriccion de zonas por plan Gratis funciona correctamente.
- El parser de cultivos acepta cultivos no tradicionales (limon, cana, manzana, pera, quinoa).

---

## Continuacion post-fix (mismo dia)

Se aplico compatibilidad de esquema para `tipo_cambio` cuando faltan columnas opcionales (`compra`, `fuente`) y se re-ejecuto Productor 1 en flujo real.

### Productor 1 - Roberto Gimenez (7 turnos reales)

1. `Hola` -> onboarding inicia correctamente.
2. `Roberto Gimenez` -> pide zona.
3. `Buenos Aires, Pergamino - Cordoba...` -> limita a 1 zona por plan Gratis.
4. `soja, maiz, trigo y girasol` -> ahora SI entrega primer resumen completo (ya no falla por SQL).
5. `Necesito panorama rapido: precios, dolar y clima...` -> responde modulo de dolar rapido.
6. `comparame disponible vs futuro en maiz y soja` -> responde comparativa (demoro ~70s por IA/fuentes).
7. `crea alerta cuando maiz supere 250000` -> bloqueo correcto por plan Gratis (requiere Basico/Pro).

### Nuevos hallazgos despues del fix

- Quedo resuelto el error bloqueante de onboarding (`column compra/fuente does not exist`).
- Persisten placeholders en respuestas IA: aparece `sin datos en base` en la comparativa de maiz.
- En pedido mixto (`precios + dolar + clima`), la ruta priorizo respuesta de dolar rapido sin incluir el resto.
- En salida de dolar rapido, el tipo `bolsa` aparece como etiqueta tecnica; podria mapearse a `MEP` para UX.

---

## Simulacion completa (onboarding + preguntas por perfil)

Transcript completo (7 productores, onboarding + preguntas por perfil, numeros de prueba limpios antes de cada corrida, cleanup FK-safe incluyendo `historial_consultas`):

- **Canonico (v2):** `docs/operacion/simulacion-7-productores-onboarding-v2-2026-05-04.json`
- **Post-fixes (v3):** `docs/operacion/simulacion-7-productores-onboarding-v3-post-fixes-2026-05-04.json`
- **Legacy (v1, parcial en algunos flujos):** `docs/operacion/simulacion-7-productores-onboarding-2026-05-04.json`

Notas rapidas observadas en la corrida:

- El onboarding + primer resumen queda estable.
- Comandos tipo `QUIERO PLAN BASICO` a veces devuelven respuesta “consulta libre” con texto confuso (mezcla mercado + “sin datos en base” + plantilla gratis), en vez de confirmacion directa del cambio de plan.
- Preguntas de “carry / spread” sin futuro en base devuelven plantillas con muchos `s/d` (esperable, pero UX puede mejorar con 1 linea de “falta futuro MATBA”).

### Resultado comparativo rapido v3 (post-fixes)

- `QUIERO PLAN BASICO/PRO` ahora confirma cambio correctamente (sin desvío a “consulta libre”).
- `BOLSA` en tipo de cambio queda normalizado a `MEP`.
- `sin datos en base` casi desaparece del transcript de salida.
- Siguen apareciendo varios `s/d` en respuestas de estructura cuando faltan futuros/datos completos.
- Al activarse timeout de plantilla (`consulta_template: timeout 20000ms`), responde fallback corto en lugar de dejar colgada la interacción.

---

## Implementacion de mejoras (mismo dia)

Se implementaron los 5 frentes en backend:

1. Routing duro de comandos de plan (`QUIERO PLAN GRATIS/BASICO/PRO`) en `consultas.js` y prioridad temprana en `config/whatsapp.js`.
2. Sanitizacion de placeholders (`sin datos en base`, `s/d`) en salida final de consultas.
3. Compactacion por perfil SIMPLE (tope de lineas y menor ruido de bloques secundarios) en `consultas.js`.
4. Normalizacion de etiqueta cambiaria `BOLSA` -> `MEP` en `templates/base.js` y `consultas.js`.
5. Timeout controlado para `renderTemplate("consulta")` con fallback seguro (evita esperas largas sin respuesta) en `consultas.js`.

Validacion rapida posterior:

- Cambio de plan por texto directo responde confirmacion deterministicamente.
- Bloque de dolar muestra `MEP` (sin `BOLSA`).
- No aparecen placeholders crudos en la respuesta de prueba.
