# Fuentes MAGyP priorizadas (ingesta segura)

Fecha: 2026-04-29

Objetivo: incorporar fuentes oficiales sin romper el flujo actual de AgroHabilis, priorizando datos estructurados y trazables.

## Lote 1 (MVP inmediato - alta prioridad)

1. **SIO Granos (monitor)**
   - URL: https://monitorsiogranos.magyp.gob.ar/monitorsiogranos.html
   - Tipo: Web app (tableros/datos de operaciones)
   - Uso: referencia diaria por zona (Quequén, Bahía, Rosario, etc.), validación de precios plaza/puerto
   - Método sugerido: scraper robusto + fallback por última referencia válida
   - Frecuencia: diaria/intradía

2. **SIO Carnes (bovino/porcino)**
   - URL base: https://siocarnes.magyp.gob.ar/
   - BOVINO: https://siocarnes.magyp.gob.ar/MonitorSioCarnes/MonitorSioCarnes?idAnimal=1&animal=BOVINO
   - PORCINO: https://siocarnes.magyp.gob.ar/MonitorSioCarnes/MonitorSioCarnes?idAnimal=2&animal=PORCINO
   - Tipo: Web app (monitor por categorías y zonas)
   - Uso: precios de referencia hacienda por categoría
   - Método sugerido: scraper de endpoints/tablas + normalización por kg vivo
   - Frecuencia: diaria

3. **Portal de Datos Abiertos MAGyP**
   - URL: https://datos.magyp.gob.ar/dataset
   - Hub institucional: https://www.argentina.gob.ar/economia/agricultura/datos-abiertos
   - Tipo: datasets estructurados (CSV/otros)
   - Uso: series históricas oficiales (siembra, cosecha, producción, rendimiento)
   - Método sugerido: ingesta batch versionada (sincrónica nocturna)
   - Frecuencia: según dataset

## Lote 2 (alto impacto - fase siguiente)

4. **Mercados Agropecuarios MAGyP (FOB/FAS/Cotizaciones)**
   - URL: https://www.magyp.gob.ar/mercadosagropecuarios/
   - Tipo: página institucional con cotizaciones
   - Uso: referencias oficiales complementarias (FOB/FAS)
   - Método: scraping controlado con parser de bloques de cotización

5. **Monitor Comercio Granario**
   - URL: https://monitorssma.magyp.gob.ar/siogranos.dashboardgranos.aspx
   - Tipo: dashboard web
   - Uso: consolidado comercial granario y series
   - Método: extracción parcial (cards clave) + validación cruzada

6. **Tableros Datos Abiertos**
   - URL: https://magyp.gob.ar/tda/index.php?tda
   - Tipo: tablero visual
   - Uso: navegación temática para descubrir series útiles
   - Método: descubrimiento y mapeo, no scraper principal

## Lote 3 (complementarias / PDF-heavy)

7. **Informes semanales/mensuales de estimaciones**
   - URL: https://www.magyp.gob.ar/sitio/areas/estimaciones/estimaciones/informes/
   - Ejemplo PDF:
     - https://www.magyp.gob.ar/sitio/areas/estimaciones/_archivos/estimaciones/260000_2026/260400_Abril/260401_Informe%20semanal%20al%2001_04_2026.pdf
   - Tipo: PDF
   - Uso: contexto cualitativo y alertas de campaña
   - Método: parser PDF (extractivo), nunca como única fuente de precio

8. **Monitor frutas y hortalizas (PDF)**
   - URL: https://www.magyp.gob.ar/sitio/areas/ss_mercados_agropecuarios/publicaciones/_archivos/000104_Monitor%20de%20Precios%20de%20Frutas%20y%20Hortalizas/000001_Monitor%20de%20Precios.pdf
   - Tipo: PDF
   - Uso: economías regionales (papa/limón y otros)
   - Método: parser PDF + fallback por histórico

9. **Lechería / tableros**
   - URL: https://www.magyp.gob.ar/sitio/areas/ss_lecheria/estadisticas/
   - Tipo: tablero + publicaciones
   - Uso: bloque sectorial lácteos (PRO o reportes específicos)

10. **Miel (SIM)**
   - URL: https://www.magyp.gob.ar/monitorpreciosmiel/
   - Tipo: monitor de referencia semanal
   - Uso: precio de referencia apícola

11. **OMEGA (riesgo/emergencias)**
   - URL: https://www.magyp.gob.ar/sitio/areas/d_eda/omega/
   - Tipo: reportes/informes
   - Uso: contexto climático-riesgo (sequía/inundación/incendios)

## Otras fuentes recibidas (mapeadas para fase documental)

- Tematizadores MAGyP:
  - https://www.argentina.gob.ar/economia/agricultura/datos-abiertos/tematizadores
- Visor IDE Agro:
  - https://geoportal.magyp.gob.ar/visor/?zoom=4&lat=-39.6057&lng=-65.1709&layers=argenmap,mapa_base:010307E009_v_acopiodepartamento2001_5000#
- SIO Vinos:
  - https://consultas.inv.gob.ar/index.php?r=siovinos
- Lanas:
  - https://www.magyp.gob.ar/sitio/areas/ss_mercados_agropecuarios/sistemas-de-informacion-de-operaciones-sio/spr-lanas/index.php
- Avance de siembra/cosecha:
  - https://www.magyp.gob.ar/sitio/areas/estimaciones/monitor_semanal/avance/index.php

## Criterio de prioridad (obligatorio)

Orden de decisión para cualquier respuesta del bot:

1. **Primero: dato más actualizado (frescura)**
   - Priorizar fuentes con corte diario/intradía.
   - Si hay dos fuentes, gana la que tenga timestamp más reciente y válido.
2. **Segundo: dato más preciso para la pregunta**
   - Si el usuario pide plaza/zona/categoría, elegir fuente que permita ese nivel de detalle.
   - Si no hay ese detalle, usar referencia cercana y aclararlo.
3. **Tercero: contexto complementario**
   - Noticias/informes sólo para enriquecer decisión, no para reemplazar precio puntual.

### Matriz rápida (frescura → precisión)

- **Nivel A (usar primero):** SIO Granos, SIO Carnes, tipo de cambio diario.
- **Nivel B (usar para mejorar precisión):** datasets MAGyP históricos, monitor comercio granario.
- **Nivel C (contexto):** informes PDF, OMEGA, tableros sectoriales.

## Reglas de integración (operativas)

1. Priorizar fuente estructurada (API/CSV) por encima de HTML y PDF.
2. Guardar siempre trazabilidad: `fuente`, `url`, `fecha`, `tipo_dato`, `calidad`.
3. Si falla fuente principal: fallback a última referencia válida + etiqueta explícita.
4. Nunca inventar precios: si no hay dato confiable, responder contexto y recomendación.
5. Validación mínima: rango duro + contraste con al menos una fuente alternativa cuando exista.
6. Si hay conflicto entre frescura y exactitud:
   - para consultas operativas de hoy, priorizar frescura (marcar “referencia de mercado” si aplica),
   - para análisis técnico/histórico, priorizar precisión y serie consistente.

## Siguiente implementación sugerida (sin romper producción)

1. Integrar SIO Granos (lectura + normalización + guardado).
2. Integrar SIO Carnes (bovino/porcino por categorías clave).
3. Integrar datasets MAGyP como job nocturno histórico (no bloqueante).
