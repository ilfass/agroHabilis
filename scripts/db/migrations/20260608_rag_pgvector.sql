-- Migration: RAG pgvector tables and HNSW index.
CREATE EXTENSION IF NOT EXISTS vector;

DROP TABLE IF EXISTS rag_documentos CASCADE;

CREATE TABLE IF NOT EXISTS rag_documentos (
  id BIGSERIAL PRIMARY KEY,
  titulo VARCHAR(255) NOT NULL,
  fuente VARCHAR(100) NOT NULL, -- 'manual_sanidad', 'agroquimicos_senasa', 'calendario_inta'
  contenido TEXT NOT NULL,
  embedding vector(768),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_documentos_embedding 
  ON rag_documentos USING hnsw (embedding vector_cosine_ops);
