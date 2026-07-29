"use client"

import { useEffect, useState } from "react"

import { localMidnight } from "@/lib/countdown"
import { cn } from "@/lib/utils"

/** Coarse text countdown for the small trip cards: "40 DAYS TO GO", "TODAY" on
 *  the start day, nothing once the trip is underway. The trip page and home
 *  hero use the split-flap FlipCountdown instead. */
export function TripCountdown({
  startDate,
  className,
}: {
  startDate: string
  className?: string
}) {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    const tick = () => setLabel(countdownLabel(startDate))
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [startDate])

  if (!label) return null
  return (
    <div
      className={cn(
        "font-mono text-[10px] uppercase tracking-[0.18em] text-clay",
        className,
      )}
    >
      {label}
    </div>
  )
}

function countdownLabel(startDate: string): string | null {
  const target = localMidnight(startDate)
  const now = new Date()
  const diffMs = target.getTime() - now.getTime()

  if (diffMs <= 0) {
    return isSameDay(now, target) ? "TODAY" : null
  }

  const days = Math.floor(diffMs / 86_400_000)
  if (days <= 0) return "TODAY"

  const years = Math.floor(days / 365)
  const remDays = days % 365
  const parts: string[] = []
  if (years > 0) parts.push(`${years} ${years === 1 ? "YEAR" : "YEARS"}`)
  if (remDays > 0 || years === 0) {
    parts.push(`${remDays} ${remDays === 1 ? "DAY" : "DAYS"}`)
  }
  return `${parts.join(" ")} TO GO`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
