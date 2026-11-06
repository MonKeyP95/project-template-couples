import { MapPin } from "lucide-react"

import { BoxCard, BoxSection } from "@/components/collapsible-box"
import { daySummary, type ItineraryDay } from "@/lib/trips/itinerary-types"
import type { LookingAhead } from "@/lib/trips/looking-ahead"
import { AddTodayEvent } from "./add-today-event"
import { LookingAheadSection } from "./looking-ahead-panel"
import { TodayNext, TodayUpcoming } from "./today-upcoming"
import { TodayPast } from "./today-past"

/** The thin ruled strip at the top: where we are, and which day of the trip. */
export function RoadHeaderLine({
  place,
  dateLabel,
  dayOfTrip,
  tripDays,
}: {
  place: string | null
  dateLabel: string
  dayOfTrip: number
  tripDays: number
}) {
  return (
    <div className="mb-4 flex min-h-12 items-center justify-between gap-3 border-y border-border py-2">
      <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        <MapPin className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{place}</span>
      </span>
      <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground">
        {dateLabel}
        {tripDays > 0 ? ` · day ${dayOfTrip} / ${tripDays}` : null}
      </span>
    </div>
  )
}

/** Today's plan (open by default) with the look-ahead as a second row. */
export function TodayCard({
  todayDay,
  tripId,
  tripSlug,
  today,
  ahead,
}: {
  todayDay: ItineraryDay | null
  tripId: string
  tripSlug: string
  today: string
  ahead: LookingAhead
}) {
  return (
    <BoxCard className="mt-4">
      <BoxSection
        defaultOpen
        summary={
          <div className="py-1">
            <span className="block font-serif text-[22px] leading-tight text-foreground">
              {todayDay?.title || "Today"}
            </span>
            {todayDay ? <TodayNext events={todayDay.events} /> : null}
          </div>
        }
      >
        <div className="px-[18px] py-3">
          {todayDay ? (
            <>
              {daySummary(todayDay) ? (
                <div className="text-[13px] leading-snug text-muted-foreground">
                  {daySummary(todayDay)}
                </div>
              ) : null}
              <TodayUpcoming events={todayDay.events} />
              <TodayPast tripSlug={tripSlug} dayId={todayDay.id} events={todayDay.events} />
            </>
          ) : (
            <div className="text-[13px] text-muted-foreground">Nothing planned for today.</div>
          )}
          <AddTodayEvent
            tripId={tripId}
            tripSlug={tripSlug}
            dayDate={today}
            dayId={todayDay?.id ?? null}
          />
        </div>
      </BoxSection>
      <LookingAheadSection ahead={ahead} />
    </BoxCard>
  )
}
