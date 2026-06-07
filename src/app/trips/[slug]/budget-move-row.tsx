import type { BudgetMove } from "@/lib/trips/location-budget-types"

const MONTH_SHORT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
})

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

function moveDate(iso: string): { mon: string; day: string } {
  const d = new Date(iso)
  return { mon: MONTH_SHORT.format(d).toUpperCase(), day: String(d.getUTCDate()) }
}

/**
 * Read-only record of a budget move. Two forms:
 * - main ledger (no perspective): "Hokkaido -> Tokyo", muted amount.
 * - per-location (perspectiveLocationId set): signed "+€X from <other>" /
 *   "-€X to <other>".
 */
export function BudgetMoveRow({
  move,
  locationsById,
  perspectiveLocationId,
}: {
  move: BudgetMove
  locationsById: Record<string, string>
  perspectiveLocationId?: string
}) {
  const nameOf = (id: string | null) =>
    id ? locationsById[id] ?? "Unallocated" : "Unallocated"
  const date = moveDate(move.createdAt)

  if (perspectiveLocationId) {
    const incoming = move.toLocationId === perspectiveLocationId
    const other = incoming ? nameOf(move.fromLocationId) : nameOf(move.toLocationId)
    return (
      <div className="flex items-baseline justify-between py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {date.mon} {date.day} · budget {incoming ? `from ${other}` : `to ${other}`}
        </span>
        <span
          className={`t-num text-[12px] ${incoming ? "text-moss" : "text-clay"}`}
        >
          {incoming ? "+" : "−"}€{fmt(move.amountCents)}
        </span>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t border-border px-5 py-3">
      <div className="text-center">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {date.mon}
        </div>
        <div className="font-mono text-[18px] leading-none tracking-[-0.02em] text-foreground">
          {date.day}
        </div>
      </div>
      <div>
        <div className="text-[14px] tracking-[-0.005em] text-foreground">
          {nameOf(move.fromLocationId)} → {nameOf(move.toLocationId)}
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          budget move
        </div>
      </div>
      <div className="t-num text-[15px] text-muted-foreground">
        €{fmt(move.amountCents)}
      </div>
    </div>
  )
}
