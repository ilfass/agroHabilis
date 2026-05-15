-- Ampliación masiva de columnas VARCHAR(50) a VARCHAR(150) para evitar errores de truncamiento por IA o parsers legacy.

ALTER TABLE usuarios ALTER COLUMN provincia TYPE VARCHAR(150);
ALTER TABLE usuarios ALTER COLUMN partido TYPE VARCHAR(150);

ALTER TABLE ventas ALTER COLUMN producto TYPE VARCHAR(150);

ALTER TABLE precios_insumos ALTER COLUMN categoria TYPE VARCHAR(150);

ALTER TABLE precios_hacienda ALTER COLUMN categoria TYPE VARCHAR(150);

ALTER TABLE futuros_posiciones ALTER COLUMN cultivo TYPE VARCHAR(150);

ALTER TABLE fuentes_estado ALTER COLUMN fuente_id TYPE VARCHAR(150);

ALTER TABLE noticias_agro ALTER COLUMN categoria TYPE VARCHAR(150);

ALTER TABLE validaciones_precios ALTER COLUMN cultivo TYPE VARCHAR(150);

ALTER TABLE mercado_snapshot_items ALTER COLUMN categoria TYPE VARCHAR(150);
ALTER TABLE mercado_snapshot_items ALTER COLUMN subcategoria TYPE VARCHAR(150);
ALTER TABLE mercado_snapshot_items ALTER COLUMN region TYPE VARCHAR(150);

ALTER TABLE fletes_referencia ALTER COLUMN origen_provincia TYPE VARCHAR(150);
ALTER TABLE fletes_referencia ALTER COLUMN origen_region TYPE VARCHAR(150);

ALTER TABLE conversacion_estado ALTER COLUMN flujo TYPE VARCHAR(150);
ALTER TABLE conversacion_estado ALTER COLUMN paso TYPE VARCHAR(150);

-- Aprovechamos para ampliar los de animales_individuales a 150 también (estaban en 100).
ALTER TABLE animales_individuales ALTER COLUMN categoria TYPE VARCHAR(150);
ALTER TABLE animales_individuales ALTER COLUMN estado TYPE VARCHAR(150);
ALTER TABLE animales_individuales ALTER COLUMN observaciones TYPE VARCHAR(250); -- observaciones mejor un poco más.
