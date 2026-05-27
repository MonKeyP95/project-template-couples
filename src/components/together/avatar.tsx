import * as React from "react"
import { cn } from "@/lib/utils"

export type AvatarTone = "sea" | "clay" | "moss" | "ink"

const toneClasses: Record<AvatarTone, string> = {
  sea: "border-sea text-sea",
  clay: "border-clay text-clay",
  moss: "border-moss text-moss",
  ink: "border-foreground text-foreground",
}

export interface AvatarProps {
  name: string
  size?: number
  tone?: AvatarTone
  className?: string
}

export function Avatar({
  name,
  size = 22,
  tone = "sea",
  className,
}: AvatarProps) {
  const initial = (name || "?").trim().charAt(0).toUpperCase()
  return (
    <span
      title={name}
      aria-label={name}
      className={cn(
        "inline-flex items-center justify-center rounded-full border bg-card font-mono font-medium tracking-normal select-none",
        toneClasses[tone],
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.42)),
        lineHeight: 1,
      }}
    >
      {initial}
    </span>
  )
}
