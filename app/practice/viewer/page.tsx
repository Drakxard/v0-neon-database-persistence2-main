import Link from "next/link"
import { getLegacyDatabase } from "@/lib/db"

import { getRequestAuthSession, canAccessSubject } from "@/lib/authz"
import { isLocalStorageMode } from "@/lib/storage-mode"
import { parseDateKey } from "@/lib/subject-utils"
import { getSubjectById } from "@/lib/subjects"
import { PracticeViewerClient } from "./practice-viewer-client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const sql = getLegacyDatabase()

const SUBJECT_NAMES: Record<string, string> = {
  algebra: "Algebra 2",
  calculo2: "Calculo 2",
  calculo3: "Calculo 3",
  fisica: "Fisica 1",
  logica: "Logica y computabilidad",
  probabilidad: "Probabilidad y Estadistica",
}

type ViewerPageProps = {
  searchParams: Promise<{
    materialId?: string
    subjectId?: string
    subjectName?: string
    sessionDate?: string
    weekNumber?: string
    weekdayIndex?: string
    materialType?: string
    fileName?: string
    workspaceFileId?: string
    sourceRevision?: string
    subjectActivationDate?: string
    subjectTargetWeekday?: string
    returnToken?: string
    presentationTagIds?: string
  }>
}

type DraftViewerContext = {
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialType: "practice" | "theory"
  returnToken?: string
}

type MaterialContext = {
  id: number
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialType?: "practice" | "theory"
  fileName: string
  workspaceFileId?: string | null
  sourceRevision?: string
  subjectActivationDate?: string
  subjectTargetWeekday?: number
  returnToken?: string
}

function normalizeSessionDateKey(sessionDate: string | Date) {
  if (sessionDate instanceof Date) {
    return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`
  }

  return sessionDate.includes("T") ? sessionDate.slice(0, 10) : sessionDate
}

async function getMaterial(materialId: number) {
  if (!sql) return undefined
  const rows = await sql`
    SELECT id, subject_id, week_number, session_date, weekday_index, material_type, file_name, drive_file_id, updated_at
    FROM subject_day_materials
    WHERE id = ${materialId}
    LIMIT 1
  `

  return rows[0] as
    | {
        id: number
        subject_id: string
        week_number: number
        session_date: string
        weekday_index: number
        material_type: "practice" | "theory"
        file_name: string
        drive_file_id: string
        updated_at: string
      }
    | undefined
}

export default async function PracticeViewerPage({ searchParams }: ViewerPageProps) {
  const session = await getRequestAuthSession()
  if (!session) {
    return null
  }

  const params = await searchParams
  const materialId = Number.parseInt(params.materialId || "", 10)

  const subjectId = (params.subjectId || "").trim()
  const subjectNameParam = (params.subjectName || "").trim()
  const sessionDate = (params.sessionDate || "").trim()
  const parsedSessionDate = parseDateKey(sessionDate)
  const weekNumber = Number.parseInt(params.weekNumber || "", 10)
  const weekdayIndex = Number.parseInt(params.weekdayIndex || "", 10)
  const returnToken = (params.returnToken || "").trim()
  const fileName = (params.fileName || "").trim()
  const workspaceFileId = (params.workspaceFileId || "").trim()
  const sourceRevision = (params.sourceRevision || "").trim()
  const subjectActivationDate = (params.subjectActivationDate || "").trim()
  const subjectTargetWeekday = Number.parseInt(params.subjectTargetWeekday || "", 10)
  const presentationTagIds = Array.from(new Set(
    String(params.presentationTagIds || "")
      .split(",")
      .map((value) => Number.parseInt(value, 10))
      .filter(Number.isInteger)
  ))
  const materialType =
    params.materialType === "practice" || params.materialType === "theory"
      ? params.materialType
      : null

  const resolvedSubjectName =
    subjectNameParam ||
    getSubjectById(subjectId)?.name.replace("\n", " ") ||
    SUBJECT_NAMES[subjectId] ||
    ""

  const hasDraftContext =
    Boolean(subjectId) &&
    Boolean(resolvedSubjectName) &&
    /^\d{4}-\d{2}-\d{2}$/.test(sessionDate) &&
    !Number.isNaN(parsedSessionDate.getTime()) &&
    Number.isInteger(weekNumber) &&
    Number.isInteger(weekdayIndex) &&
    Boolean(materialType)

  if (!Number.isInteger(materialId) && hasDraftContext) {
    if (!canAccessSubject(session, subjectId)) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Visor PDF</p>
            <h1 className="mt-3 text-2xl font-semibold">Acceso restringido</h1>
            <p className="mt-3 text-sm text-slate-300">No tenes permiso para abrir esta materia.</p>
            <Link href="/" className="mt-6 inline-flex text-sm text-sky-300 underline-offset-4 hover:underline">
              Volver al inicio
            </Link>
          </div>
        </main>
      )
    }

    const draftContext: DraftViewerContext = {
      subjectId,
      subjectName: resolvedSubjectName,
      sessionDate,
      weekNumber,
      weekdayIndex,
      materialType: materialType as "practice" | "theory",
      returnToken,
    }

    return <PracticeViewerClient draftContext={draftContext} mode="standalone" />
  }

  if (!Number.isInteger(materialId)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Visor PDF</p>
          <h1 className="mt-3 text-2xl font-semibold">Material invalido</h1>
          <p className="mt-3 text-sm text-slate-300">No se recibio un material valido para abrir en el visor.</p>
          <Link href="/" className="mt-6 inline-flex text-sm text-sky-300 underline-offset-4 hover:underline">
            Volver al inicio
          </Link>
        </div>
      </main>
    )
  }

  if (isLocalStorageMode()) {
    const hasImmediateLocalMaterialContext =
      Boolean(subjectId) &&
      Boolean(resolvedSubjectName) &&
      /^\d{4}-\d{2}-\d{2}$/.test(sessionDate) &&
      !Number.isNaN(parsedSessionDate.getTime()) &&
      Number.isInteger(weekNumber) &&
      Number.isInteger(weekdayIndex) &&
      Boolean(materialType) &&
      Boolean(fileName) &&
      workspaceFileId.startsWith("workspace://")

    return (
      <PracticeViewerClient
        material={
          hasImmediateLocalMaterialContext
            ? {
                id: materialId,
                subjectId,
                subjectName: resolvedSubjectName,
                sessionDate,
                weekNumber,
                weekdayIndex,
                materialType: materialType as "practice" | "theory",
                fileName,
                workspaceFileId,
                sourceRevision: sourceRevision || `${workspaceFileId}:current`,
                subjectActivationDate,
                subjectTargetWeekday: Number.isInteger(subjectTargetWeekday) ? subjectTargetWeekday : undefined,
                returnToken,
              }
            : undefined
        }
        materialId={hasImmediateLocalMaterialContext ? undefined : materialId}
        mode="standalone"
        returnToken={returnToken}
        subjectActivationDate={subjectActivationDate}
        subjectTargetWeekday={Number.isInteger(subjectTargetWeekday) ? subjectTargetWeekday : undefined}
        presentationTagIds={presentationTagIds}
      />
    )
  }

  try {
    const material = await getMaterial(materialId)

    if (!material) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Visor PDF</p>
            <h1 className="mt-3 text-2xl font-semibold">Material no encontrado</h1>
            <p className="mt-3 text-sm text-slate-300">El archivo solicitado ya no existe o no se pudo recuperar.</p>
            <Link href="/" className="mt-6 inline-flex text-sm text-sky-300 underline-offset-4 hover:underline">
              Volver al inicio
            </Link>
          </div>
        </main>
      )
    }

    if (!canAccessSubject(session, material.subject_id)) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Visor PDF</p>
            <h1 className="mt-3 text-2xl font-semibold">Acceso restringido</h1>
            <p className="mt-3 text-sm text-slate-300">No tenes permiso para abrir este material.</p>
            <Link href="/" className="mt-6 inline-flex text-sm text-sky-300 underline-offset-4 hover:underline">
              Volver al inicio
            </Link>
          </div>
        </main>
      )
    }

    return (
      <PracticeViewerClient
        mode="standalone"
        material={{
          id: material.id,
          subjectId: material.subject_id,
          subjectName: getSubjectById(material.subject_id)?.name.replace("\n", " ") || SUBJECT_NAMES[material.subject_id] || material.subject_id,
          sessionDate: normalizeSessionDateKey(material.session_date),
          weekNumber: material.week_number,
          weekdayIndex: material.weekday_index,
          materialType: material.material_type,
          fileName: material.file_name,
          sourceRevision: `${material.drive_file_id}:${material.updated_at}`,
          subjectActivationDate,
          subjectTargetWeekday: Number.isInteger(subjectTargetWeekday) ? subjectTargetWeekday : undefined,
          returnToken,
        }}
        presentationTagIds={presentationTagIds}
      />
    )
  } catch (error) {
    console.error("GET /practice/viewer page error:", error)

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Visor PDF</p>
          <h1 className="mt-3 text-2xl font-semibold">No se pudo abrir el visor</h1>
          <p className="mt-3 text-sm text-slate-300">
            Hubo un problema al cargar el material desde la base de datos o Google Drive.
          </p>
          <Link href="/" className="mt-6 inline-flex text-sm text-sky-300 underline-offset-4 hover:underline">
            Volver al inicio
          </Link>
        </div>
      </main>
    )
  }

  return null
}
