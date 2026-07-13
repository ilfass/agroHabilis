-- Add assigned_telefono_id to eventos_calendario
ALTER TABLE eventos_calendario ADD COLUMN assigned_telefono_id INTEGER REFERENCES telefonos_autorizados(id) ON DELETE SET NULL;
