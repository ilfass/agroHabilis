# Comandos de chat (WhatsApp) - AgroHabilis

Este documento resume los comandos que hoy reconoce el bot en WhatsApp.

## Notas importantes

- Los comandos se interpretan en mayúsculas/minúsculas indistintamente.
- Se ignoran tildes para el reconocimiento de comandos (por ejemplo `GASTÉ` y `GASTE` funcionan igual).
- Además de estos comandos, el usuario puede hacer consultas libres en lenguaje natural.

## 1) Comandos de perfil y onboarding

- `COMPLETAR PERFIL`
  - Abre un flujo guiado para completar información adicional.
  - Opciones del menú:
    - `1` Hectáreas y costos.
    - `2` Lotes en distintas zonas.
    - `3` Datos de hacienda.
    - `4` Comercialización (disponible o futuros).

## 2) Comandos de plan

- `MI PLAN`
  - Muestra el plan actual del usuario.
- `QUIERO PLAN GRATIS`
- `QUIERO PLAN BASICO`
- `QUIERO PLAN PRO`
  - Cambia el plan del usuario.

## 3) Comandos de alertas

- `MIS ALERTAS`
  - Lista alertas activas del usuario.
- `ALERTA <detalle>`
- `AVISAME <detalle>`
  - Crea una alerta nueva.
  - Ejemplos:
    - `ALERTA soja 450000`
    - `AVISAME cuando el dólar blue supere 1300`
- `CANCELAR ALERTA <id>`
  - Desactiva una alerta existente por ID.
  - Ejemplo: `CANCELAR ALERTA 12`

## 4) Comandos financieros (Plan Pro)

- Registro de gastos:
  - `GASTE <detalle>`
  - `GASTÉ <detalle>`
  - `COMPRE <detalle>`
  - `COMPRÉ <detalle>`
  - Ejemplo: `GASTÉ 250000 en semilla`
- Registro de ventas:
  - `VENDI <detalle>`
  - `VENDÍ <detalle>`
  - Ejemplo: `VENDÍ 100 toneladas de soja a 430000`
- Resúmenes financieros:
  - `MIS GASTOS`
  - `MIS VENTAS`
  - `MI MARGEN`

## 5) Comandos de control del bot (por chat)

- `PAUSAR BOT`
  - Pausa respuestas automáticas en ese chat.
- `ACTIVAR BOT`
  - Reactiva respuestas automáticas en ese chat.
- `ESTADO BOT`
  - Informa si el bot está activo o pausado en ese chat.

## 6) Comando de resumen manual

- `MI RESUMEN`
  - Envía el resumen del usuario por demanda.

## 7) Comandos de administración (solo números admin)

- `ESTADO`
- `ESTADO SISTEMA`
  - Estado general de WhatsApp, IA, DB y actividad.
- `ESTADO IA`
  - Orden/configuración de proveedores IA.
- `ESTADO DB`
  - Estado de base de datos y última actualización.
- `USUARIOS`
  - Totales de usuarios y últimos registros.

## 8) Consultas libres (sin comando fijo)

También se pueden hacer preguntas directas, por ejemplo:

- `Precios de hoy`
- `¿Cómo está el dólar?`
- `¿Qué tiempo hace esta semana?`
- `¿Me conviene vender soja hoy o esperar?`
- `¿Cómo está la hacienda?`

## 9) Comandos de análisis de venta

- `ANALIZAR SOJA`
- `ANALIZAR MAIZ`
- `ANALIZAR TRIGO`
  - Ejecuta análisis de conveniencia de venta con margen estimado, mercado y contexto.
- También se activa por intención libre:
  - `¿Me conviene vender soja hoy o esperar?`
  - `¿Cuál es mi margen en maíz?`

## 10) Comando de cálculo guiado de costos

- `CALCULAR COSTO`
  - Inicia flujo corto para estimar costo por hectárea y guardarlo en perfil.

