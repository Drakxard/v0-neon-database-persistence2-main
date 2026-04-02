"use client"

import { useEffect, useRef, useState } from "react"

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
  pair: MobileReviewPair | null
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
  audioRef: React.RefObject<HTMLAudioElement | null>
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
  const questionAudioRef = useRef<HTMLAudioElement | null>(null)
  const answerAudioRef = useRef<HTMLAudioElement | null>(null)

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

  useEffect(() => {
    if (!payload?.pair) return
    const questionAudio = questionAudioRef.current
    if (!questionAudio) return
    questionAudio.currentTime = 0
    void questionAudio.play().catch(() => {})
  }, [payload?.pair?.pairId])

  const refreshCurrent = async () => {
    const response = await fetch(`/api/mobile/review/current?device=${encodeURIComponent(deviceId)}&sig=${encodeURIComponent(signature)}`)
    const nextPayload = (await response.json()) as MobileReviewPayload & { error?: string }
    if (!response.ok) {
      throw new Error(nextPayload.error || "No se pudo actualizar el repaso.")
    }
    setPayload({
      pair: nextPayload.pair,
      status: nextPayload.status,
      currentIndex: nextPayload.currentIndex,
      totalPairs: nextPayload.totalPairs,
      debugReason: nextPayload.debugReason,
    })
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
        throw new Error(nextPayload.error || "No se pudo cargar el siguiente audio.")
      }
      setPayload({
        pair: nextPayload.pair,
        status: nextPayload.status,
        currentIndex: nextPayload.currentIndex,
        totalPairs: nextPayload.totalPairs,
        debugReason: nextPayload.debugReason,
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo cargar el siguiente audio.")
    } finally {
      setIsLoading(false)
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

  const subjectTitle = payload?.pair?.subjectName || payload?.status.subjectName || "Sin materia"
  const pairCounter = `${payload?.currentIndex ?? 0}/${payload?.totalPairs ?? 0}`
  const emptyStateMessage =
    payload?.debugReason === "no_active_slot"
      ? "No hay una franja activa en este momento."
      : "No hay un par disponible para la franja actual."
  const slotsForSelectedDay = slots.filter((slot) => slot.weekdayIndex === scheduleDayIndex)
  const scheduleDayLabel = WEEKDAY_OPTIONS.find((option) => Number(option.value) === scheduleDayIndex)?.label || "Dia"

  if (requiresAccess) {
    return (
      <main className="min-h-screen bg-[#f1e4a9] px-3 py-2 text-black">
        <div className="mx-auto flex min-h-[calc(100vh-1rem)] w-full max-w-[320px] flex-col border-4 border-black bg-[#f1e4a9] px-4 py-6">
          <div className="flex-1 space-y-5">
            <header className="text-center text-[2rem] leading-none">Repaso movil</header>
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

          <div className="space-y-3">
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
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#f1e4a9] px-3 py-2 text-black">
      <div className="mx-auto flex min-h-[calc(100vh-1rem)] w-full max-w-[320px] flex-col border-4 border-black bg-[#f1e4a9] px-3 py-4">
        <header className="relative pb-5">
          <button
            type="button"
            onClick={() => void openSlotsModal()}
            className="absolute right-0 top-0 grid h-10 w-10 place-items-center border-2 border-black bg-[#f7ecc0]"
            aria-label="Configurar horarios"
          >
            <span className="relative block h-5 w-5 border-2 border-black">
              <span className="absolute inset-x-0 top-0 h-1 border-b-2 border-black bg-black/15" />
              <span className="absolute left-[3px] top-[-4px] h-2 w-[2px] bg-black" />
              <span className="absolute right-[3px] top-[-4px] h-2 w-[2px] bg-black" />
            </span>
          </button>
          <div className="px-10 text-center text-[2rem] leading-none text-black">{subjectTitle}</div>
        </header>

        <div className="flex-1 space-y-10">
          <AudioRow
            label="Pregunta"
            audioRef={questionAudioRef}
            src={payload?.pair?.questionAudioUrl || ""}
          />

          <AudioRow
            label="Respuesta"
            audioRef={answerAudioRef}
            src={payload?.pair?.answerAudioUrl || ""}
          />

          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {!error && !payload?.pair ? (
            <p className="text-sm text-black/80">{emptyStateMessage}</p>
          ) : null}
        </div>

        <div className="mt-6 flex items-end justify-between gap-4">
          <button
            type="button"
            onClick={() => void loadNext()}
            disabled={isLoading}
            className="text-left text-[1.9rem] leading-none text-black disabled:opacity-60"
          >
            {isLoading ? "Cargando..." : "Siguiente pregunta"}
          </button>
          <p className="text-base leading-none text-black/80">{pairCounter}</p>
        </div>
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-3 py-4">
          <div className="flex max-h-full w-full max-w-[360px] flex-col border-4 border-black bg-[#f1e4a9]">
            <div className="flex items-center justify-between border-b-2 border-black px-4 py-3">
              <h2 className="text-xl leading-none">Horarios</h2>
              <button type="button" onClick={() => setIsModalOpen(false)} className="border border-black px-2 py-1 text-sm">
                Cerrar
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-4 py-4">
              <section className="space-y-3 border-2 border-black bg-[#f7ecc0] p-3">
                <h3 className="text-sm font-semibold">{slotForm.id ? "Editar franja" : "Nueva franja"}</h3>

                <label className="block space-y-1 text-sm">
                  <span>Materia</span>
                  <select
                    value={slotForm.subjectId}
                    onChange={(event) => handleSlotInputChange("subjectId", event.target.value)}
                    className="w-full border border-black bg-white px-2 py-1"
                  >
                    {SUBJECTS.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name.replace(/\n/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1 text-sm">
                  <span>Dia</span>
                  <select
                    value={slotForm.weekdayIndex}
                    onChange={(event) => handleSlotInputChange("weekdayIndex", event.target.value)}
                    className="w-full border border-black bg-white px-2 py-1"
                  >
                    {WEEKDAY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-1 text-sm">
                    <span>Inicio</span>
                    <input
                      type="time"
                      value={slotForm.startTime}
                      onChange={(event) => handleSlotInputChange("startTime", event.target.value)}
                      className="w-full border border-black bg-white px-2 py-1"
                    />
                  </label>

                  <label className="block space-y-1 text-sm">
                    <span>Fin</span>
                    <input
                      type="time"
                      value={slotForm.endTime}
                      onChange={(event) => handleSlotInputChange("endTime", event.target.value)}
                      className="w-full border border-black bg-white px-2 py-1"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                  <label className="block space-y-1 text-sm">
                    <span>Prioridad</span>
                    <input
                      type="number"
                      step="1"
                      value={slotForm.priority}
                      onChange={(event) => handleSlotInputChange("priority", event.target.value)}
                      className="w-full border border-black bg-white px-2 py-1"
                    />
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={slotForm.enabled}
                      onChange={(event) => handleSlotInputChange("enabled", event.target.checked)}
                    />
                    <span>Activa</span>
                  </label>
                </div>

                <div className="flex gap-2 text-sm">
                  <button type="button" onClick={() => void saveSlot()} className="border border-black px-3 py-1" disabled={isSavingSlot}>
                    {isSavingSlot ? "Guardando..." : slotForm.id ? "Guardar" : "Crear"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSlotForm(createEmptySlotForm())}
                    className="border border-black px-3 py-1"
                    disabled={isSavingSlot}
                  >
                    Nueva
                  </button>
                  <button type="button" onClick={() => void openScheduleModal()} className="border border-black px-3 py-1" disabled={isSavingSlot}>
                    Ver horarios
                  </button>
                </div>

                {slotsError ? <p className="text-sm text-red-700">{slotsError}</p> : null}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {isScheduleModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 px-3 py-4">
          <div className="flex max-h-full w-full max-w-[360px] flex-col border-4 border-black bg-[#f1e4a9]">
            <div className="flex items-center justify-between border-b-2 border-black px-4 py-3">
              <button
                type="button"
                onClick={() => setScheduleDayIndex((current) => (current + 6) % 7)}
                className="border border-black px-2 py-1 text-sm"
              >
                {"<"}
              </button>
              <h2 className="text-xl leading-none">{scheduleDayLabel}</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleDayIndex((current) => (current + 1) % 7)}
                  className="border border-black px-2 py-1 text-sm"
                >
                  {">"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsScheduleModalOpen(false)
                    setIsModalOpen(true)
                  }}
                  className="border border-black px-2 py-1 text-sm"
                >
                  Volver
                </button>
              </div>
            </div>

            <div className="space-y-4 overflow-y-auto px-4 py-4">
              {isSlotsLoading ? <p className="text-sm">Cargando horarios...</p> : null}
              {!isSlotsLoading && slotsForSelectedDay.length === 0 ? (
                <p className="text-sm">No hay franjas para este dia.</p>
              ) : null}
              {slotsForSelectedDay.map((slot) => (
                <SlotRow
                  key={slot.id}
                  slot={slot}
                  onEdit={editSlotFromSchedule}
                  onToggle={(selectedSlot) => void toggleSlot(selectedSlot)}
                  onDelete={(selectedSlot) => void deleteSlot(selectedSlot)}
                  busy={isSavingSlot}
                />
              ))}
              {slotsError ? <p className="text-sm text-red-700">{slotsError}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
