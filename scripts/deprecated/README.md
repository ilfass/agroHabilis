# Deprecated

Scripts que **no** están cableados en `package.json` y se mantienen solo por referencia o migraciones puntuales.

| Archivo | Notas |
|---------|--------|
| `test-respuestas.js` | Prueba manual de frases contra `procesarConsulta` / intents; preferí `npm run qa:whatsapp` para regresiones estructuradas. |

Para ejecutar uno deprecado desde la raíz del repo:

```bash
node scripts/deprecated/test-respuestas.js
```

Los `require()` apuntan a `src/` con rutas relativas a esta carpeta.
