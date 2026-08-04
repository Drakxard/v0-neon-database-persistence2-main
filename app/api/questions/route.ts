import { getLegacyDatabase } from "@/lib/db"
import { requireSql } from "@/lib/db"
import { del } from "@vercel/blob"
import { NextResponse } from "next/server"
import { ensureQuestionSubjectAccess, requireAuthSession } from "@/lib/authz"

const sql = getLegacyDatabase()

async function deleteStoredExampleImage(imageUrl: string | null | undefined) {
  if (!imageUrl) return

  try {
    await del(imageUrl)
  } catch {
    // Ignore cleanup failures to avoid blocking deletes.
  }
}

function toInt(value: string | null) {
  if (value === null) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

// GET - fetch questions, optionally filtered by id_materia and/or semana
export async function GET(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const idMateria = toInt(searchParams.get("id_materia"))
    const semana = toInt(searchParams.get("semana"))
    const id = toInt(searchParams.get("id"))

    if (id !== null) {
      const [question] = await requireSql(sql)`SELECT * FROM preguntas_respuestas WHERE id = ${id}`
      if (!question) return NextResponse.json(null)
      const forbidden = ensureQuestionSubjectAccess(auth.session!, Number(question.id_materia))
      if (forbidden) return forbidden
      return NextResponse.json(question)
    }

    if (idMateria !== null) {
      const forbidden = ensureQuestionSubjectAccess(auth.session!, idMateria)
      if (forbidden) return forbidden
    }

    if (idMateria !== null && semana !== null) {
      const rows = await requireSql(sql)`
        SELECT * FROM preguntas_respuestas 
        WHERE id_materia = ${idMateria} AND semana = ${semana}
        ORDER BY created_at DESC
      `
      return NextResponse.json(rows)
    }

    if (idMateria !== null) {
      const rows = await requireSql(sql)`
        SELECT * FROM preguntas_respuestas 
        WHERE id_materia = ${idMateria}
        ORDER BY created_at DESC
      `
      return NextResponse.json(rows)
    }

    // Return all questions
    const rows = await requireSql(sql)`SELECT * FROM preguntas_respuestas ORDER BY created_at DESC`
    const visibleRows = rows.filter((row) => !ensureQuestionSubjectAccess(auth.session!, Number(row.id_materia)))
    return NextResponse.json(visibleRows)
  } catch (error) {
    console.error("Failed to fetch questions:", error)
    return NextResponse.json({ error: "Failed to fetch questions" }, { status: 500 })
  }
}

// POST - create a new question
export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const body = await request.json()
    const { pregunta, respuesta, id_materia, semana, items, example_image_url, example_link } = body

    if (id_materia === undefined || semana === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const forbidden = ensureQuestionSubjectAccess(auth.session!, Number(id_materia))
    if (forbidden) return forbidden

    const normalizedItems: { pregunta: string; respuesta: string; example_image_url?: string | null; example_link?: string }[] = Array.isArray(items)
      ? items
          .map((item) => ({
            pregunta: String(item?.pregunta || "").trim(),
            respuesta: String(item?.respuesta || "").trim(),
            example_image_url: item?.example_image_url ? String(item.example_image_url) : null,
            example_link: String(item?.example_link || "").trim(),
          }))
          .filter((item) => item.pregunta.length > 0)
      : [{
          pregunta: String(pregunta || "").trim(),
          respuesta: String(respuesta || "").trim(),
          example_image_url: example_image_url ? String(example_image_url) : null,
          example_link: String(example_link || "").trim(),
        }].filter(
          (item) => item.pregunta.length > 0
        )

    if (normalizedItems.length === 0) {
      return NextResponse.json({ error: "Missing question content" }, { status: 400 })
    }

    if (normalizedItems.length === 1) {
      const item = normalizedItems[0]
      const rows = await requireSql(sql)`
        INSERT INTO preguntas_respuestas (pregunta, respuesta, estado, id_materia, semana, example_image_url, example_link)
        VALUES (${item.pregunta}, ${item.respuesta}, 'bien', ${id_materia}, ${semana}, ${item.example_image_url ?? null}, ${item.example_link})
        RETURNING *
      `
      return NextResponse.json(rows[0])
    }

    const inserted = []
    for (const item of normalizedItems) {
      const rows = await requireSql(sql)`
        INSERT INTO preguntas_respuestas (pregunta, respuesta, estado, id_materia, semana, example_image_url, example_link)
        VALUES (${item.pregunta}, ${item.respuesta}, 'bien', ${id_materia}, ${semana}, ${item.example_image_url ?? null}, ${item.example_link})
        RETURNING *
      `
      inserted.push(rows[0])
    }

    return NextResponse.json(inserted)
  } catch (error) {
    console.error("Failed to create question:", error)
    return NextResponse.json({ error: "Failed to create question" }, { status: 500 })
  }
}

// PUT - update a question (including estado for practice mode)
export async function PUT(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { id, pregunta, respuesta, estado, id_materia, semana, example_image_url, example_link } = await request.json()

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 })
    }

    const [existingQuestion] = await requireSql(sql)`SELECT id_materia FROM preguntas_respuestas WHERE id = ${id}`
    if (!existingQuestion) {
      return NextResponse.json(null)
    }

    const forbidden = ensureQuestionSubjectAccess(auth.session!, Number(id_materia ?? existingQuestion.id_materia))
    if (forbidden) return forbidden

    // Build dynamic update
    const rows = await requireSql(sql)`
      UPDATE preguntas_respuestas 
      SET 
        pregunta = COALESCE(${pregunta}, pregunta),
        respuesta = COALESCE(${respuesta}, respuesta),
        estado = COALESCE(${estado}, estado),
        id_materia = COALESCE(${id_materia}, id_materia),
        semana = COALESCE(${semana}, semana),
        example_image_url = COALESCE(${example_image_url}, example_image_url),
        example_link = COALESCE(${example_link}, example_link),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `
    return NextResponse.json(rows[0] || null)
  } catch (error) {
    console.error("Failed to update question:", error)
    return NextResponse.json({ error: "Failed to update question" }, { status: 500 })
  }
}

// DELETE - delete a question
export async function DELETE(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 })
    }

    const parsedId = toInt(id)
    if (parsedId === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 })
    }

    const existing = await requireSql(sql)`SELECT example_image_url, id_materia FROM preguntas_respuestas WHERE id = ${parsedId}`
    if (!existing[0]) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 })
    }
    const forbidden = ensureQuestionSubjectAccess(auth.session!, Number(existing[0]?.id_materia))
    if (forbidden) return forbidden
    await deleteStoredExampleImage(existing[0]?.example_image_url)
    await requireSql(sql)`DELETE FROM preguntas_respuestas WHERE id = ${parsedId}`
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete question:", error)
    return NextResponse.json({ error: "Failed to delete question" }, { status: 500 })
  }
}
