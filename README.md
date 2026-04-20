# AgroHabilis

AgroHabilis es una plataforma Node.js pensada para centralizar informacion agropecuaria (precios, clima, resumenes y mensajeria) y habilitar automatizaciones sobre datos productivos.

## Stack tecnologico

- Node.js + Express para API y servicios backend.
- PostgreSQL (`pg`) para persistencia.
- `node-cron` para jobs programados.
- `axios` + `cheerio` para integraciones y scraping.
- `dotenv` para configuracion por entorno.
- `@anthropic-ai/sdk` para resumenes con IA.
- `mercadopago` para suscripciones/pagos.
- `bcryptjs` + `jsonwebtoken` para autenticacion.
- `cors` para acceso desde frontend.
- `winston` para logging.

## Comandos basicos

- `npm start`: inicia la API (`src/index.js`).
- `npm run dev`: inicia la API en modo watch.
- `node scripts/setup-db.js`: crea/verifica las tablas en PostgreSQL.

## Configuracion inicial

1. Copiar `.env.example` a `.env`.
2. Completar credenciales y variables requeridas.
3. Ejecutar `node scripts/setup-db.js` para inicializar base de datos.
4. Levantar el servidor con `npm start`.
