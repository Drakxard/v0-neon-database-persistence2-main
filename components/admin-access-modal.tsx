"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Plus, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type SubjectOption = {
  id: string
  name: string
  color: string
}

type AllowedAccount = {
  id: number
  email: string
  allowedSubjectIds: string[]
}

type AdminAccessModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  subjectOptions: SubjectOption[]
}

export function AdminAccessModal({ open, onOpenChange, subjectOptions }: AdminAccessModalProps) {
  const [accounts, setAccounts] = useState<AllowedAccount[]>([])
  const [email, setEmail] = useState("")
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const sortedSubjectOptions = useMemo(
    () => [...subjectOptions].sort((left, right) => left.name.localeCompare(right.name)),
    [subjectOptions]
  )

  useEffect(() => {
    if (!open) return

    const loadAccounts = async () => {
      setIsLoading(true)
      setError("")

      try {
        const response = await fetch("/api/admin/allowed-emails", { cache: "no-store" })
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload?.error || "No se pudo cargar la lista de correos.")
        }

        setAccounts(Array.isArray(payload) ? payload : [])
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la lista de correos.")
      } finally {
        setIsLoading(false)
      }
    }

    void loadAccounts()
  }, [open])

  const toggleSubject = (subjectId: string) => {
    setSelectedSubjectIds((current) =>
      current.includes(subjectId) ? current.filter((id) => id !== subjectId) : [...current, subjectId]
    )
  }

  const resetForm = () => {
    setEmail("")
    setSelectedSubjectIds([])
  }

  const handleCreate = async () => {
    setError("")
    setSuccess("")

    if (!email.trim()) {
      setError("Ingresa un correo.")
      return
    }

    if (selectedSubjectIds.length === 0) {
      setError("Selecciona al menos una materia.")
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch("/api/admin/allowed-emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          allowedSubjectIds: selectedSubjectIds,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo guardar el correo.")
      }

      setAccounts((current) => [...current, payload].sort((left, right) => left.email.localeCompare(right.email)))
      setSuccess("Correo agregado.")
      resetForm()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el correo.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    setError("")
    setSuccess("")
    setDeletingId(id)

    try {
      const response = await fetch(`/api/admin/allowed-emails/${id}`, {
        method: "DELETE",
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo eliminar el correo.")
      }

      setAccounts((current) => current.filter((account) => account.id !== id))
      setSuccess("Correo eliminado.")
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar el correo.")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[90vh] overflow-hidden border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.06),_transparent_35%),linear-gradient(180deg,_#ffffff,_#f8fafc)] p-0 sm:max-w-4xl"
      >
        <DialogHeader className="border-b border-slate-200/80 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="inline-flex rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.28em] text-slate-500">
                Admin
              </div>
              <DialogTitle className="text-2xl text-slate-900">Correos y materias</DialogTitle>
              <DialogDescription className="text-sm text-slate-500">
                Agrega un correo por vez y define exactamente qué materias puede ver.
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-900 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
                aria-label="Cerrar modal admin"
              >
                <X className="h-5 w-5" />
              </button>
            </DialogClose>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 gap-0 lg:grid-cols-[340px_minmax(0,1fr)]">
          <section className="border-b border-slate-200/80 bg-white/80 p-6 lg:border-r lg:border-b-0">
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Nuevo acceso</p>
                <Input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="correo@gmail.com"
                  className="h-12 rounded-2xl border-slate-300 bg-white"
                />
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Materias permitidas</p>
                <div className="grid gap-2">
                  {sortedSubjectOptions.map((subject) => {
                    const checked = selectedSubjectIds.includes(subject.id)
                    return (
                      <button
                        key={subject.id}
                        type="button"
                        onClick={() => toggleSubject(subject.id)}
                        className={cn(
                          "flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition",
                          checked ? "border-slate-900 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                        )}
                      >
                        <Checkbox checked={checked} className="border-current data-[state=checked]:bg-current data-[state=checked]:text-white" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{subject.name.replace("\n", " ")}</p>
                        </div>
                        <span className="ml-auto h-3 w-3 rounded-full" style={{ backgroundColor: subject.color }} />
                      </button>
                    )
                  })}
                </div>
              </div>

              <Button
                type="button"
                onClick={() => void handleCreate()}
                disabled={isSaving}
                className="h-12 w-full rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
              >
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Agregar correo
              </Button>
            </div>
          </section>

          <section className="flex min-h-0 flex-col">
            <div className="border-b border-slate-200/80 px-6 py-4">
              <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] gap-4 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                <span>Correo</span>
                <span>Materias permitidas</span>
                <span>Eliminar</span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {error ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
              {success ? <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

              {isLoading ? (
                <div className="flex h-full items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : accounts.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/70 px-6 py-16 text-center text-sm text-slate-500">
                  Todavia no hay correos adicionales cargados.
                </div>
              ) : (
                <div className="space-y-3">
                  {accounts.map((account) => (
                    <article
                      key={account.id}
                      className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] items-center gap-4 rounded-3xl border border-slate-200 bg-white/90 px-4 py-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{account.email}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {account.allowedSubjectIds.map((subjectId) => {
                          const subject = subjectOptions.find((item) => item.id === subjectId)
                          if (!subject) return null

                          return (
                            <span
                              key={subjectId}
                              className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium text-white"
                              style={{ backgroundColor: subject.color }}
                            >
                              {subject.name.replace("\n", " ")}
                            </span>
                          )
                        })}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={deletingId === account.id}
                        onClick={() => void handleDelete(account.id)}
                        className="h-10 w-10 rounded-full border-slate-300 bg-white text-slate-700 hover:border-red-500 hover:bg-red-50 hover:text-red-600"
                      >
                        {deletingId === account.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
