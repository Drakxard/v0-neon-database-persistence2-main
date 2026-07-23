"use client"

import { useMemo, useState } from "react"
import { Loader2, Plus, Tag, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useMaterialTags } from "@/hooks/use-material-tags"
import { matchesTagSearch, normalizeTagName } from "@/lib/tag-utils"

export function MaterialTagPicker({
  materialId,
  subjectId,
  weekNumber,
}: {
  materialId: number
  subjectId: string
  weekNumber: number
}) {
  const controller = useMaterialTags({ subjectId, weekNumber })
  const [input, setInput] = useState("")
  const assignedIds = controller.workspace.assignments[String(materialId)] ?? []
  const assigned = controller.workspace.tags.filter((tag) => assignedIds.includes(tag.id))
  const suggestions = useMemo(
    () => controller.workspace.tags
      .filter((tag) => !assignedIds.includes(tag.id) && matchesTagSearch(tag.name, input))
      .slice(0, 6),
    [assignedIds, controller.workspace.tags, input]
  )

  const submit = async () => {
    const name = input.replace(/^#/, "").trim()
    if (!name) {
      controller.setError("Escribe un nombre para el tag.")
      return
    }
    const exact = controller.workspace.tags.find((tag) => tag.normalizedName === normalizeTagName(name))
    try {
      const tag = exact ?? (await controller.createTag({ name })).tag
      await controller.assignTag(materialId, tag.id)
      setInput("")
    } catch {}
  }

  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-slate-950 px-3 py-2 text-white">
      <Tag className="h-4 w-4 text-emerald-300" />
      {assigned.map((tag) => (
        <span key={tag.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs" style={{ borderColor: tag.color }}>
          #{tag.name}
          <button type="button" onClick={() => void controller.unassignTag(materialId, tag.id)} aria-label={`Quitar ${tag.name}`}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              void submit()
            }
          }}
          placeholder="# asignar o crear"
          className="h-8 border-white/15 bg-white/5 text-white placeholder:text-slate-500"
        />
        {input ? (
          <div className="absolute left-0 right-0 top-full z-[1600] mt-1 rounded-lg border border-white/10 bg-slate-900 shadow-xl">
            {suggestions.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => {
                  void controller.assignTag(materialId, tag.id)
                  setInput("")
                }}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-white/10"
              >
                #{tag.name}
              </button>
            ))}
            {!suggestions.some((tag) => tag.normalizedName === normalizeTagName(input.replace(/^#/, ""))) ? (
              <button type="button" onClick={() => void submit()} className="flex w-full items-center px-3 py-2 text-left text-xs text-emerald-300 hover:bg-white/10">
                <Plus className="mr-1 h-3 w-3" /> Crear
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {controller.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {controller.error ? <span className="text-xs text-red-300">{controller.error}</span> : null}
      <Button type="button" variant="ghost" size="sm" className="h-8 text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => void controller.load()}>
        Actualizar
      </Button>
    </div>
  )
}
