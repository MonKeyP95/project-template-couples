"use client"

import { useEffect, useRef, useState } from "react"

import { remainingUnits, type Remaining } from "@/lib/countdown"
import { cn } from "@/lib/utils"

/** Split-flap countdown to the trip's start day. Four tiles when the trip is a
 *  calendar month or more away, three when it is closer. Renders nothing once
 *  the trip has started. */
export function FlipCountdown({
  startDate,
  size,
  className,
}: {
  startDate: string
  size: "lg" | "sm"
  className?: string
}) {
  // Starts null so the server renders nothing and the clock cannot mismatch on
  // hydration; the first tick fills it in.
  const [units, setUnits] = useState<Remaining | null>(null)

  useEffect(() => {
    const tick = () =>
      setUnits((prev) => {
        const next = remainingUnits(startDate, new Date())
        return sameUnits(prev, next) ? prev : next
      })
    tick()
    const id = setInterval(tick, 1_000)
    return () => clearInterval(id)
  }, [startDate])

  if (!units) return null

  const tiles = [
    ...(units.months > 0
      ? [{ key: "mon", label: "MON", value: pad(units.months) }]
      : []),
    { key: "days", label: "DAYS", value: pad(units.days) },
    { key: "hrs", label: "HRS", value: pad(units.hours) },
    { key: "min", label: "MIN", value: pad(units.minutes) },
  ]

  return (
    <div className={cn("flip-row", size === "lg" ? "flip-lg" : "flip-sm", className)}>
      {tiles.map((tile) => (
        <div key={tile.key} className="flip-unit">
          <FlipTile value={tile.value} />
          <div
            className={cn(
              "font-mono uppercase tracking-[0.22em] text-muted-foreground",
              size === "lg" ? "text-[10px]" : "text-[8px]",
            )}
          >
            {tile.label}
          </div>
        </div>
      ))}
    </div>
  )
}

/** One tile. Holds the outgoing value while the leaves animate; the unfold
 *  leaf's animationend clears it. */
function FlipTile({ value }: { value: string }) {
  const [prev, setPrev] = useState<string | null>(null)
  const settled = useRef(value)

  useEffect(() => {
    if (settled.current === value) return
    setPrev(settled.current)
    settled.current = value
  }, [value])

  return (
    <div className="flip-tile">
      <div className="flip-half flip-half-top">
        <span className="flip-glyph">{value}</span>
      </div>
      <div className="flip-half flip-half-bottom">
        <span className="flip-glyph">{prev ?? value}</span>
      </div>
      {prev !== null ? (
        <>
          <div className="flip-leaf flip-leaf-fold">
            <span className="flip-glyph">{prev}</span>
          </div>
          <div
            className="flip-leaf flip-leaf-unfold"
            onAnimationEnd={() => setPrev(null)}
          >
            <span className="flip-glyph">{value}</span>
          </div>
        </>
      ) : null}
      <div className="flip-hinge" />
    </div>
  )
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function sameUnits(a: Remaining | null, b: Remaining | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.months === b.months &&
    a.days === b.days &&
    a.hours === b.hours &&
    a.minutes === b.minutes
  )
}
