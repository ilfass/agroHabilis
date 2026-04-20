# Roadmap de ejecucion (MVP Fase 1)

Este documento traduce la vision de producto en tareas concretas, ordenadas y medibles para ejecutar rapido sin perder foco.

## Objetivo operativo

En 7-10 dias dejar funcionando el loop principal:

1. Recolectar precios (Rosario) cada manana.
2. Generar resumen de 5 lineas con IA.
3. Enviar el resumen por WhatsApp a un numero fijo.
4. Registrar ejecucion, errores y costo.

## Principios de ejecucion

- Primero que funcione de punta a punta, despues optimizar.
- Evitar scope creep: no sumar dashboard ni pagos en Fase 1.
- Cada dia debe cerrar con algo verificable en entorno real.
- Todo cambio debe quedar deployado en VPS.

## Tablero de trabajo

## Backlog

- [x] Validar fuente Rosario (API/HTML/PDF) y estrategia tecnica.
- [x] Implementar scraper de precios normalizado.
- [x] Guardar precios en DB con idempotencia.
- [x] Implementar generador de resumen con Gemini.
- [x] Implementar envio WhatsApp (proveedor inicial).
- [ ] Integrar jobs diarios (`recolector` y `enviador`).
- [ ] Agregar logs estructurados y trazabilidad basica.
- [ ] Medir tokens/costo por resumen.

## En progreso

- [ ] (vacio)

## Bloqueado

- [ ] (vacio)

## Hecho

- [x] Base del proyecto Node.js creada.
- [x] Estructura de carpetas definida.
- [x] Esquema PostgreSQL implementado.
- [x] Deploy manual local a VPS operativo con un comando.
- [x] PM2 y health endpoint funcionando.
- [x] Envio de resumen por WhatsApp con `whatsapp-web.js` + registro en `envios_whatsapp`.

## Plan de 10 dias (sprint operativo)

## Dia 1 - Fuente Rosario

- [x] Verificar formato real de datos (API, HTML o PDF).
- [x] Elegir estrategia y definir parser.
- [x] Guardar muestra de respuesta para pruebas.

Entregable:
- decision tecnica cerrada + contrato de salida (`cultivo`, `mercado`, `precio`, `fecha`).

## Dia 2 - Scraper funcional

- [x] Crear `src/scrapers/bcrBoletin.js` (PDF del Boletin Diario + `pdftotext`).
- [x] Manejar errores de red y formato.
- [x] Devolver salida normalizada.

Entregable:
- comando local que imprime precios normalizados.

## Dia 3 - Persistencia en DB

- [x] Crear modelo/query para insertar precios.
- [x] Aplicar `ON CONFLICT` o control de duplicados.
- [x] Loguear cantidad de registros insertados/omitidos.

Entregable:
- corrida completa scraper + guardado en `precios`.

## Dia 4 - Resumen IA

- [x] Crear `src/services/gemini.js`.
- [x] Prompt base de 5 lineas orientado a accion.
- [x] Guardar resumen en `resumenes`.

Entregable:
- resumen generado y persistido para fecha actual.

## Dia 5 - Envio WhatsApp

- [x] Crear `src/config/whatsapp.js`, `src/services/notificaciones.js` y `src/services/enviosWhatsapp.js`.
- [x] Integrar envio por WhatsApp Web (`whatsapp-web.js`) con mensajes de texto.
- [x] Registrar estado en `envios_whatsapp` y marcar `resumenes.enviado_wp`.

Entregable:
- mensaje real recibido en numero fijo.

## Dia 6 - Orquestacion manual punta a punta

- [ ] Script/comando unico de corrida manual MVP.
- [ ] Trazas de inicio/fin por etapa.
- [ ] Manejo de errores recuperables.

Entregable:
- una ejecucion completa end-to-end validada.

## Dia 7 - Cron diario

- [ ] `src/jobs/recolector.js` (7:00).
- [ ] `src/jobs/enviador.js` (8:00).
- [ ] Arranque de jobs desde `src/index.js`.

Entregable:
- jobs agendados y ejecutando en VPS.

## Dia 8 - Observabilidad minima

- [ ] Logger consistente por modulo.
- [ ] Correlation ID por corrida diaria.
- [ ] Resumen diario de resultado (ok/error/costo).

Entregable:
- diagnostico simple sin entrar a codigo.

## Dia 9 - Prueba piloto

- [ ] Probar con 3-10 productores cercanos (o simulados).
- [ ] Recolectar feedback de claridad y utilidad.
- [ ] Ajustar prompt y formato de mensaje.

Entregable:
- feedback cualitativo documentado.

## Dia 10 - Cierre MVP

- [ ] Documentar arquitectura final de Fase 1.
- [ ] Checklist de operacion diaria.
- [ ] Lista priorizada para Fase 2.

Entregable:
- MVP listo para uso continuo y medible.

## Checklist diario (operativo)

Al iniciar:

- [ ] `git pull --rebase origin main`
- [ ] revisar pendientes del tablero (`Backlog`, `En progreso`, `Bloqueado`)
- [ ] elegir 1 objetivo del dia

Al cerrar:

- [ ] probar flujo local o parcial correspondiente
- [ ] commit con mensaje claro
- [ ] `git push origin main`
- [ ] `npm run deploy:vps`
- [ ] verificar `pm2 status` y health endpoint
- [ ] mover tareas en el tablero

## Definicion de "Hecho" (DoD) para cada tarea

Una tarea se considera terminada solo si:

- corre en local sin romper otras partes,
- queda deployada en VPS,
- tiene logs utiles para diagnostico,
- persiste/lee datos correctamente (si aplica),
- esta documentada en README o docs si cambia operacion.

## Riesgos y mitigacion

- Riesgo: la fuente Rosario cambia formato.
  - Mitigacion: parser defensivo + alertas de falla en logs.

- Riesgo: canal WhatsApp no estable al inicio.
  - Mitigacion: aislar proveedor en `services/notificaciones.js` para reemplazo rapido.

- Riesgo: costo IA crece sin control.
  - Mitigacion: registrar tokens por resumen y limitar longitud.

## Proximos pasos despues del MVP

- Registro web de usuarios (Fase 2).
- Segmentacion por zona/cultivo.
- Integracion clima completa.
- Plan gratuito semanal operativo.
