# AgroHabilis

AgroHabilis es una plataforma Node.js pensada para centralizar informacion agropecuaria (precios, clima, resumenes y mensajeria) y habilitar automatizaciones sobre datos productivos.

## Definicion de producto

- Ver `docs/producto.md` para la definicion oficial del producto, fases y backlog por sprints.
- Ver `docs/roadmap-ejecucion.md` para el tablero operativo diario y plan de ejecucion del MVP.

## Stack tecnologico

- Node.js + Express para API y servicios backend.
- PostgreSQL (`pg`) para persistencia.
- `node-cron` para jobs programados.
- `axios` + `cheerio` para integraciones y scraping.
- `pdftotext` (Poppler) en el servidor para parsear el Boletin Diario PDF de BCR.
- `dotenv` para configuracion por entorno.
- `@google/generative-ai` (Gemini) para resumenes con IA.
- `whatsapp-web.js` para envio de mensajes por WhatsApp Web.
- `mercadopago` para suscripciones/pagos.
- `bcryptjs` + `jsonwebtoken` para autenticacion.
- `cors` para acceso desde frontend.
- `winston` para logging.

## Comandos basicos

- `npm start`: inicia la API (`src/index.js`).
- `npm run dev`: inicia la API en modo watch.
- `node scripts/setup-db.js`: crea/verifica las tablas en PostgreSQL y el usuario interno `whatsapp = ahbl:sistema` para guardar resumenes del boletin.
- `npm run deploy:vps`: despliega a la VPS con rsync + npm ci + pm2 restart.
- `npm run release:vps`: hace `git pull --rebase`, `git push` y despliegue en un solo flujo.

## Configuracion inicial

1. Copiar `.env.example` a `.env`.
2. Completar credenciales y variables requeridas.
3. Ejecutar `node scripts/setup-db.js` para inicializar base de datos.
4. Levantar el servidor con `npm start`.

## Jobs y endpoints utiles (MVP)

- `POST /jobs/bcr-boletin`: descarga el ultimo boletin BCR, parsea MFG Rosario y hace upsert en `precios`.
- `POST /jobs/pipeline-diario`: precios + resumen Gemini + envio WhatsApp (si corresponde). Body opcional:
  - `{ "persistirResumen": false }`: solo precios.
  - `{ "incluirDetalle": true }`: mas filas al modelo.
  - `{ "enviarWhatsapp": false }`: no enviar aunque este configurado.
- `POST /jobs/whatsapp-test`: envia un texto de prueba (body opcional `{ "numero": "549...", "mensaje": "..." }`).
- `GET /debug/bcr-boletin`: JSON de preview sin escribir en DB.
- `POST /ai/resumen-mercado`: genera texto con Gemini; con `{ "persistir": true }` guarda en `resumenes`; por defecto intenta WhatsApp si esta configurado (usar `{ "enviarWhatsapp": false }` para omitir).

## WhatsApp Web.js

1. Definir `WHATSAPP_SESSION_PATH=./.wwebjs_auth` en `.env` (opcional, ese es el default).
2. Iniciar con `npm start` y escanear el QR en terminal.
3. `WHATSAPP_DESTINO`: numero destino en formato internacional **solo digitos**, sin `+` (ejemplo Argentina: `549XXXXXXXXXX`).
4. Probar envio con `POST /jobs/whatsapp-test`.

Actualizacion: deploy automatico configurado con GitHub Actions.

## Flujo recomendado de deploy local

1. Hacer cambios y commit:
   - `git add .`
   - `git commit -m "mensaje"`
2. Deploy manual rapido:
   - `npm run deploy:vps`
3. Release completo (push + deploy):
   - `npm run release:vps`

### Variables opcionales para deploy

Si queres cambiar parametros sin tocar scripts:

- `VPS_HOST` (default `147.93.36.212`)
- `VPS_USER` (default `root`)
- `VPS_PATH` (default `/var/www/agro.habilispro.com`)
- `APP_NAME` (default `agrohabilis`)
- `HEALTH_HOST_HEADER` (default `agro.habilispro.com`)
