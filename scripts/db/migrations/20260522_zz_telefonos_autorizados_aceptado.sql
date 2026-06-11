-- Migración para soportar la aceptación de invitaciones de miembros del equipo
-- Agrega la columna aceptado con valor por defecto false

ALTER TABLE telefonos_autorizados ADD COLUMN IF NOT EXISTS aceptado BOOLEAN DEFAULT false;
