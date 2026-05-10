ALTER TABLE inventario_movimiento DROP CONSTRAINT IF EXISTS ck_inventario_mov_dom;

ALTER TABLE inventario_movimiento
  ADD CONSTRAINT ck_inventario_mov_dom CHECK (dominio IN ('ganado', 'cultivo', 'insumo', 'grano'));

ALTER TABLE inventario_saldo DROP CONSTRAINT IF EXISTS ck_inventario_saldo_dom;

ALTER TABLE inventario_saldo
  ADD CONSTRAINT ck_inventario_saldo_dom CHECK (dominio IN ('ganado', 'cultivo', 'insumo', 'grano'));
