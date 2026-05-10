# Fuentes y marco base: Hacienda/Ganaderia

Este documento define el marco inicial para analisis de indicadores de hacienda, con foco en referencias de Mercado Agroganadero (MAG).

Fuente principal usada para este arranque:
- https://www.mercadoagroganadero.com.ar/dll/preguntas-frecuentes.html

## 1) Definiciones clave

- `INMAG`: Indice Novillo Mercado Agroganadero.
- `INMAG sugerido para Arrendamientos Rurales / Rofex`: serie de continuidad metodologica para mantener comparabilidad historica con el viejo esquema (novillos desde 400 kg).
- `IGMAG`: Indice General Mercado Agroganadero, equivalente al promedio general diario de operaciones en pie.

## 2) Reglas de inclusion (INMAG)

Base de lotes considerados:
- Novillos mestizos con peso superior al umbral vigente.
- Novillos overo negro (cualquier peso).
- Novillos cruza cebu (cualquier peso).
- Novillos cruza europea (cualquier peso).
- Novillos conserva (cualquier peso).

Umbral historico relevante:
- Hasta el cambio normativo: referencia de 400 kg para mestizos.
- Desde la disposicion ONCCA 5701/2005 (aplicacion informada desde 09/12/2005): mestizos con peso superior a 430 kg.

## 3) Formula de calculo (promedio ponderado por peso)

Para lotes validos:
- `importe_lote = peso_lote * precio_lote`
- `indice = SUM(importe_lote) / SUM(peso_lote)`

Interpretacion:
- Es un promedio ponderado por peso total negociado.
- No es promedio simple de precios por lote.

## 4) Alcance operativo recomendado en el sistema

Usar estos campos estandar para ingestar/calcular:
- `indice` (INMAG, INMAG_SUGERIDO, IGMAG)
- `fecha`
- `categoria` (si aplica por lote)
- `peso_total`
- `precio_promedio`
- `importe_total`
- `metodologia` (version/regla aplicada, por ejemplo `oncca_5701_2005_post`)
- `fuente_url`

## 5) Checklist para scraper / parser

- Tomar fecha oficial de cierre del dia.
- Validar que peso y precio sean numericos y positivos.
- Registrar explicitamente criterio de inclusion aplicado.
- Guardar trazabilidad de fuente (`fuente_url`) y timestamp de extraccion.
- Evitar mezclar series con metodologias distintas sin etiquetado.
- Si hay cambio metodologico, versionar la regla y documentar corte temporal.

## 6) Checklist minimo de tests

- Test de inclusion/exclusion por categoria y umbral de peso.
- Test de formula ponderada (`SUM(peso*precio)/SUM(peso)`).
- Test de cambio de metodologia segun fecha de corte.
- Test de parseo robusto (decimal, separadores, faltantes).
- Test de idempotencia en recoleccion (no duplicar registros del mismo dia/indice).

## 7) Nota para la capa de IA

Al responder sobre hacienda/ganaderia, la IA debe:
- Aclarar que el INMAG se interpreta como promedio ponderado por peso.
- Mencionar fecha de datos y metodologia aplicada.
- Advertir cuando no hay datos suficientes o cuando hay posible mezcla de series metodologicas.
