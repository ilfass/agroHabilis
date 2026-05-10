# Configuracion global VPS multisitio

La configuracion global fue movida fuera de este repo para evitar ruido por sitio.

Ubicacion oficial:

- `/home/fabian/Documentos/vps-multisitio`

En VPS se publica en:

- `/opt/vps-multisitio`

Health check multi-sitio (todos los dominios del registro):

```bash
bash /home/fabian/Documentos/vps-multisitio/health-check.sh
```

En el VPS, con prueba por `Host` contra localhost:

```bash
CHECK_LOCAL_HTTP=1 bash /opt/vps-multisitio/health-check.sh --local-http
```
