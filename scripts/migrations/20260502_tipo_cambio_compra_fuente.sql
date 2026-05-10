-- Compra (vendedor de USD) + venta (comprador de USD) por tipo; fuente opcional
ALTER TABLE tipo_cambio
  ADD COLUMN IF NOT EXISTS compra NUMERIC(10,2);

ALTER TABLE tipo_cambio
  ADD COLUMN IF NOT EXISTS fuente VARCHAR(40);
