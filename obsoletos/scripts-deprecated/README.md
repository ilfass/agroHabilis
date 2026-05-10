# Scripts obsoletos

Scripts que **no** están cableados en `package.json` y se mantienen solo por referencia (carpeta `obsoletos/scripts-deprecated/`).

| Archivo | Notas |
|---------|--------|
| `test-respuestas.js` | Prueba manual de frases contra `procesarConsulta` / intents; preferí `npm run qa:whatsapp` para regresiones estructuradas. |

Para ejecutar uno deprecado desde la raíz del repo:

```bash
node obsoletos/scripts-deprecated/test-respuestas.js
```

Los `require()` suben dos niveles (`../../`) hasta la raíz del repo y cargan `src/`.
