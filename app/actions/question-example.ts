"use server"

import { neon } from "@neondatabase/serverless"
import { requireSql } from "@/lib/db"
import { del, put } from "@vercel/blob"
import { revalidatePath } from "next/cache"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

type SaveQuestionExampleResult =
  | {
      ok: true
      question: {
        id: number
        example_image_url: string | null
        example_link: string
      }
    }
  | {
      ok: false
      error: string
    }

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-")
}

export async function saveQuestionExampleAction(formData: FormData): Promise<SaveQuestionExampleResult> {
  const questionId = Number.parseInt(String(formData.get("questionId") || ""), 10)
  const exampleLink = String(formData.get("exampleLink") || "").trim()
  const fileEntry = formData.get("image")

  if (!Number.isInteger(questionId)) {
    return { ok: false, error: "Pregunta invalida." }
  }

  const rows = await requireSql(sql)`
    SELECT id, example_image_url, example_link
    FROM preguntas_respuestas
    WHERE id = ${questionId}
  `
  const currentQuestion = rows[0]

  if (!currentQuestion) {
    return { ok: false, error: "La pregunta no existe." }
  }

  if (!(fileEntry instanceof File) && !exampleLink && !currentQuestion.example_image_url) {
    return { ok: false, error: "Subi una imagen o agrega un link." }
  }

  let nextImageUrl = currentQuestion.example_image_url as string | null

  if (fileEntry instanceof File && fileEntry.size > 0) {
    if (!fileEntry.type.startsWith("image/")) {
      return { ok: false, error: "Solo se permiten imagenes." }
    }

    const blob = await put(
      `question-examples/${questionId}/${Date.now()}-${sanitizeFileName(fileEntry.name || "example")}`,
      fileEntry,
      {
        access: "public",
        addRandomSuffix: true,
      }
    )

    if (currentQuestion.example_image_url) {
      try {
        await del(currentQuestion.example_image_url)
      } catch {
        // Ignore previous blob cleanup failures.
      }
    }

    nextImageUrl = blob.url
  }

  const updatedRows = await requireSql(sql)`
    UPDATE preguntas_respuestas
    SET
      example_image_url = ${nextImageUrl},
      example_link = ${exampleLink},
      updated_at = NOW()
    WHERE id = ${questionId}
    RETURNING id, example_image_url, example_link
  ` as Array<{ id: number; example_image_url: string | null; example_link: string }>

  revalidatePath("/")

  return {
    ok: true,
    question: updatedRows[0],
  }
}
