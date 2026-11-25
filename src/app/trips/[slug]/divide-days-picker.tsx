"use client"

const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"]

export interface DivideDaysPickerProps {
  /** The trip's days (yyyy-mm-dd); only these can be picked. */
  dates: string[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled: boolean
}

/** Month grids (Monday first) of the trip's days, each a toggle. */
export function DivideDaysPicker({
  dates,
  selected,
  onChange,
  disabled,
}: DivideDaysPickerProps) {
  const picked = new Set(selected)

  function toggle(date: string) {
    const next = new Set(picked)
    if (next.has(date)) next.delete(date)
    else next.add(date)
    onChange([...next].sort())
  }

  return (
    <div className="mt-3 rounded-lg border border-border px-3 py-3">
      {groupByMonth(dates).map(([month, monthDates]) => (
        <div key={month} className="mb-3 last:mb-0">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {MONTH.format(new Date(`${month}-01T00:00:00Z`))}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((d, i) => (
              <span key={i} className="font-mono text-[9px] text-muted-foreground/70">
                {d}
              </span>
            ))}
            {monthCells(month, monthDates).map((cell, i) =>
              cell === null ? (
                <span key={i} />
              ) : !cell.inTrip ? (
                <span key={cell.date} className="t-num py-1 text-[12px] text-muted-foreground/40">
                  {Number(cell.date.slice(8))}
                </span>
              ) : (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => toggle(cell.date)}
                  disabled={disabled}
                  aria-pressed={picked.has(cell.date)}
                  className={`t-num rounded-full py-1 text-[12px] transition-colors ${
                    picked.has(cell.date)
                      ? "bg-sea text-background"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  {Number(cell.date.slice(8))}
                </button>
              ),
            )}
          </div>
        </div>
      ))}
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em]">
        <span className="text-muted-foreground">{selected.length} days</span>
        <span className="flex gap-3">
          <button
            type="button"
            onClick={() => onChange([...dates].sort())}
            disabled={disabled}
            className="text-sea hover:text-foreground"
          >
            all
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={disabled}
            className="text-muted-foreground hover:text-foreground"
          >
            none
          </button>
        </span>
      </div>
    </div>
  )
}

/** [yyyy-mm, its dates] in date order. */
function groupByMonth(dates: string[]): [string, string[]][] {
  const months = new Map<string, string[]>()
  for (const date of [...dates].sort()) {
    const month = date.slice(0, 7)
    months.set(month, [...(months.get(month) ?? []), date])
  }
  return [...months]
}

type Cell = { date: string; inTrip: boolean } | null

/** A month's grid cells: null padding to Monday, then every day of the month,
 * flagged when it is one of `monthDates`. */
function monthCells(month: string, monthDates: string[]): Cell[] {
  const first = new Date(`${month}-01T00:00:00Z`)
  const lead = (first.getUTCDay() + 6) % 7
  const daysInMonth = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate()
  const inTrip = new Set(monthDates)
  const cells: Cell[] = Array(lead).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`
    cells.push({ date, inTrip: inTrip.has(date) })
  }
  return cells
}
