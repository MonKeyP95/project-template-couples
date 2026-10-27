"use client"

import * as React from "react"

export interface DaySelection {
  selected: Set<string>
  /** Mouse press in a day row at (x, y). orderedIds = that location's days in date order. */
  begin: (
    scopeKey: string,
    orderedIds: string[],
    dayId: string,
    shift: boolean,
    x: number,
    y: number,
  ) => void
  clear: () => void
  /** The dashed sweep box; drawn by direct style updates so a sweep doesn't re-render. */
  boxRef: React.RefObject<HTMLDivElement | null>
}

interface Anchor {
  scopeKey: string
  orderedIds: string[]
  id: string
  x: number
  y: number
}

/** A press that starts a selection: inside a day row but not on its card. */
export function inSelectZone(target: Element): boolean {
  return Boolean(target.closest("[data-day-id]")) && !target.closest("[data-day-card]")
}

/** Ids from `fromId` to `toId` inclusive in list order; null if either is missing. */
function rangeIds(orderedIds: string[], fromId: string, toId: string): Set<string> | null {
  const i = orderedIds.indexOf(fromId)
  const j = orderedIds.indexOf(toId)
  if (i === -1 || j === -1) return null
  return new Set(orderedIds.slice(Math.min(i, j), Math.max(i, j) + 1))
}

function sameIds(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}

/** Desktop day selection: press beside a day and sweep (a dashed box follows
 * the mouse), or shift-click a range. Stays within the location the sweep
 * started in. Esc or a click elsewhere clears. */
export function useDaySelection(): DaySelection {
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const anchor = React.useRef<Anchor | null>(null)
  const sweeping = React.useRef(false)
  const boxRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    function endSweep() {
      sweeping.current = false
      if (boxRef.current) boxRef.current.style.display = "none"
    }
    function drawBox(a: Anchor, x: number, y: number) {
      const box = boxRef.current
      if (!box) return
      box.style.display = "block"
      box.style.left = `${Math.min(a.x, x)}px`
      box.style.top = `${Math.min(a.y, y)}px`
      box.style.width = `${Math.abs(x - a.x)}px`
      box.style.height = `${Math.abs(y - a.y)}px`
    }
    function onMove(e: MouseEvent) {
      const a = anchor.current
      if (!sweeping.current || !a) return
      // Released outside the window: no mouseup arrived, so end the sweep here.
      if (e.buttons === 0) return endSweep()
      drawBox(a, e.clientX, e.clientY)
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-day-id]")
      const id = el?.getAttribute("data-day-id")
      const range = id ? rangeIds(a.orderedIds, a.id, id) : null
      if (range) setSelected((prev) => (sameIds(prev, range) ? prev : range))
    }
    function onDown(e: MouseEvent) {
      const target = e.target as Element
      if (inSelectZone(target) || target.closest("[data-selection-tray]")) return
      setSelected((prev) => (prev.size === 0 ? prev : new Set()))
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected((prev) => (prev.size === 0 ? prev : new Set()))
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", endSweep)
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", endSweep)
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [])

  function begin(
    scopeKey: string,
    orderedIds: string[],
    dayId: string,
    shift: boolean,
    x: number,
    y: number,
  ) {
    const a = anchor.current
    if (shift && a && a.scopeKey === scopeKey) {
      const range = rangeIds(orderedIds, a.id, dayId)
      if (range) setSelected(range)
      return
    }
    anchor.current = { scopeKey, orderedIds, id: dayId, x, y }
    sweeping.current = true
    setSelected(new Set([dayId]))
  }

  function clear() {
    setSelected(new Set())
  }

  return { selected, begin, clear, boxRef }
}

/** The dashed box drawn while sweeping; hidden until a sweep moves. */
export function SelectionBox({
  boxRef,
}: {
  boxRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={boxRef}
      aria-hidden
      className="pointer-events-none fixed z-30 hidden rounded-md border border-dashed border-sea bg-sea/10"
    />
  )
}

/** Bottom bar shown while 2+ days are selected. */
export function SelectionTray({
  count,
  onEdit,
  onClear,
}: {
  count: number
  onEdit: () => void
  onClear: () => void
}) {
  return (
    <div
      data-selection-tray
      className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between rounded-xl bg-foreground px-4 py-2.5 text-[13px] text-background shadow-lg"
    >
      <span>
        <b className="font-semibold">{count} days</b> selected
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border-0 bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground"
        >
          Edit together
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="border-0 bg-transparent px-1.5 py-1 font-mono text-[13px] text-background/70 hover:text-background"
        >
          ×
        </button>
      </span>
    </div>
  )
}
