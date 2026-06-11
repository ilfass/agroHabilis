-- Widen VARCHAR(50) columns to VARCHAR(150) or more to avoid LLM extraction overflows
-- Specifically for inventory and traceability tables.

ALTER TABLE animales_individuales 
  ALTER COLUMN caravana TYPE VARCHAR(100),
  ALTER COLUMN categoria TYPE VARCHAR(100),
  ALTER COLUMN estado TYPE VARCHAR(100);

ALTER TABLE stock_ganadero
  ALTER COLUMN categoria TYPE VARCHAR(100);

ALTER TABLE usuario_ganaderia_perfil
  ALTER COLUMN categoria TYPE VARCHAR(100),
  ALTER COLUMN especie TYPE VARCHAR(100);

ALTER TABLE lotes
  ALTER COLUMN cultivo TYPE VARCHAR(100);

ALTER TABLE usuario_cultivos
  ALTER COLUMN cultivo TYPE VARCHAR(100);

ALTER TABLE precios
  ALTER COLUMN cultivo TYPE VARCHAR(100);
