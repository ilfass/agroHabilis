# Capacidades del Sistema (App / Bot AgroHabilis)

Esta información es para responder al usuario cuando pregunta sobre las capacidades de la plataforma, como "¿puedo hacer X?", "¿el bot permite Y?", o consultas meta-conversacionales sobre el inventario.

## Carga múltiple o en lote
- **SÍ, se pueden cargar varios lotes, gastos o ventas a la vez.**
- El usuario puede enviar múltiples movimientos en un solo mensaje, detallando uno por línea o separándolos claramente.
- **Ejemplo sugerido para el usuario:** "Mandame todo junto, por ejemplo: Lote Norte: 45 novillos, Lote Sur: 30 vacas. Y te registro todo."

## Seguimiento individual de animales (caravanas, sanidad específica)
- **NO de forma nativa.** El registro actual en la base de datos es por *categoría* (ej: novillos, vacas, terneros) y por *lote/ubicación*, pero no a nivel individual (caravana, número de animal, chip).
- **Workaround (solución alternativa):** Si el productor necesita registrar un animal con un estado particular (enfermo, vacunado, muerto), puede hacerlo creando una entrada separada con esa descripción en el lote.
- **Ejemplo sugerido para el usuario:** "El registro es por categoría y lote, no por caravana individual. Pero si necesitás aislar a uno, podés decirme '1 novillo enfermo en lote norte' o '2 vacas vacunadas' y lo anoto por separado."

## Capacidades de stock e inventario
- AgroHabilis permite llevar stock de granos (toneladas en silo, acopio) y stock ganadero (cabezas por lote, pariciones, destetes, muertes).
- También puede registrar aplicaciones de insumos, labores, precipitaciones (lluvias), siembra y cosecha por lote.
