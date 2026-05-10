# Checklist VPS multi-sitio (no romper otros proyectos)

Checklist operativo breve para actualizar un sitio sin afectar los demás.

## Referencia global (fuera de este repo)

La configuración global del multisitio vive en el repo **vps-multisitio**, no en AgroHabilis:

- Desarrollo local típico: `/home/fabian/Documentos/vps-multisitio`
- En VPS suele publicarse en: `/opt/vps-multisitio`

Health check de todos los dominios del registro:

```bash
bash /home/fabian/Documentos/vps-multisitio/health-check.sh
```

En el VPS, con prueba por `Host` contra localhost:

```bash
CHECK_LOCAL_HTTP=1 bash /opt/vps-multisitio/health-check.sh --local-http
```

Guía complementaria de hardening: `/home/fabian/Documentos/vps-multisitio/README.md`

## 1) Confirmar alcance antes de tocar nada

- Proyecto objetivo (nombre PM2): `agrohabilis`
- Ruta objetivo: `/var/www/agro.habilispro.com`
- Dominio objetivo: `agro.habilispro.com`
- Regla: no usar comandos globales (`restart all`, `delete all`, cambios masivos de nginx).

## 2) Snapshot pre-deploy

- Guardar estado actual:
  - `pm2 status`
  - `nginx -t`
  - `df -h` (espacio)
  - `free -h` (memoria)
- Si hay alertas de recursos, no desplegar hasta resolver.

## 3) Validación de entorno del proyecto

- Revisar `.env` del proyecto objetivo (sin copiar de otro sitio).
- Verificar que no se cambien puertos compartidos.
- Confirmar que la base de datos/usuario DB sea la esperada para ese proyecto.

## 4) Deploy aislado por ruta

- Usar script seguro:
  - `/home/fabian/Documentos/vps-multisitio/deploy-safe.sh`
- Este flujo fija:
  - ruta exacta (`/var/www/agro.habilispro.com`)
  - app exacta (`agrohabilis`)
- Si ruta/app no coinciden, debe abortar.

## 5) PM2: solo proceso objetivo

- Permitido: `pm2 restart agrohabilis --update-env`
- No permitido en servidor multi-sitio:
  - `pm2 restart all`
  - `pm2 delete all`
  - `pm2 flush` sin revisar impacto.

## 6) Nginx: cambios seguros

- Editar solo el `server` del dominio objetivo.
- Siempre validar antes de recargar:
  - `nginx -t`
- Recién después:
  - `systemctl reload nginx`

## 7) Verificación post-deploy

- Proceso objetivo:
  - `pm2 describe agrohabilis`
- Dominio objetivo:
  - `curl -I https://agro.habilispro.com/`
- Smoke test funcional (endpoint o página principal).

## 8) Verificación cruzada de otros sitios

- Confirmar que los otros procesos PM2 siguen `online`.
- Probar al menos un endpoint/página de cada sitio crítico.
- Si algún sitio falla, iniciar rollback inmediato.

## 9) Rollback rápido (mínimo)

- Volver al release/código anterior en la carpeta del proyecto afectado.
- Reinstalar dependencias si corresponde.
- Reiniciar solo ese proceso PM2.
- Revalidar health del sitio afectado y del resto.

## 10) Registro de operación

- Guardar:
  - hora de inicio/fin
  - qué se desplegó (commit/release)
  - resultado de checks pre/post
  - incidentes y acciones tomadas.

## Comandos prohibidos en multi-sitio (salvo emergencia controlada)

- `pm2 restart all`
- `pm2 delete all`
- `rm -rf /var/www/*`
- cambios globales de nginx sin `nginx -t`
- upgrades de sistema sin ventana de mantenimiento.

