"use client"

import { useState } from "react"
import { Table2 } from "lucide-react"
import type { ChainedCommands } from "@tiptap/core"
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { Button } from "@/components/tiptap-ui-primitive/button"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/tiptap-ui-primitive/popover"

const actions = [
  ["addRowBefore", "Fila arriba"], ["addRowAfter", "Fila abajo"],
  ["addColumnBefore", "Columna a la izquierda"], ["addColumnAfter", "Columna a la derecha"],
  ["toggleHeaderRow", "Alternar encabezado"], ["mergeCells", "Combinar celdas"],
  ["splitCell", "Separar celda"], ["deleteRow", "Eliminar fila"],
  ["deleteColumn", "Eliminar columna"], ["deleteTable", "Eliminar tabla"],
] as const satisfies ReadonlyArray<readonly [keyof ChainedCommands, string]>

export function TableMenu() {
  const { editor } = useTiptapEditor()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState("3")
  const [cols, setCols] = useState("3")
  const [header, setHeader] = useState(true)
  if (!editor) return null
  const inTable = editor.isActive("table")
  const validSize = [rows, cols].every((value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 20)

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" tooltip="Tabla" aria-label="Tabla"
        data-active-state={inTable ? "on" : "off"} disabled={!editor.isEditable}>
        <Table2 className="tiptap-button-icon" />
      </Button>
    </PopoverTrigger>
    <PopoverContent className="simple-table-menu" align="start" aria-label={inTable ? "Editar tabla" : "Crear tabla"}
      onCloseAutoFocus={(event) => { event.preventDefault(); editor.commands.focus() }}
      onEscapeKeyDown={(event) => event.stopPropagation()}>
      {inTable ? <>
        <strong>Editar tabla</strong>
        <div className="simple-table-actions">
          {actions.map(([command, label]) => <Button key={command} type="button" variant="ghost" showTooltip={false}
            disabled={!editor.can()[command]()}
            onClick={() => { editor.chain().focus()[command]().run(); setOpen(false) }}>
            <span className="tiptap-button-text">{label}</span>
          </Button>)}
        </div>
      </> : <form onSubmit={(event) => {
        event.preventDefault()
        if (!validSize) return
        if (editor.chain().focus().insertTable({ rows: Number(rows), cols: Number(cols), withHeaderRow: header }).run()) setOpen(false)
      }}>
        <strong>Crear tabla</strong>
        <div className="simple-table-size">
          <label>Filas<input type="number" min="1" max="20" required value={rows} onChange={(event) => setRows(event.target.value)} /></label>
          <label>Columnas<input type="number" min="1" max="20" required value={cols} onChange={(event) => setCols(event.target.value)} /></label>
        </div>
        <label className="simple-table-header"><input type="checkbox" checked={header} onChange={(event) => setHeader(event.target.checked)} />Fila de encabezado</label>
        <Button type="submit" variant="primary" showTooltip={false} disabled={!validSize || !editor.can().insertTable()}>
          <span className="tiptap-button-text">Insertar tabla</span>
        </Button>
      </form>}
    </PopoverContent>
  </Popover>
}
