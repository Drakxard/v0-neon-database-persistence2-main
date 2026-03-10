ALTER TABLE preguntas_respuestas
ADD COLUMN IF NOT EXISTS example_image_url TEXT,
ADD COLUMN IF NOT EXISTS example_link TEXT NOT NULL DEFAULT '';
