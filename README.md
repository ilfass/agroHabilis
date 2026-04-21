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
- `@google/generative-ai` (Gemini) + OpenRouter para resumenes y consultas con IA.
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
- `POST /jobs/pipeline-diario`: precios + resumen IA + envio WhatsApp (si corresponde). Body opcional:
  - `{ "persistirResumen": false }`: solo precios.
  - `{ "incluirDetalle": true }`: mas filas al modelo.
  - `{ "enviarWhatsapp": false }`: no enviar aunque este configurado.
- `POST /jobs/whatsapp-test`: envia un texto de prueba (body opcional `{ "numero": "549...", "mensaje": "..." }`).
- `GET /debug/bcr-boletin`: JSON de preview sin escribir en DB.
- `POST /ai/resumen-mercado`: genera texto con IA (Gemini y/o OpenRouter segun configuracion); con `{ "persistir": true }` guarda en `resumenes`; por defecto intenta WhatsApp si esta configurado (usar `{ "enviarWhatsapp": false }` para omitir).
- Consultas entrantes por WhatsApp: cualquier mensaje privado al numero vinculado dispara `procesarConsulta` (`src/services/consultas.js`), responde con IA usando contexto de DB (`precios`, `tipo_cambio`, `usuario_cultivos`) y guarda historial en `historial_consultas`.

## WhatsApp Web.js

1. Definir `WHATSAPP_SESSION_PATH=./.wwebjs_auth` en `.env` (opcional, ese es el default).
2. Iniciar con `npm start` y escanear el QR en terminal.
3. `WHATSAPP_DESTINO`: numero destino en formato internacional **solo digitos**, sin `+` (ejemplo Argentina: `549XXXXXXXXXX`).
4. Probar envio con `POST /jobs/whatsapp-test`.

### Mini manual para usuarios (WhatsApp)

Comandos de alertas de precio:

- Crear alerta (usar `ALERTA` o `AVISAME` al inicio):
  - `AVISAME cuando la soja supere 450000`
  - `ALERTA si el maiz baja de 240000`
  - `AVISAME si el dolar blue sube de 1500`
  - `ALERTA cuando el trigo llegue a 280000`
- Ver alertas activas:
  - `MIS ALERTAS`
- Cancelar alerta por ID:
  - `CANCELAR ALERTA 12`

Notas:

- El usuario debe estar registrado para crear alertas.
- Cultivos reconocidos: `soja`, `maiz`, `trigo`, `girasol`.
- Para dolar: si no especifica `blue`, se asume `oficial`.

Actualizacion: deploy automatico configurado con GitHub Actions.

## Deploy en VPS (checklist)

1. **PostgreSQL** en el servidor: crear base y usuario; en `.env` del servidor definir `DATABASE_URL`.
2. **`.env` en el servidor** (no se sube con rsync): copiar desde `.env.example` y completar `DATABASE_URL`, `GEMINI_API_KEY` u `OPENROUTER_API_KEY`, `PORT`, `WHATSAPP_SESSION_PATH`, etc.
3. **Tablas**: una vez con `DATABASE_URL` correcto, en el servidor: `cd /var/www/.habilispro.com && node scripts/setup-db.js`.
4. **Chromium / WhatsApp**: en Ubuntu/Debian ejecutar en la VPS `bash scripts/vps-install-chromium-deps.sh`. Si el Chrome embebido de Puppeteer sigue fallando, en `.env` poner `PUPPETEER_EXECUTABLE_PATH` apuntando al `chromium` del sistema (`command -v chromium`).
5. **Sesión WhatsApp**: no reutilizar la misma carpeta `.wwebjs_auth` en dos máquinas a la vez; en el servidor conviene `WHATSAPP_SESSION_PATH=./.wwebjs_auth_vps` y escanear el QR con `pm2 logs agrohabilis`. Si aparece error de perfil bloqueado (`SingletonLock`), borrar locks o esa carpeta y volver a vincular.
6. **Nginx**: `proxy_pass` al `PORT` donde escucha Node (ej. `3010`).
7. **Despliegue de código**: `npm run deploy:vps` o push a `main` si GitHub Actions tiene los secrets (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PORT` opcional).

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
- `HEALTH_BACKEND_PORT` (opcional): si está definido, el health del deploy pega a `http://127.0.0.1:$HEALTH_BACKEND_PORT/` en lugar de Nginx (útil si el dominio aún no apunta o el proxy no está listo)
