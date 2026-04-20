# Producto agroHabilis

## Propuesta de valor

`agroHabilis` es un servicio de inteligencia agropecuaria personalizada para productores chicos y medianos.
Consolida en un solo lugar (primero WhatsApp, luego web) precios, clima, tipo de cambio y noticias sectoriales, filtrado por zona y cultivos del productor.

## Problema que resuelve

Hoy un productor tiene que consultar multiples fuentes por separado:

- precios de granos y hacienda,
- clima y alertas,
- dolar y contexto macro,
- noticias del sector.

Esto consume tiempo y no ofrece una conclusion accionable para su caso puntual.

## Solucion

Cada manana, el sistema genera y entrega un resumen personalizado con:

- precios relevantes para sus cultivos,
- tipo de cambio,
- clima y alerta contextual,
- sintesis de noticias del agro,
- recomendacion breve orientada a decision.

## Usuario objetivo

- Productor agropecuario chico o mediano.
- Perfil con baja disponibilidad de tiempo.
- Necesita informacion practica para decidir venta, cobertura o espera.

## Canales

- Primario (MVP): WhatsApp.
- Secundario (fases siguientes): dashboard web.

## Fuentes de datos objetivo

- Precios: Bolsa de Cereales, mercados de referencia, datos publicos.
- Clima: Open-Meteo y alertas oficiales.
- Tipo de cambio: BCRA y/o APIs publicas.
- Noticias: RSS agro (Infocampo, Clarin Rural, La Nacion Campo, etc.).

## Features clave del producto

1. Alerta climatica con impacto por cultivo y etapa.
2. Calculadora de precio de indiferencia y margen.
3. Consulta libre por WhatsApp con IA.
4. Historial y tendencias personalizadas.
5. Segmentacion por zona y cultivos.

## Modelo de negocio

- Gratis: resumen semanal de precios.
- Basico (USD 5/mes): resumen diario + clima + dolar.
- Pro (USD 12/mes): todo + margen + consulta libre con IA.

## Fases del producto

### Fase 1 - MVP funcional

Objetivo: validar uso real con minimo costo y complejidad.

Incluye:

- cron diario de recoleccion de precios (Rosario como fuente inicial),
- generacion de resumen corto con IA (5 lineas),
- envio por WhatsApp a numero fijo,
- observabilidad minima (logs y errores).

No incluye:

- registro de usuarios,
- pagos,
- dashboard,
- multicliente.

### Fase 2 - Producto basico

Incluye:

- registro simple (nombre, zona, cultivos, WhatsApp),
- perfiles en PostgreSQL,
- integracion de clima,
- plan gratuito operativo.

### Fase 3 - Monetizacion

Incluye:

- dashboard con historial y graficos,
- calculadora de margen,
- consulta libre por WhatsApp con IA,
- integracion Mercado Pago y planes.

## Backlog por sprints (7 a 10 dias para Fase 1)

### Sprint 1 - Loop tecnico minimo (2-3 dias)

- [ ] Definir scraper inicial de precios Rosario (API, HTML o PDF).
- [ ] Implementar `src/scrapers/granos.js` con salida normalizada.
- [ ] Guardar precios en tabla `precios` con control de duplicados.
- [ ] Crear servicio de resumen IA (`src/services/resumen.js`).
- [x] Crear proveedor de envio WhatsApp (`src/config/whatsapp.js`, `src/services/notificaciones.js`, `src/services/enviosWhatsapp.js`).

Entregable: comando manual que corre fin a fin (sin cron) y envia un resumen.

### Sprint 2 - Automatizacion y robustez (2-3 dias)

- [ ] Job diario `src/jobs/recolector.js` (7:00).
- [ ] Job diario `src/jobs/enviador.js` (8:00).
- [ ] Persistir resumen en `resumenes` y log en `envios_whatsapp`.
- [ ] Manejo de errores y reintentos basicos.
- [ ] Variables de entorno y validacion de config al inicio.

Entregable: flujo diario automatico estable para un numero fijo.

### Sprint 3 - Validacion con usuarios (2-4 dias)

- [ ] Ajustar prompt de resumen para accionabilidad.
- [ ] Agregar topico dolar y clima al resumen MVP (si ya estan disponibles).
- [ ] Medir costo (tokens) y latencia por corrida.
- [ ] Definir mensaje de onboarding y consentimiento WhatsApp.
- [ ] Prueba piloto con 3-10 productores.

Entregable: MVP validado con feedback real y metricas iniciales.

## Metricas de exito inicial (MVP)

- % de envios diarios exitosos (>95%).
- Tiempo medio de generacion y envio (<5 min total).
- Costo IA diario por usuario.
- Tasa de lectura/respuesta en WhatsApp.
- Feedback cualitativo de utilidad ("me sirve para decidir").
