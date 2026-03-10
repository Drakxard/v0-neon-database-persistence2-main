-- Create preguntas_respuestas table for flashcard-style Q&A
CREATE TABLE IF NOT EXISTS preguntas_respuestas (
  id SERIAL PRIMARY KEY,
  pregunta TEXT NOT NULL,
  respuesta TEXT NOT NULL,
  estado VARCHAR(10) NOT NULL DEFAULT 'bien' CHECK (estado IN ('bien', 'erre')),
  id_materia INTEGER NOT NULL CHECK (id_materia >= 0 AND id_materia <= 5),
  semana INTEGER NOT NULL DEFAULT 0,
  example_image_url TEXT,
  example_link TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_preguntas_id_materia ON preguntas_respuestas(id_materia);
CREATE INDEX IF NOT EXISTS idx_preguntas_semana ON preguntas_respuestas(semana);
CREATE INDEX IF NOT EXISTS idx_preguntas_estado ON preguntas_respuestas(estado);
