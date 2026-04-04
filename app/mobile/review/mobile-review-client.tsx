"use client"

import { useCallback, useEffect, useRef, useState, type RefObject } from "react"

import { SUBJECTS } from "@/lib/subjects"

type MobileReviewPair = {
  pairId: string
  subjectId: string
  subjectName: string
  weekNumber: number
  sessionDate: string
  questionEntryId: number
  questionAudioUrl: string
  questionLabel: string
  answerEntryId: number
  answerAudioUrl: string
  answerLabel: string
}

type MobileReviewTaskKind = "material_pair" | "subject_anchor" | "coverage_gap"

type MobileReviewTask = {
  kind: MobileReviewTaskKind
  subjectId: string
  subjectName: string
  weekNumber: number
  vectorDay: number | null
  instruction: string
  staleReason: string[]
  lastInteractionAt: string | null
  coverageSnapshot: {
    relevantPracticeMaterialIds: number[]
    coveredPracticeMaterialIds: number[]
    totalPracticeMaterialIds: number[]
  }
  material: {
    id: number
    fileName: string
    sessionDate: string
    status: "sin_tocar" | "tocado_sin_dupla" | "cubierto_minimo"
    isCheckupDone: boolean
  } | null
  pair: MobileReviewPair | null
  fallbackPair: MobileReviewPair | null
}

type MobileReviewStatus = {
  deviceId: string
  activeSlot: {
    weekdayIndex: number
    startTime: string
    endTime: string
    subjectId: string
    subjectName: string
  } | null
  subjectId: string | null
  subjectName: string | null
  weekNumber: number
  hasCurrentPair: boolean
  currentPairId: string | null
}

type MobileReviewPayload = {
  task: MobileReviewTask | null
  status: MobileReviewStatus
  currentIndex: number
  totalPairs: number
  debugReason?: "no_active_slot" | "no_valid_pairs" | "stored_pair_not_found"
}

type MobileReviewSlot = {
  id: number
  subjectId: string
  subjectName: string
  weekdayIndex: number
  startTime: string
  endTime: string
  enabled: boolean
  priority: number
}

type SlotFormState = {
  id: number | null
  subjectId: string
  weekdayIndex: string
  startTime: string
  endTime: string
  enabled: boolean
  priority: string
}

type Props = {
  deviceId: string
  signature: string
  initialPayload: MobileReviewPayload | null
  initialError: string
  requiresAccess?: boolean
}

const WEEKDAY_OPTIONS = [
  { value: "0", label: "Lunes" },
  { value: "1", label: "Martes" },
  { value: "2", label: "Miercoles" },
  { value: "3", label: "Jueves" },
  { value: "4", label: "Viernes" },
  { value: "5", label: "Sabado" },
  { value: "6", label: "Domingo" },
]

function createEmptySlotForm(): SlotFormState {
  return {
    id: null,
    subjectId: SUBJECTS[0]?.id || "",
    weekdayIndex: "0",
    startTime: "09:00",
    endTime: "10:00",
    enabled: true,
    priority: "10",
  }
}

function mapSlotToForm(slot: MobileReviewSlot): SlotFormState {
  return {
    id: slot.id,
    subjectId: slot.subjectId,
    weekdayIndex: String(slot.weekdayIndex),
    startTime: slot.startTime,
    endTime: slot.endTime,
    enabled: slot.enabled,
    priority: String(slot.priority),
  }
}

function formatSlotLabel(slot: MobileReviewSlot) {
  const weekday = WEEKDAY_OPTIONS.find((option) => option.value === String(slot.weekdayIndex))?.label || "Dia"
  return `${weekday} ${slot.startTime}-${slot.endTime}`
}

function AudioRow({
  label,
  audioRef,
  src,
}: {
  label: string
  audioRef: RefObject<HTMLAudioElement | null>
  src: string
}) {
  return (
    <section className="space-y-2">
      <p className="text-[1.9rem] leading-none text-black">{label}</p>
      <audio
        ref={audioRef}
        src={src}
        preload="auto"
        controls
        className="block w-full rounded-md border border-black/40 bg-[#f7ecc0]"
      />
    </section>
  )
}

function SlotRow({
  slot,
  onEdit,
  onToggle,
  onDelete,
  busy,
}: {
  slot: MobileReviewSlot
  onEdit: (slot: MobileReviewSlot) => void
  onToggle: (slot: MobileReviewSlot) => void
  onDelete: (slot: MobileReviewSlot) => void
  busy: boolean
}) {
  return (
    <div className="space-y-2 border-2 border-black/80 bg-[#f7ecc0] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold leading-tight">{slot.subjectName}</p>
          <p className="text-sm leading-tight">{formatSlotLabel(slot)}</p>
          <p className="text-xs leading-tight">Prioridad {slot.priority}</p>
        </div>
        <span className="text-xs uppercase">{slot.enabled ? "Activa" : "Pausada"}</span>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <button type="button" onClick={() => onEdit(slot)} className="border border-black px-2 py-1" disabled={busy}>
          Editar
        </button>
        <button type="button" onClick={() => onToggle(slot)} className="border border-black px-2 py-1" disabled={busy}>
          {slot.enabled ? "Desactivar" : "Activar"}
        </button>
        <button type="button" onClick={() => onDelete(slot)} className="border border-black px-2 py-1" disabled={busy}>
          Eliminar
        </button>
      </div>
    </div>
  )
}

export function MobileReviewClient({ deviceId, signature, initialPayload, initialError, requiresAccess = false }: Props) {
  const [payload, setPayload] = useState<MobileReviewPayload | null>(initialPayload)
  const [error, setError] = useState(initialError)
  const [accessError, setAccessError] = useState("")
  const [accessDeviceId, setAccessDeviceId] = useState("")
  const [viewportHeight, setViewportHeight] = useState<number | null>(null)
  const [isAccessLoading, setIsAccessLoading] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false)
  const [isSlotsLoading, setIsSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState("")
  const [slots, setSlots] = useState<MobileReviewSlot[]>([])
  const [slotForm, setSlotForm] = useState<SlotFormState>(createEmptySlotForm)
  const [isSavingSlot, setIsSavingSlot] = useState(false)
  const [scheduleDayIndex, setScheduleDayIndex] = useState(0)
  const [isAnswerVisible, setIsAnswerVisible] = useState(false)
  const [isEventLoading, setIsEventLoading] = useState(false)
  const questionAudioRef = useRef<HTMLAudioElement | null>(null)
  const answerAudioRef = useRef<HTMLAudioElement | null>(null)
  const shownTaskKeyRef = useRef("")
  const revealedTaskKeyRef = useRef("")
  const ratedTaskKeyRef = useRef("")

  const activeTask = payload?.task ?? null
  const activePair = activeTask?.pair ?? null
  const subjectTitle = activeTask?.subjectName || payload?.status.subjectName || "Sin materia"
  const pairCounter = `${payload?.currentIndex ?? 0}/${payload?.totalPairs ?? 0}`
  const activeTaskKey = activeTask
    ? `${activeTask.kind}:${activeTask.subjectId}:${activeTask.material?.id ?? "none"}:${activeTask.pair?.pairId ?? "none"}:${activeTask.vectorDay ?? 0}`
    : ""
  const emptyStateMessage =
    payload?.debugReason === "no_active_slot"
      ? "No hay una materia activa en este momento."
      : activeTask?.instruction || "No hay materias activas para esta semana."
  const noPairMessage = activeTask
    ? activeTask.kind === "coverage_gap"
      ? "No hay dupla/audio disponible para esta materia todavia."
      : "No hay dupla/audio reproducible para esta materia."
    : emptyStateMessage

  useEffect(() => {
    if (!requiresAccess) return
    try {
      const rememberedDeviceId = window.localStorage.getItem("mobile-review-device-id") || ""
      if (rememberedDeviceId) {
        setAccessDeviceId(rememberedDeviceId)
        void submitAccess(rememberedDeviceId, true)
      }
    } catch {
      // Ignore localStorage access issues in constrained webviews.
    }
  }, [requiresAccess])

  const postInteractionEvent = useCallback(
    async (params: {
      task: MobileReviewTask
      eventType: "shown" | "revealed" | "rated" | "skipped"
      rating?: "ok" | "doubt" | "fail" | null
    }) => {
      const { task, eventType, rating = null } = params
      await fetch("/api/mobile/review/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: deviceId,
          sig: signature,
          subjectId: task.subjectId,
          weekNumber: task.weekNumber,
          materialId: task.material?.id ?? null,
          pairId: task.pair?.pairId ?? null,
          taskKind: task.kind,
          eventType,
          rating,
        }),
      }).catch(() => {})
    },
    [deviceId, signature]
  )

  useEffect(() => {
    if (!activePair) return
    const questionAudio = questionAudioRef.current
    if (!questionAudio) return
    questionAudio.currentTime = 0
    void questionAudio.play().catch(() => {})
  }, [activePair?.pairId])

  useEffect(() => {
    setIsAnswerVisible(false)
    revealedTaskKeyRef.current = ""
    ratedTaskKeyRef.current = ""

    if (!activeTask || !activeTaskKey || shownTaskKeyRef.current === activeTaskKey) return
    shownTaskKeyRef.current = activeTaskKey
    void postInteractionEvent({ task: activeTask, eventType: "shown" })
  }, [activeTask, activeTaskKey, postInteractionEvent])

  useEffect(() => {
    if (typeof window === "undefined") return

    const root = document.documentElement
    const body = document.body
    const previousRootBackground = root.style.backgroundColor
    const previousBodyBackground = body.style.backgroundColor

    const applyViewportHeight = () => {
      const nextHeight = Math.round(
        window.visualViewport?.height ??
          window.innerHeight ??
          root.clientHeight ??
          body.clientHeight
      )
      setViewportHeight(nextHeight)
    }

    root.style.backgroundColor = "#f1e4a9"
    body.style.backgroundColor = "#f1e4a9"

    applyViewportHeight()
    window.addEventListener("resize", applyViewportHeight)
    window.addEventListener("orientationchange", applyViewportHeight)
    window.visualViewport?.addEventListener("resize", applyViewportHeight)

    return () => {
      root.style.backgroundColor = previousRootBackground
      body.style.backgroundColor = previousBodyBackground
      window.removeEventListener("resize", applyViewportHeight)
      window.removeEventListener("orientationchange", applyViewportHeight)
      window.visualViewport?.removeEventListener("resize", applyViewportHeight)
    }
  }, [])

  const refreshCurrent = async () => {
    const response = await fetch(`/api/mobile/review/current?device=${encodeURIComponent(deviceId)}&sig=${encodeURIComponent(signature)}`)
    const nextPayload = (await response.json()) as MobileReviewPayload & { error?: string }
    if (!response.ok) {
      throw new Error(nextPayload.error || "No se pudo actualizar el repaso.")
    }
    setPayload(nextPayload)
  }

  const submitAccess = async (deviceValue?: string, silent = false) => {
    const nextDeviceId = String(deviceValue ?? accessDeviceId).trim()
    if (!nextDeviceId) {
      if (!silent) setAccessError("Ingresa un nombre de dispositivo.")
      return
    }

    setIsAccessLoading(true)
    if (!silent) setAccessError("")
    try {
      const response = await fetch("/api/mobile/review/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: nextDeviceId }),
      })
      const result = (await response.json()) as { url?: string; deviceId?: string; error?: string }
      if (!response.ok || !result.url || !result.deviceId) {
        throw new Error(result.error || "No se pudo abrir el repaso movil.")
      }

      try {
        window.localStorage.setItem("mobile-review-device-id", result.deviceId)
      } catch {
        // Ignore localStorage access issues in constrained webviews.
      }

      window.location.assign(result.url)
    } catch (accessLoadError) {
      setAccessError(accessLoadError instanceof Error ? accessLoadError.message : "No se pudo abrir el repaso movil.")
    } finally {
      setIsAccessLoading(false)
    }
  }

  const loadSlots = async () => {
    setIsSlotsLoading(true)
    setSlotsError("")
    try {
      const response = await fetch(`/api/mobile/review/slots?device=${encodeURIComponent(deviceId)}&sig=${encodeURIComponent(signature)}`)
      const slotsPayload = (await response.json()) as { slots?: MobileReviewSlot[]; error?: string }
      if (!response.ok) {
        throw new Error(slotsPayload.error || "No se pudieron cargar las franjas.")
      }
      setSlots(slotsPayload.slots || [])
    } catch (slotsLoadError) {
      setSlotsError(slotsLoadError instanceof Error ? slotsLoadError.message : "No se pudieron cargar las franjas.")
    } finally {
      setIsSlotsLoading(false)
    }
  }

  const openSlotsModal = async () => {
    setIsModalOpen(true)
    setIsScheduleModalOpen(false)
    setSlotForm(createEmptySlotForm())
    await loadSlots()
  }

  const loadNext = async () => {
    setIsLoading(true)
    setError("")
    if (activeTask && !ratedTaskKeyRef.current) {
      void postInteractionEvent({ task: activeTask, eventType: "skipped" })
    }
    try {
      const response = await fetch("/api/mobile/review/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: deviceId,
          sig: signature,
        }),
      })
      const nextPayload = (await response.json()) as MobileReviewPayload & { error?: string }
      if (!response.ok) {
        throw new Error(nextPayload.error || "No se pudo cargar la siguiente materia.")
      }
      setPayload(nextPayload)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo cargar la siguiente materia.")
    } finally {
      setIsLoading(false)
    }
  }

  const loadNextPair = async () => {
    if (!payload?.totalPairs) return
    setIsLoading(true)
    setError("")
    if (activeTask && activePair && !ratedTaskKeyRef.current) {
      void postInteractionEvent({ task: activeTask, eventType: "skipped" })
    }
    try {
      const response = await fetch("/api/mobile/review/next-pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: deviceId,
          sig: signature,
        }),
      })
      const nextPayload = (await response.json()) as MobileReviewPayload & { error?: string }
      if (!response.ok) {
        throw new Error(nextPayload.error || "No se pudo cargar la siguiente dupla.")
      }
      setPayload(nextPayload)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo cargar la siguiente dupla.")
    } finally {
      setIsLoading(false)
    }
  }

  const revealAnswer = async () => {
    if (!activeTask || !activePair) return
    setIsAnswerVisible(true)
    if (revealedTaskKeyRef.current === activeTaskKey) return
    revealedTaskKeyRef.current = activeTaskKey
    await postInteractionEvent({ task: activeTask, eventType: "revealed" })
    const answerAudio = answerAudioRef.current
    if (!answerAudio) return
    answerAudio.currentTime = 0
    void answerAudio.play().catch(() => {})
  }

  const rateTask = async (rating: "ok" | "doubt" | "fail") => {
    if (!activeTask || isEventLoading) return
    setIsEventLoading(true)
    setError("")
    try {
      await postInteractionEvent({ task: activeTask, eventType: "rated", rating })
      ratedTaskKeyRef.current = activeTaskKey
      await loadNext()
    } catch {
      setError("No se pudo guardar la valoracion.")
    } finally {
      setIsEventLoading(false)
    }
  }

  const handleSlotInputChange = (field: keyof SlotFormState, value: string | boolean) => {
    setSlotForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const openScheduleModal = async () => {
    setIsScheduleModalOpen(true)
    setIsModalOpen(false)
    await loadSlots()
  }

  const editSlotFromSchedule = (slot: MobileReviewSlot) => {
    setSlotForm(mapSlotToForm(slot))
    setScheduleDayIndex(slot.weekdayIndex)
    setIsScheduleModalOpen(false)
    setIsModalOpen(true)
  }

  const saveSlot = async () => {
    setIsSavingSlot(true)
    setSlotsError("")
    try {
      const body = {
        device: deviceId,
        sig: signature,
        subjectId: slotForm.subjectId,
        weekdayIndex: Number(slotForm.weekdayIndex),
        startTime: slotForm.startTime,
        endTime: slotForm.endTime,
        enabled: slotForm.enabled,
        priority: Number(slotForm.priority),
      }

      const response = await fetch(
        slotForm.id ? `/api/mobile/review/slots/${slotForm.id}` : "/api/mobile/review/slots",
        {
          method: slotForm.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )
      const result = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(result.error || "No se pudo guardar la franja.")
      }

      setSlotForm(createEmptySlotForm())
      await Promise.all([loadSlots(), refreshCurrent()])
      setError("")
    } catch (saveError) {
      setSlotsError(saveError instanceof Error ? saveError.message : "No se pudo guardar la franja.")
    } finally {
      setIsSavingSlot(false)
    }
  }

  const toggleSlot = async (slot: MobileReviewSlot) => {
    setIsSavingSlot(true)
    setSlotsError("")
    try {
      const response = await fetch(`/api/mobile/review/slots/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: deviceId,
          sig: signature,
          subjectId: slot.subjectId,
          weekdayIndex: slot.weekdayIndex,
          startTime: slot.startTime,
          endTime: slot.endTime,
          enabled: !slot.enabled,
          priority: slot.priority,
        }),
      })
      const result = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(result.error || "No se pudo actualizar la franja.")
      }

      await Promise.all([loadSlots(), refreshCurrent()])
      setError("")
    } catch (toggleError) {
      setSlotsError(toggleError instanceof Error ? toggleError.message : "No se pudo actualizar la franja.")
    } finally {
      setIsSavingSlot(false)
    }
  }

  const deleteSlot = async (slot: MobileReviewSlot) => {
    setIsSavingSlot(true)
    setSlotsError("")
    try {
      const response = await fetch(`/api/mobile/review/slots/${slot.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: deviceId,
          sig: signature,
        }),
      })
      const result = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(result.error || "No se pudo eliminar la franja.")
      }

      if (slotForm.id === slot.id) {
        setSlotForm(createEmptySlotForm())
      }
      await Promise.all([loadSlots(), refreshCurrent()])
      setError("")
    } catch (deleteError) {
      setSlotsError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar la franja.")
    } finally {
      setIsSavingSlot(false)
    }
  }

  const slotsForSelectedDay = slots.filter((slot) => slot.weekdayIndex === scheduleDayIndex)
  const scheduleDayLabel = WEEKDAY_OPTIONS.find((option) => Number(option.value) === scheduleDayIndex)?.label || "Dia"
  const viewportStyle =
    viewportHeight && Number.isFinite(viewportHeight)
      ? { height: `${viewportHeight}px`, minHeight: `${viewportHeight}px` }
      : { minHeight: "100vh" }

  if (requiresAccess) {
    return (
      <main style={viewportStyle} className="box-border overflow-hidden bg-[#f1e4a9] px-3 pt-2 text-black">
        <div className="mx-auto flex h-full w-full max-w-[320px] box-border flex-col border-4 border-black bg-[#f1e4a9] px-4 py-5">
          <div className="grid flex-1 grid-rows-[auto_1fr_auto] gap-5">
            <header className="pt-1 text-center text-[1.9rem] leading-[1.05]">Repaso movil</header>

            <div className="space-y-5">
              <p className="text-sm leading-relaxed">Escribe un nombre simple para este dispositivo y la web lo recordara para entrar sola la proxima vez.</p>

              <label className="block space-y-2 text-sm">
                <span>Dispositivo</span>
                <input
                  type="text"
                  value={accessDeviceId}
                  onChange={(event) => setAccessDeviceId(event.target.value)}
                  placeholder="celu-rafa"
                  className="w-full border-2 border-black bg-[#f7ecc0] px-3 py-2 text-base"
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                />
              </label>

              {accessError ? <p className="text-sm text-red-700">{accessError}</p> : null}
            </div>

            <div className="space-y-3 self-end">
              <button
                type="button"
                onClick={() => void submitAccess()}
                disabled={isAccessLoading}
                className="w-full border-2 border-black bg-[#f7ecc0] px-3 py-3 text-left text-[1.4rem] leading-none disabled:opacity-60"
              >
                {isAccessLoading ? "Entrando..." : "Entrar"}
              </button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main style={viewportStyle} className="box-border overflow-hidden bg-[#f1e4a9] px-3 pt-2 text-black">
      <div className="mx-auto flex h-full w-full max-w-[320px] box-border flex-col border-4 border-black bg-[#f1e4a9] px-3 py-4">
        <div className="grid flex-1 grid-rows-[auto_1fr_auto] gap-6">
          <header className="grid min-h-11 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-3">
            <div aria-hidden="true" className="h-10 w-10" />
            <div className="text-center text-[1.9rem] leading-[1.05] text-black">{subjectTitle}</div>
            <div aria-hidden="true" className="h-10 w-10" />
          </header>

          <div className="flex min-h-0 flex-col justify-start gap-7 overflow-hidden">
            {activeTask ? (
              <section className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-[0.78rem] uppercase tracking-[0.16em]">
                  <span className="border border-black px-2 py-1">
                    {activeTask.kind === "material_pair"
                      ? "PDF"
                      : activeTask.kind === "subject_anchor"
                        ? "Ancla"
                        : "Cobertura"}
                  </span>
                  {activeTask.vectorDay ? <span className="border border-black px-2 py-1">{`D${activeTask.vectorDay}`}</span> : null}
                  {activeTask.material ? (
                    <span className="max-w-[11rem] truncate border border-black px-2 py-1">{activeTask.material.fileName}</span>
                  ) : null}
                </div>
                <p className="text-sm leading-relaxed text-black/80">{activeTask.instruction}</p>
              </section>
            ) : null}

            {activePair ? (
              <>
                <AudioRow
                  label={activeTask?.kind === "subject_anchor" ? "Ancla" : "Pregunta"}
                  audioRef={questionAudioRef}
                  src={activePair.questionAudioUrl}
                />

                {isAnswerVisible ? (
                  <AudioRow
                    label="Respuesta"
                    audioRef={answerAudioRef}
                    src={activePair.answerAudioUrl}
                  />
                ) : (
                  <section className="space-y-2">
                    <p className="text-[1.9rem] leading-none text-black">Respuesta</p>
                    <button
                      type="button"
                      onClick={() => void revealAnswer()}
                      disabled={isEventLoading}
                      className="block w-full border-2 border-black bg-[#f7ecc0] px-4 py-4 text-left text-[1.4rem] leading-none disabled:opacity-60"
                    >
                      Revelar respuesta
                    </button>
                  </section>
                )}
              </>
            ) : null}

            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            {!error && !activePair ? (
              <p className="text-sm text-black/80">{noPairMessage}</p>
            ) : null}

            {activeTask?.staleReason?.length ? (
              <section className="space-y-2">
                <p className="text-xs uppercase tracking-[0.16em] text-black/70">Deuda visible</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  {activeTask.staleReason.map((reason) => (
                    <span key={reason} className="border border-black/60 px-2 py-1">
                      {reason.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <div className="grid grid-cols-[1fr_auto] items-end gap-4">
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => void loadNext()}
                disabled={isLoading}
                className="block text-left text-[1.9rem] leading-none text-black disabled:opacity-60"
              >
                {isLoading ? "Cargando..." : "Siguiente materia"}
              </button>
              {activePair && isAnswerVisible ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void rateTask("ok")}
                    disabled={isLoading || isEventLoading}
                    className="border-2 border-black bg-[#f7ecc0] px-3 py-2 text-sm disabled:opacity-60"
                  >
                    Salio
                  </button>
                  <button
                    type="button"
                    onClick={() => void rateTask("doubt")}
                    disabled={isLoading || isEventLoading}
                    className="border-2 border-black bg-[#f7ecc0] px-3 py-2 text-sm disabled:opacity-60"
                  >
                    Dude
                  </button>
                  <button
                    type="button"
                    onClick={() => void rateTask("fail")}
                    disabled={isLoading || isEventLoading}
                    className="border-2 border-black bg-[#f7ecc0] px-3 py-2 text-sm disabled:opacity-60"
                  >
                    Falle
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => void loadNextPair()}
                disabled={isLoading || !payload?.totalPairs}
                className="text-left text-[1.9rem] leading-none text-black disabled:opacity-60"
              >
                {isLoading ? "Cargando..." : "Siguiente audio"}
              </button>
            </div>
            <p className="text-base leading-none text-black/80">{pairCounter}</p>
          </div>
        </div>
      </div>
    </main>
  )
}
