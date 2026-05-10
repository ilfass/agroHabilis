# Manual del Proyecto AgroHabilis

## 1) Objetivo del sistema

AgroHabilis centraliza datos agropecuarios y los convierte en decisiones accionables para productores, principalmente por WhatsApp.  
El sistema combina:

- Recoleccion automatica de datos (precios, clima, dolar, hacienda, insumos, noticias).
- Persistencia y trazabilidad en PostgreSQL.
- Resumenes personalizados por plan (gratis/basico/pro).
- Consulta libre por WhatsApp con IA y contexto de datos reales.
- Panel admin para monitoreo operativo y gestion de usuarios.

---

## 2) Arquitectura general

- `src/index.js`: API Express, auth admin, endpoints de dashboard, jobs manuales y cron global.
- `src/jobs/recolector.js`: recolecta/normaliza/valida datos y guarda en DB.
- `src/jobs/enviador.js`: envio de resumenes por WhatsApp segun plan/frecuencia.
- `src/services/resumen.js`: arma resumen diario por usuario y plan.
- `src/services/consultas.js`: procesa consultas de WhatsApp.
- `src/config/whatsapp.js`: cliente WhatsApp Web y enrutamiento de mensajes.
- `src/services/fuentes_monitor.js`: chequeo tecnico de disponibilidad de fuentes.
- `scripts/setup-db.js`: alta/actualizacion de tablas.

Stack principal:

- Node.js + Express
- PostgreSQL
- node-cron
- axios + cheerio
- whatsapp-web.js
- Gemini/OpenRouter/Groq (segun configuracion)

---

## 3) Flujo operativo diario

1. `recolector` corre (cron L-V) y guarda datos de mercado/clima/macro/noticias.
2. se validan precios antes de insertarlos.
3. `enviador` genera y envia resumenes segun plan activo del usuario.
4. el usuario puede hacer preguntas por WhatsApp, y la IA responde con contexto de DB.
5. el admin puede disparar jobs/manuales y monitorear cobertura/estado desde dashboard.

---

## 4) Planes y contenido

### Gratis

- Resumen con frecuencia reducida.
- Bloques base.
- Incluye leyenda de upgrade.
- Incluye trial: `MUESTRA PRO (3)` (2 noticias + 1 dato de mercado web cuando hay datos).

### Basico

- Resumen diario.
- Bloques base + bloques plus (oportunidad y riesgos).
- Incluye trial: `MUESTRA PRO (3)`.

### Pro

- Todo lo de basico.
- Insights avanzados por producto/zona.
- Escenarios y alertas sugeridas.
- Bloque completo `RADAR WEB PRO (Noticias + Mercado)`.

---

## 5) Datos recolectados actualmente

Principales categorias:

- Granos disponibles (MAGyP FOB, CAC, AFA).
- Futuros (MATba-Rofex cuando API disponible).
- Dolar (DolarAPI + fallback Bluelytics).
- Clima (Open-Meteo).
- Hacienda (MAG + fallback web).
- Insumos (Agrofy/Agroads + proxies + fallback).
- Papa (Argenpapa + fallback CSV MAGyP).
- Noticias agro (`noticias_agro`) y mercados web de apoyo.

Referencia de fuentes:

- `docs/fuentes/fuentes.md`
- `src/config/fuentes.js` (fuente de verdad operativa)

---

## 6) Validacion interna de datos (estado actual)

Se implemento validacion transversal para **todas las inserciones de precios** en `recolector`.

### Reglas aplicadas

1. Validacion estructural:
   - campos requeridos (`cultivo`, `mercado`, `fecha`, `precio`)
   - moneda detectada (`ARS` o `USD`)
   - precio > 0

2. Validacion por rango duro (anti parseo roto):
   - ARS: 10.000 a 2.000.000
   - USD: 20 a 1.500

3. Validacion cruzada:
   - compara contra promedio interno 7 dias del mismo cultivo/moneda
   - excluye mercados web para tomar referencia mas confiable

4. Umbral de desvio:
   - perfil general: rechazo si > 60%
   - perfil web: rechazo si > 35%

5. Score de confianza:
   - puntaje base por origen de mercado (MAGYP/CAC/MATBA/WEB/etc)
   - penalizacion por desvio respecto de referencia interna

### Trazabilidad

Se registra cada validacion en tabla `validaciones_precios` con:

- dato evaluado (cultivo/mercado/moneda/fecha/valor)
- resultado (`ok`)
- `score_confianza`
- motivo
- referencia y desvio
- perfil de validacion (`general`/`web`)

---

## 7) Base de datos (tablas clave)

Operativas:

- `usuarios`
- `usuario_cultivos`
- `perfil_productivo`
- `resumenes`
- `historial_consultas`

Mercado y contexto:

- `precios`
- `tipo_cambio`
- `clima`
- `precios_hacienda`
- `precios_insumos`
- `futuros_posiciones`

Observabilidad y calidad:

- `fuentes_estado`
- `noticias_agro`
- `validaciones_precios`

---

## 8) Endpoints importantes

Salud/operacion:

- `GET /api/health`
- `POST /api/admin/recolectar`
- `POST /api/admin/enviar-resumen`

Jobs y debug:

- `POST /jobs/pipeline-diario`
- `POST /jobs/bcr-boletin`
- `GET /debug/bcr-boletin`

Dashboard:

- `GET /api/dashboard/admin/resumen`
- `GET /api/dashboard/admin/usuarios`
- `GET /api/dashboard/admin/usuario-detalle`
- `GET /api/dashboard/cliente`

---

## 9) Cron y frecuencias

- Recolector principal: L-V 07:00 (AR).
- CAC intradiario: cada hora entre 10:15 y 18:15 (AR).
- Pipeline diario: 09:00 (AR).
- Monitor de fuentes: cada 30 minutos.

---

## 10) Configuracion y arranque

### Variables criticas

- `DATABASE_URL`
- `ADMIN_KEY`
- `WHATSAPP_SESSION_PATH`
- `WHATSAPP_CLIENT_ID`
- `GEMINI_API_KEY` / `OPENROUTER_API_KEY` / `GROQ_API_KEY`
- `IA_PROVIDER_ORDER` (opcional)

### Arranque rapido

1. configurar `.env`
2. `node scripts/setup-db.js`
3. `npm start`
4. validar `GET /api/health`

---

## 11) Operacion y troubleshooting

### No llegan resumenes

- verificar WhatsApp conectado y sesion valida.
- revisar `resumenes` (generacion) y logs de envio.
- confirmar cron activo y usuario `activo=true`.

### “Sin datos” o baja cobertura

- revisar `fuentes_estado` y dashboard admin.
- ejecutar recolector manual: `POST /api/admin/recolectar`.
- inspeccionar fallback activado en resumen de job.

### Errores de DB (credenciales)

- revisar `DATABASE_URL` en entorno.
- validar conexion con `node scripts/setup-db.js`.

---

## 12) Estado actual (implementado)

- onboarding y primer resumen integrados en un solo flujo.
- mejoras de consultas con memoria corta y deteccion robusta de cultivo.
- soporte papa con doble fuente.
- robustez por fallback en insumos/hacienda/dolar/futuros.
- transparencia de calidad/origen en dashboard para fuentes criticas.
- bloque PRO con noticias + mercado web.
- trial de 3 muestras para planes no pro.
- validador interno transversal de precios + tabla de auditoria.

---

## 13) Pendientes sugeridos (siguientes iteraciones)

- Dashboard de calidad de validaciones (`validaciones_precios`) con tasa de rechazo por fuente.
- Alertas operativas por degradacion de fuente (no solo estado HTTP).
- Reglas de validacion especificas por cultivo y estacionalidad.
- Versionado de prompts IA y evaluacion automatica de respuestas.
- Endpoints dedicados para explotar `noticias_agro` en frontend cliente.

