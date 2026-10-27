"use client"

import * as React from "react"

export interface DaySelection {
  selected: Set<string>
  /** Mouse-down on a day number. orderedIds = that location's days in date order. */
  begin: (scopeKey: string, orderedIds: string[], dayId: string, shift: boolean) => void
  clear: () => void
}

interface Anchor {
  scopeKey: string
  orderedIds: string[]
  id: string
}

/** Ids from `fromId` to `toId` inclusive in list order; null if either is missing. */
function rangeIds(orderedIds: string[], fromId: string, toId: string): Set<string> | null {
  const i = orderedIds.indexOf(fromId)
  const j = orderedIds.indexOf(toId)
  if (i === -1 || j === -1) return null
  return new Set(orderedIds.slice(Math.min(i, j), Math.max(i, j) + 1))
}

/** Desktop day selection: sweep down the day numbers, or shift-click a range.
 * Stays within the location the sweep started in. Esc or a click elsewhere clears. */
export function useDaySelection(): DaySelection {
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const anchor = React.useRef<Anchor | null>(null)
  const sweeping = React.useRef(false)

  React.useEffect(() => {
    function onMove(e: MouseEvent) {
      const a = anchor.current
      if (!sweeping.current || !a) return
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-day-id]")
      const id = el?.getAttribute("data-day-id")
      const range = id ? rangeIds(a.orderedIds, a.id, id) : null
      if (range) setSelected(range)
    }
    function onUp() {
      sweeping.current = false
    }
    function onDown(e: MouseEvent) {
      const target = e.target as Element
      if (target.closest("[data-day-number],[data-selection-tray]")) return
      setSelected((prev) => (prev.size === 0 ? prev : new Set()))
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected((prev) => (prev.size === 0 ? prev : new Set()))
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [])

  function begin(scopeKey: string, orderedIds: string[], dayId: string, shift: boolean) {
    const a = anchor.current
    if (shift && a && a.scopeKey === scopeKey) {
      const range = rangeIds(orderedIds, a.id, dayId)
      if (range) setSelected(range)
      return
    }
    anchor.current = { scopeKey, orderedIds, id: dayId }
    sweeping.current = true
    setSelected(new Set([dayId]))
  }

  function clear() {
    setSelected(new Set())
  }

  return { selected, begin, clear }
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
