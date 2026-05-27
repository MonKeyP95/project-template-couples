import * as React from "react"
import { cn } from "@/lib/utils"

export type WeatherGlyph = "sun" | "haze" | "rain"

const glyphFill: Record<WeatherGlyph, string> = {
  sun: "fill-sand",
  haze: "fill-sea-2",
  rain: "fill-sea",
}

export interface DayChipProps {
  d: string
  t: number
  glyph?: WeatherGlyph
  active?: boolean
  className?: string
}

export function DayChip({
  d,
  t,
  glyph = "sun",
  active = false,
  className,
}: DayChipProps) {
  return (
    <div
      className={cn(
        "flex-1 border-l border-border px-0.5 py-2 text-center first:border-l-0",
        active ? "bg-card" : "bg-transparent",
        className,
      )}
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
        {d}
      </div>
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        className="mx-auto my-1 block"
        aria-hidden
      >
        <circle cx="7" cy="7" r="3" className={glyphFill[glyph]} />
      </svg>
      <div className="font-mono text-[10px] text-foreground">{t}°</div>
    </div>
  )
}
