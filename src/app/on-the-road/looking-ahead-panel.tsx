import { Label } from "@/components/together"
import { BoxSection } from "@/components/collapsible-box"
import { formatEventTime, formatShortDate } from "@/lib/trips/itinerary-types"
import type { LookingAhead } from "@/lib/trips/looking-ahead"

/** "10:00 · Museum", "Museum" when untimed, else the day's title. */
function plannedText(next: NonNullable<LookingAhead["nextPlanned"]>): string {
  if (!next.event) return next.title
  const time = formatEventTime(next.event.time, next.event.endTime)
  return time ? `${time} · ${next.event.text}` : next.event.text
}

/** The next-planned + next-move look-ahead as one collapsible row. Nothing to show => null. */
export function LookingAheadSection({ ahead }: { ahead: LookingAhead }) {
  const next = !ahead.collapse ? ahead.nextPlanned : null
  const move = ahead.nextMove
  if (!next && !move) return null

  const lines: [string, string][] = []
  if (next) {
    lines.push([next.daysAway === 1 ? "tomorrow" : next.label, plannedText(next)])
  }
  if (move) {
    lines.push([
      move.daysAway === 1 ? "next move · tomorrow" : `next move · in ${move.daysAway} days`,
      `${move.locationName} · ${formatShortDate(move.date)}`,
    ])
  }
  const [head, body] = lines[0]

  return (
    <BoxSection
      summary={
        <div className="flex items-baseline justify-between gap-3">
          <Label>Looking ahead</Label>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {head} · {body}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-2 px-[18px] py-3">
        {lines.map(([h, b]) => (
          <Line key={h} head={h} body={b} />
        ))}
      </div>
    </BoxSection>
  )
}

function Line({ head, body }: { head: string; body: string }) {
  return (
    <div className="font-mono text-[12.5px] tracking-[0.04em] text-muted-foreground">
      <span className="uppercase tracking-[0.14em] text-foreground/70">
        {head}
      </span>{" "}
      <span className="text-foreground">{body}</span>
    </div>
  )
}
