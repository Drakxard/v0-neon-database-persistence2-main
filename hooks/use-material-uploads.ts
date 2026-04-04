"use client"

import { useCallback, useState } from "react"

import { uploadSubjectDayMaterial } from "@/lib/materials-client"
import type { PendingSubjectDayMaterial, SubjectDayMaterial, SubjectDayMaterialType } from "@/lib/study-types"

type UploadParams = {
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  materialType: SubjectDayMaterialType
  files: File[]
  buildPendingMaterials: (files: File[]) => Array<{ tempId: number; pendingMaterial: PendingSubjectDayMaterial; file: File }>
  mergeMaterials: (previous: SubjectDayMaterial[], incoming: SubjectDayMaterial[]) => SubjectDayMaterial[]
  setMaterials: (updater: (previous: SubjectDayMaterial[]) => SubjectDayMaterial[]) => void
  setPendingMaterials: (updater: (previous: PendingSubjectDayMaterial[]) => PendingSubjectDayMaterial[]) => void
}

export function useMaterialUploads() {
  const [isUploadingMaterialType, setIsUploadingMaterialType] = useState<SubjectDayMaterialType | null>(null)

  const uploadMaterials = useCallback(async (params: UploadParams) => {
    const pendingUploadBatch = params.buildPendingMaterials(params.files)
    const failedUploads: string[] = []

    setIsUploadingMaterialType(params.materialType)
    params.setPendingMaterials((previous) => [
      ...previous,
      ...pendingUploadBatch.map((item) => item.pendingMaterial),
    ])

    try {
      for (const item of pendingUploadBatch) {
        try {
          const persistedMaterial = await uploadSubjectDayMaterial(
            {
              subjectId: params.subjectId,
              subjectName: params.subjectName,
              sessionDate: params.sessionDate,
              weekNumber: params.weekNumber,
              materialType: params.materialType,
            },
            item.file,
            item.file.name,
            item.file.type || "application/pdf"
          )

          params.setMaterials((previous) => params.mergeMaterials(previous, [persistedMaterial]))
        } catch (error) {
          console.error("Failed to upload subject day material:", error)
          const message = error instanceof Error ? error.message : "No se pudo subir el PDF."
          failedUploads.push(`${item.file.name}: ${message}`)
        } finally {
          params.setPendingMaterials((previous) =>
            previous.filter((material) => material.id !== item.tempId)
          )
        }
      }
    } finally {
      setIsUploadingMaterialType(null)
    }

    return failedUploads
  }, [])

  return {
    isUploadingMaterialType,
    uploadMaterials,
  }
}
