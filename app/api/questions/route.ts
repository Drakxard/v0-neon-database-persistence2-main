import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

const sql = neon(process.env.DATABASE_URL!)

function toInt(value: string | null) {
  if (value === null) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

// GET - fetch questions, optionally filtered by id_materia and/or semana
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const idMateria = toInt(searchParams.get("id_materia"))
    const semana = toInt(searchParams.get("semana"))
    const id = toInt(searchParams.get("id"))

    if (id !== null) {
      const rows = await sql`SELECT * FROM preguntas_respuestas WHERE id = ${id}`
      return NextResponse.json(rows[0] || null)
    }

    if (idMateria !== null && semana !== null) {
      const rows = await sql`
        SELECT * FROM preguntas_respuestas 
        WHERE id_materia = ${idMateria} AND semana = ${semana}
        ORDER BY created_at DESC
      `
      return NextResponse.json(rows)
    }

    if (idMateria !== null) {
      const rows = await sql`
        SELECT * FROM preguntas_respuestas 
        WHERE id_materia = ${idMateria}
        ORDER BY created_at DESC
      `
      return NextResponse.json(rows)
    }

    // Return all questions
    const rows = await sql`SELECT * FROM preguntas_respuestas ORDER BY created_at DESC`
    return NextResponse.json(rows)
  } catch (error) {
    console.error("Failed to fetch questions:", error)
    return NextResponse.json({ error: "Failed to fetch questions" }, { status: 500 })
  }
}

// POST - create a new question
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { pregunta, respuesta, id_materia, semana, items } = body

    if (id_materia === undefined || semana === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const normalizedItems: { pregunta: string; respuesta: string }[] = Array.isArray(items)
      ? items
          .map((item) => ({
            pregunta: String(item?.pregunta || "").trim(),
            respuesta: String(item?.respuesta || "").trim(),
          }))
          .filter((item) => item.pregunta.length > 0)
      : [{ pregunta: String(pregunta || "").trim(), respuesta: String(respuesta || "").trim() }].filter(
          (item) => item.pregunta.length > 0
        )

    if (normalizedItems.length === 0) {
      return NextResponse.json({ error: "Missing question content" }, { status: 400 })
    }

    if (normalizedItems.length === 1) {
      const item = normalizedItems[0]
      const rows = await sql`
        INSERT INTO preguntas_respuestas (pregunta, respuesta, estado, id_materia, semana)
        VALUES (${item.pregunta}, ${item.respuesta}, 'bien', ${id_materia}, ${semana})
        RETURNING *
      `
      return NextResponse.json(rows[0])
    }

    const inserted = []
    for (const item of normalizedItems) {
      const rows = await sql`
        INSERT INTO preguntas_respuestas (pregunta, respuesta, estado, id_materia, semana)
        VALUES (${item.pregunta}, ${item.respuesta}, 'bien', ${id_materia}, ${semana})
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
    const { id, pregunta, respuesta, estado, id_materia, semana } = await request.json()

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 })
    }

    // Build dynamic update
    const rows = await sql`
      UPDATE preguntas_respuestas 
      SET 
        pregunta = COALESCE(${pregunta}, pregunta),
        respuesta = COALESCE(${respuesta}, respuesta),
        estado = COALESCE(${estado}, estado),
        id_materia = COALESCE(${id_materia}, id_materia),
        semana = COALESCE(${semana}, semana),
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
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 })
    }

    const parsedId = toInt(id)
    if (parsedId === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 })
    }

    await sql`DELETE FROM preguntas_respuestas WHERE id = ${parsedId}`
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete question:", error)
    return NextResponse.json({ error: "Failed to delete question" }, { status: 500 })
  }
}
