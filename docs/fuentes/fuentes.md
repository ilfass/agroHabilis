# Fuentes de datos AgroHabilis

## Vista operativa (prioridad y frecuencia)

### Prioridad A (usar primero en respuestas operativas)
- `cac_bcr` (diaria)
- `magyp_fob` (diaria)
- `dolarapi` / `bluelytics` (tiempo real)
- `open_meteo` (tiempo real)
- `liniers` / `mercadodeliniers_web` (diaria)
- `matba_rofex` (cuando esté activa)

### Prioridad B (mejoran precisión y cobertura)
- `afa_scl`, `cbot_chicago`
- `argenpapa_mcba`, `magyp_fyh_mcba_csv`
- `noticiasdecampo_wp`, `infocampo_wp`, `todoagro_web`, `lanacion_campo`
- `lncampo_mercado_granos`
- `smn`, `senasa`, `boletin_oficial` (según caso)

### Prioridad C (contexto / exploración / no activas)
- Fuentes marcadas `Activa = no`
- Fuentes `por_investigar` o con incidencias (ej. 404)

## Inventario completo

Esta tabla consolida fuentes actuales y planificadas con su estado técnico.

| ID | Nombre | Categoría | Subgrupo | Tipo | URL | Productos/Variables | Región/Cobertura | Frecuencia | Oficial | Activa | Scraper |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `cac_bcr` | Cámara Arbitral de Cereales - BCR | granos | disponible | scraping_html | https://www.cac.bcr.com.ar/es/precios-de-pizarra | soja, maiz, trigo, girasol, sorgo | pampeana | diaria | si | si | `src/scrapers/granos_cac.js` |
| `magyp_fob` | Ministerio de Agricultura - Precios FOB | granos | disponible | api_json | https://www.magyp.gob.ar/sitio/areas/ss_mercados_agropecuarios/fob_oficiales/_archivos/000021_Precios%20Fob%20Api.php | soja, maiz, trigo, girasol, sorgo | todas | diaria | si | si | `src/scrapers/granos_magyp_fob.js` |
| `afa_scl` | AFA San Cristóbal - Mercados en línea | granos | disponible | scraping_html | https://www.afascl.coop/afadiario/mercados-en-linea | soja, maiz, trigo, girasol | pampeana | diaria | no | si | `src/scrapers/granos_afa.js` |
| `matba_rofex` | MATba-Rofex - Futuros agropecuarios | granos | futuros | api_json | https://api.matbarofex.com.ar/v2/symbol | soja, maiz, trigo, girasol, sorgo, cebada | nacional | diaria | si | no | `src/scrapers/futuros_matba.js` |
| `cbot_chicago` | CBOT Chicago - Futuros internacionales | granos | futuros | scraping_html | https://www.afascl.coop/afadiario/mercados-en-linea | soja, maiz, trigo | internacional | diaria | no | si | `src/scrapers/granos_afa.js` |
| `liniers` | Mercado Agroganadero (ex Liniers) | ganaderia | vacunos | scraping_html | http://www.mercadoagroganadero.com.ar/dll/inicio.dll | novillo, vaca, ternero, vaquillonas, toros | nacional | diaria | si | si | `src/scrapers/hacienda.js` |
| `mercadodeliniers_web` | Mercado de Liniers (fallback web) | ganaderia | vacunos | scraping_html | https://www.mercadodeliniers.com.ar | novillo, vaca, ternero, vaquillona, toro | nacional | diaria | si | si | `src/scrapers/hacienda.js` |
| `mercado_central_ba` | Mercado Central de Buenos Aires | frutas_verduras | mercado_central | por_investigar | https://www.mercadocentral.gob.ar/joom/index.php/precios-diarios *(404 al verificar)* | todas_frutas, todas_verduras | nacional | diaria | si | no | - |
| `inym` | Instituto Nacional de la Yerba Mate | economias_regionales | yerba_mate | por_investigar | https://www.inym.org.ar/estadisticas/precio-de-la-hoja-verde/ *(404 al verificar)* | yerba_mate_hoja_verde | nea_misiones | mensual | si | no | - |
| `dolarapi` | DolarAPI | economia_macro | tipo_cambio | api_json | https://dolarapi.com/v1/dolares | oficial, blue, mep, ccl | nacional | tiempo_real | no | si | `src/scrapers/dolar.js` |
| `bluelytics` | Bluelytics (fallback) | economia_macro | tipo_cambio | api_json | https://api.bluelytics.com.ar/v2/latest | oficial, blue | nacional | tiempo_real | no | si | `src/scrapers/dolar.js` |
| `ypf_gasoil` | YPF - Precio gasoil por provincia | economia_macro | combustibles | por_investigar | https://www.ypf.com/precios | gasoil_grado2, gasoil_grado3 | nacional | semanal | si | no | - |
| `open_meteo` | Open-Meteo | clima | principal | api_json | https://api.open-meteo.com/v1/forecast | temperatura, precipitacion, helada, viento | mundial | tiempo_real | si | si | `src/scrapers/clima.js` |
| `smn` | Servicio Meteorológico Nacional | clima | principal | por_investigar | https://www.smn.gob.ar | alertas meteorológicas oficiales | argentina | diaria | si | no | - |
| `agrofy_insumos` | Agrofy Insumos | insumos | mercado_online | scraping_html | https://www.agrofy.com.ar/insumos | insumos_varios | nacional | diaria | no | si | `src/scrapers/insumos.js` |
| `agrofy_proxy_jina` | Agrofy Insumos (proxy jina.ai) | insumos | mercado_online | scraping_html | https://r.jina.ai/http://www.agrofy.com.ar/insumos/productos-con-precio | insumos_varios | nacional | diaria | no | si | `src/scrapers/insumos.js` |
| `agroads_insumos` | Agroads Insumos | insumos | mercado_online | scraping_html | https://www.agroads.com.ar/insumos-agricolas | insumos_varios | nacional | diaria | no | si | `src/scrapers/insumos.js` |
| `agroads_proxy_jina` | Agroads Insumos (proxy jina.ai) | insumos | mercado_online | scraping_html | https://r.jina.ai/http://www.agroads.com.ar/insumos-agricolas | insumos_varios | nacional | diaria | no | si | `src/scrapers/insumos.js` |
| `argenpapa_mcba` | Argenpapa - Cotizaciones Mercado Central BA | hortalizas | papa | scraping_html | https://www.argenpapa.com.ar/mercados/ | papa | buenos_aires | diaria | no | si | `src/scrapers/papa_argenpapa.js` |
| `magyp_fyh_mcba_csv` | MAGyP/Datos.gob.ar - FYH Mercado Central (CSV) | hortalizas | papa | csv | https://datos.magyp.gob.ar/dataset/8b4d6a1f-753d-4707-9085-bdcbbc47f00b/resource/6dce1e87-7988-4eaf-b0e1-b3abbb3964da/download/precios-fyh-mercadocentral-bsas-arg-2017-2c2018-.csv | papa | buenos_aires | histórica | si | si | `src/scrapers/papa_magyp_csv.js` |
| `noticiasdecampo_wp` | Noticias de Campo (WordPress API) | noticias_agro | portales | api_json | https://www.noticiasdecampo.com/wp-json/wp/v2/posts | noticias_agro | argentina | horaria | no | si | `src/scrapers/noticias_web.js` |
| `infocampo_wp` | InfoCampo (WordPress API) | noticias_agro | portales | api_json | https://www.infocampo.com.ar/wp-json/wp/v2/posts | noticias_agro | argentina | horaria | no | si | `src/scrapers/noticias_web.js` |
| `infocampo_ultimas_web` | InfoCampo - Últimas noticias (web) | noticias_agro | portales | scraping_html | https://www.infocampo.com.ar/ultimas-noticias/ | noticias_agro | argentina | horaria | no | si | `src/scrapers/noticias_web.js` |
| `infocampo_mercados_empresas` | InfoCampo - Mercados y empresas (web) | noticias_agro | portales | scraping_html | https://www.infocampo.com.ar/category/mercados-y-empresas/ | noticias_agro, mercados | argentina | horaria | no | si | `src/scrapers/noticias_web.js` |
| `todoagro_web` | TodoAgro (portada web) | noticias_agro | portales | scraping_html | https://www.todoagro.com.ar | noticias_agro, mercados | argentina | horaria | no | si | `src/scrapers/noticias_web.js` |
| `lncampo_mercado_granos` | LN Campo - Mercado de granos | noticias_agro | portales | scraping_html | https://www.lncampo.lanacion.com.ar/mercado-granos/ | soja, maiz, trigo, girasol, sorgo | argentina | horaria | no | si | `src/scrapers/mercados_web.js` |
| `lanacion_campo` | La Nación Campo - Economía/Campo *(complementaria/no crítica)* | noticias_agro | portales | scraping_html | https://www.lanacion.com.ar/economia/campo/ | noticias_agro | argentina | horaria | no | si | `src/scrapers/noticias_web.js` |
| `rosporc_bcr` | Rosporc BCR | ganaderia | porcinos | scraping_html | https://www.rosporc.com/ | cerdo_capon, precio_referencia | nacional | semanal | no | no | - |
| `tres_tres_ar` | 3tres3 Argentina | ganaderia | porcinos | scraping_html | https://www.3tres3.com/ar/ | porcinos_mercado | argentina | semanal | no | no | - |
| `ovinos_portal` | Ovinos Argentina | ganaderia | ovinos | scraping_html | https://ovinos.com.ar/ | cordero, oveja, lana | argentina | semanal | no | no | - |
| `ocla` | OCLA | ganaderia | lacteos | scraping_html | https://www.ocla.org.ar/ | leche_cruda_litro, lacteos_indicadores | argentina | mensual | no | no | - |
| `precios_del_central` | Precios del Central | frutas_verduras | mercado_central | scraping_html | https://www.preciosdelcentral.com.ar/ | frutas, verduras | nacional | diaria | no | no | - |
| `inv_ar` | Instituto Nacional de Vitivinicultura | economias_regionales | vitivinicultura | scraping_html | https://www.argentina.gob.ar/inv | uva, vino_granel | cuyo | semanal | si | no | - |
| `surtidores_gasoil` | Surtidores | economia_macro | combustibles | scraping_html | https://www.surtidores.com.ar/ | gasoil_grado2, gasoil_grado3 | nacional | semanal | no | no | - |
| `fadeeac_tarifas` | FADEEAC | economia_macro | combustibles | scraping_html | https://www.fadeeac.org.ar/ | flete_granario_km, flete_referencia | nacional | semanal | no | no | - |
| `argentinadatos_tc` | ArgentinaDatos | economia_macro | tipo_cambio | api_json | https://www.argentinadatos.com/ | dolar_oficial, dolar_blue, dolar_mep, dolar_ccl | nacional | tiempo_real | no | no | - |
| `todoagro_rss` | TodoAgro RSS | noticias_agro | portales | rss | https://www.todoagro.com.ar/feed/ | noticias_agro, ganaderia, mercados | argentina | horaria | no | no | - |
| `senasa` | SENASA | regulatorio | oficial | manual_web | https://www.senasa.gob.ar/ | sanidad_animal, resoluciones_sanitarias | argentina | manual | si | no | - |
| `boletin_oficial` | Boletín Oficial | regulatorio | oficial | manual_web | https://www.boletinoficial.gob.ar/ | retenciones, normativa_agro | argentina | manual | si | no | - |

## Fuente de verdad

- Configuración viva: `src/config/fuentes.js`
- Monitoreo técnico: `src/services/fuentes_monitor.js`
- Dashboard admin: sección "Estado de fuentes"
