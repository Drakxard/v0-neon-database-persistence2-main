"use client"

import { Button } from "@/components/tiptap-ui-primitive/button"
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/tiptap-ui-primitive/dropdown-menu"
import { SYNTHESIS_EDITOR_FONT_SIZES } from "@/lib/synthesis-workspace"

export function FontSizeMenu({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" aria-label={`Tamaño general del texto: ${value} px`} tooltip="Tamaño general del texto">
        <span className="tiptap-button-text">{value} px</span>
        <ChevronDownIcon className="tiptap-button-dropdown-small" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuLabel>Tamaño de esta Síntesis</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={String(value)} onValueChange={(size) => onChange(Number(size))}>
        {SYNTHESIS_EDITOR_FONT_SIZES.map((size) => <DropdownMenuRadioItem key={size} value={String(size)}>
          {size} px{size === 16 ? " (predeterminado)" : ""}
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}
