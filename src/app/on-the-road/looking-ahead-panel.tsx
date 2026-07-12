import { Label } from "@/components/together"
import { formatEventTime, formatShortDate } from "@/lib/trips/itinerary-types"
import type { LookingAhead } from "@/lib/trips/looking-ahead"

/** Renders the tomorrow + next-move look-ahead. Nothing to show => null. */
export function LookingAheadPanel({ ahead }: { ahead: LookingAhead }) {
  const tomorrowText = ahead.tomorrowEvent
    ? `${formatEventTime(ahead.tomorrowEvent.time, ahead.tomorrowEvent.endTime)} · ${ahead.tomorrowEvent.text}`
    : ahead.tomorrowTitle
  const hasTomorrow = !ahead.collapse && !!tomorrowText
  const hasMove = !!ahead.nextMove
  if (!hasTomorrow && !hasMove) return null

  return (
    <section className="mt-4 rounded-[14px] border border-border bg-card p-5">
      <Label>Looking ahead</Label>
      <div className="mt-3 flex flex-col gap-2">
        {hasTomorrow ? (
          <Line head="tomorrow" body={tomorrowText as string} />
        ) : null}
        {ahead.nextMove ? (
          <Line
            head={
              ahead.nextMove.daysAway === 1
                ? "next move · tomorrow"
                : `next move · in ${ahead.nextMove.daysAway} days`
            }
            body={`${ahead.nextMove.locationName} · ${formatShortDate(
              ahead.nextMove.date,
            )}`}
          />
        ) : null}
      </div>
    </section>
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
