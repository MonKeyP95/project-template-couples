"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

/** Live countdown to local midnight of the trip's start day.
 *  Before the trip: "12D 5H 30M TO GO". On the start day: "TODAY".
 *  Once the trip is underway or past: nothing. */
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
  const [y, m, d] = startDate.split("-").map(Number)
  const target = new Date(y, m - 1, d)
  const now = new Date()
  const diffMs = target.getTime() - now.getTime()

  if (diffMs <= 0) {
    return isSameDay(now, target) ? "TODAY" : null
  }

  const totalMin = Math.floor(diffMs / 60_000)
  const days = Math.floor(totalMin / 1_440)
  const hrs = Math.floor((totalMin % 1_440) / 60)
  const min = totalMin % 60

  const parts: string[] = []
  if (days > 0) parts.push(`${days}D`)
  if (days > 0 || hrs > 0) parts.push(`${hrs}H`)
  parts.push(`${min}M`)
  return `${parts.join(" ")} TO GO`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
