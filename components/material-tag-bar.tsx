"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Settings2, Tag, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { MaterialTagsController } from "@/hooks/use-material-tags"
import { matchesTagSearch, normalizeTagName } from "@/lib/tag-utils"
import { cn } from "@/lib/utils"

export function MaterialTagBar({ controller }: { controller: MaterialTagsController }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [input, setInput] = useState("")
  const [notice, setNotice] = useState("")
  const [isManagerOpen, setIsManagerOpen] = useState(false)
  const [editingTagId, setEditingTagId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editColor, setEditColor] = useState("#10b981")
  const [editParentId, setEditParentId] = useState("none")
  const [mergeTargetId, setMergeTargetId] = useState("none")
  const [isSaving, setIsSaving] = useState(false)

  const suggestions = useMemo(
    () => controller.workspace.tags.filter((tag) => matchesTagSearch(tag.name, input)).slice(0, 8),
    [controller.workspace.tags, input]
  )
  const editingTag = controller.workspace.tags.find((tag) => tag.id === editingTagId) ?? null

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey) return
      if (event.altKey && !event.getModifierState("AltGraph")) return
      const target = event.target as HTMLElement | null
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return
      if (event.key.length !== 1 || !event.key.trim()) return
      event.preventDefault()
      inputRef.current?.focus()
      setInput(event.key)
      setNotice("")
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    if (!editingTag) return
    setEditName(editingTag.name)
    setEditColor(editingTag.color)
    setEditParentId(editingTag.parentId == null ? "none" : String(editingTag.parentId))
    setMergeTargetId("none")
  }, [editingTag])

  const chooseTag = (tagId: number) => {
    controller.toggleSelectedTag(tagId)
    setInput("")
    setNotice("")
  }

  const submitInput = async () => {
    const displayName = input.replace(/^#/, "").trim()
    if (!displayName) {
      setNotice("Escribe un nombre para crear o buscar un tag.")
      return
    }
    const exact = controller.workspace.tags.find((tag) => tag.normalizedName === normalizeTagName(displayName))
    if (exact) {
      chooseTag(exact.id)
      return
    }
    try {
      const result = await controller.createTag({ name: displayName })
      controller.toggleSelectedTag(result.tag.id)
      setInput("")
      setNotice("")
    } catch {}
  }

  const saveEdit = async () => {
    if (!editingTag) return
    setIsSaving(true)
    try {
      await controller.updateTag(editingTag.id, {
        name: editName,
        color: editColor,
        parentId: editParentId === "none" ? null : Number(editParentId),
      })
      setNotice("Tag actualizado.")
    } catch {
    } finally {
      setIsSaving(false)
    }
  }

  const mergeEdit = async () => {
    if (!editingTag || mergeTargetId === "none") return
    const target = controller.workspace.tags.find((tag) => tag.id === Number(mergeTargetId))
    if (!target || !window.confirm(`Fusionar #${editingTag.name} dentro de #${target.name}?`)) return
    setIsSaving(true)
    try {
      await controller.mergeTags(editingTag.id, target.id)
      setEditingTagId(target.id)
      setNotice("Tags fusionados.")
    } catch {
    } finally {
      setIsSaving(false)
    }
  }

  const deleteEdit = async () => {
    if (!editingTag) return
    const assignedMessage = editingTag.usageCount > 0
      ? ` Tiene ${editingTag.usageCount} material${editingTag.usageCount === 1 ? "" : "es"} asignado${editingTag.usageCount === 1 ? "" : "s"}; los materiales no se borraran.`
      : ""
    if (!window.confirm(`Eliminar #${editingTag.name}?${assignedMessage}`)) return
    setIsSaving(true)
    try {
      await controller.deleteTag(editingTag.id, editingTag.usageCount > 0)
      setEditingTagId(null)
      setNotice("Tag eliminado.")
    } catch {
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card/80 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Tag className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={input}
            onChange={(event) => {
              setInput(event.target.value)
              setNotice("")
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void submitInput()
              }
              if (event.key === "Escape") setInput("")
            }}
            placeholder="# crear o filtrar"
            className="pl-9"
            aria-label="Crear o filtrar por tag"
          />
          {input ? (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
              {suggestions.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => chooseTag(tag.id)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span>#{tag.name}</span>
                  <span className="text-xs text-muted-foreground">{tag.usageCount}</span>
                </button>
              ))}
              {!suggestions.some((tag) => tag.normalizedName === normalizeTagName(input.replace(/^#/, ""))) ? (
                <button type="button" onClick={() => void submitInput()} className="w-full px-3 py-2 text-left text-sm text-emerald-700 hover:bg-accent">
                  Crear “{input.replace(/^#/, "").trim() || "…"}”
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => controller.setFilterMode(controller.filterMode === "and" ? "or" : "and")}
          title="Cambiar forma de combinar filtros"
        >
          {controller.filterMode.toUpperCase()}
        </Button>
        {controller.selectedTagIds.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => controller.setSelectedTagIds([])}>
            Limpiar
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon" onClick={() => setIsManagerOpen(true)} aria-label="Administrar tags">
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex min-h-7 flex-wrap gap-1.5">
        {controller.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        {controller.workspace.tags.map((tag) => {
          const active = controller.selectedTagIds.includes(tag.id)
          const parent = tag.parentId == null ? null : controller.workspace.tags.find((candidate) => candidate.id === tag.parentId)
          return (
            <button
              key={tag.id}
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-study-tag-id", String(tag.id))
                event.dataTransfer.setData("text/plain", `#${tag.name}`)
                event.dataTransfer.effectAllowed = "copy"
              }}
              onClick={() => chooseTag(tag.id)}
              className={cn(
                "cursor-grab rounded-full border px-2.5 py-1 text-xs transition active:cursor-grabbing",
                active ? "text-white shadow-sm" : "bg-background text-foreground hover:bg-accent"
              )}
              style={{ borderColor: tag.color, backgroundColor: active ? tag.color : undefined }}
              title={parent ? `Dentro de #${parent.name}. Arrastra este tag sobre un PDF para asignarlo.` : "Arrastra este tag sobre un PDF para asignarlo."}
            >
              {parent ? `${parent.name} / ` : ""}#{tag.name}
            </button>
          )
        })}
      </div>
      {notice || controller.error ? (
        <p className={cn("text-xs", controller.error ? "text-red-600" : "text-muted-foreground")}>
          {controller.error || notice}
        </p>
      ) : null}

      <Dialog open={isManagerOpen} onOpenChange={setIsManagerOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Administrar tags</DialogTitle>
            <DialogDescription>Renombra, recolorea, organiza, fusiona o elimina tags manuales.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <div className="max-h-80 space-y-1 overflow-auto">
              {controller.workspace.tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => setEditingTagId(tag.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm",
                    editingTagId === tag.id ? "bg-accent" : "hover:bg-accent/60"
                  )}
                >
                  <span className="truncate">#{tag.name}</span>
                  <span className="text-xs text-muted-foreground">{tag.usageCount}</span>
                </button>
              ))}
            </div>
            {editingTag ? (
              <div className="space-y-3">
                <Input value={editName} onChange={(event) => setEditName(event.target.value)} aria-label="Nombre del tag" />
                <label className="flex items-center gap-3 text-sm">
                  Color
                  <input type="color" value={editColor} onChange={(event) => setEditColor(event.target.value)} />
                </label>
                <Select value={editParentId} onValueChange={setEditParentId}>
                  <SelectTrigger><SelectValue placeholder="Tag padre" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin padre</SelectItem>
                    {controller.workspace.tags.filter((tag) => tag.id !== editingTag.id).map((tag) => (
                      <SelectItem key={tag.id} value={String(tag.id)}>#{tag.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" onClick={() => void saveEdit()} disabled={isSaving}>
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Guardar cambios
                </Button>
                <div className="border-t pt-3">
                  <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                    <SelectTrigger><SelectValue placeholder="Fusionar dentro de…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Elegir destino</SelectItem>
                      {controller.workspace.tags.filter((tag) => tag.id !== editingTag.id).map((tag) => (
                        <SelectItem key={tag.id} value={String(tag.id)}>#{tag.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" className="mt-2" disabled={mergeTargetId === "none" || isSaving} onClick={() => void mergeEdit()}>
                    Fusionar explícitamente
                  </Button>
                </div>
                <Button type="button" variant="destructive" onClick={() => void deleteEdit()} disabled={isSaving}>
                  <X className="mr-2 h-4 w-4" />
                  Eliminar tag
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Selecciona un tag para editarlo.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsManagerOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
