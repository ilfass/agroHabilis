# Mercado fisico (precio hoy)

## Objetivo IA
Responder decisiones tacticas del dia: vender, esperar, fijar parcial, comparar plazas.

## Variables clave
- Disponible por plaza/puerto.
- Referencia FOB/FAS.
- Tipo de cambio usado (oficial/MEP).
- Diferencial regional (premio/descuento).
- Flete y neto en campo.

## Reglas de lectura
- Si `disponible << FAS teorico`, explicar posible brecha comercial/logistica.
- Si futuro cercano > disponible y base no deteriora fuerte, considerar cobertura parcial.
- Si clima/riesgo operativo aumenta, priorizar liquidez y escalonar.

## Salida esperada WhatsApp
1) Dato clave (precio + fecha + fuente).
2) Contexto corto (2-3 drivers).
3) Accion sugerida (porcentaje o enfoque).
4) Riesgo a vigilar.

## Errores a evitar
- Mezclar ARS y USD sin aclarar tipo de cambio.
- Omitir fecha.
- Dar causalidad absoluta sin evidencia.

