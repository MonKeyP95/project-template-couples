import { cn } from "@/lib/utils"
import { WeatherIcon } from "./weather-icon"

export interface DayChipProps {
  d: string
  t: number
  /** WMO weather code, drives the icon. */
  code: number
  active?: boolean
  className?: string
}

export function DayChip({ d, t, code, active = false, className }: DayChipProps) {
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
      <WeatherIcon code={code} className="mx-auto my-1 block h-3.5 w-3.5" />
      <div className="font-mono text-[10px] text-foreground">{t}°</div>
    </div>
  )
}
