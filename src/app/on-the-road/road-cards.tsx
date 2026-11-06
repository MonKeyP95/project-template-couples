import type { ReactNode } from "react"
import { MapPin } from "lucide-react"

import { Bar, Label } from "@/components/together"
import { BoxCard, BoxSection } from "@/components/collapsible-box"
import { moneyRounded } from "@/lib/money"
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

/** Today's spend against today's share of the budget; opens to the expense form. */
export function MoneyCard({
  spentTodayCents,
  dayBudgetCents,
  currency,
  children,
}: {
  spentTodayCents: number
  /** Today's planned share; null when the trip has no budget estimate. */
  dayBudgetCents: number | null
  currency: string
  children: ReactNode
}) {
  const planned = dayBudgetCents ?? 0
  const over = planned > 0 && spentTodayCents > planned
  const pct = planned > 0 ? Math.round((spentTodayCents / planned) * 100) : 0
  return (
    <BoxCard className="mt-4">
      <BoxSection
        id="road-expense"
        summary={
          <div className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label>Spent today</Label>
              {planned > 0 ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                  of about {moneyRounded(planned, currency)}
                </span>
              ) : null}
            </div>
            <div className="mt-1 font-serif text-[34px] leading-none text-foreground">
              {moneyRounded(spentTodayCents, currency)}
            </div>
            {planned > 0 ? (
              <>
                <Bar pct={pct} tone={over ? "clay" : "sea"} className="mt-3" />
                <div className="mt-1.5 text-right font-mono text-[11px] text-muted-foreground">
                  {moneyRounded(Math.abs(planned - spentTodayCents), currency)}{" "}
                  {over ? "over today" : "left today"}
                </div>
              </>
            ) : null}
          </div>
        }
      >
        {children}
      </BoxSection>
    </BoxCard>
  )
}

/** Today's documents and notes, one collapsible row each. */
export function KeepCard({
  documentsToday,
  notesToday,
  documents,
  notes,
}: {
  documentsToday: number
  notesToday: number
  documents: ReactNode
  notes: ReactNode
}) {
  return (
    <BoxCard className="mt-4">
      <BoxSection summary={<SummaryRow label="Documents" detail={todayCount(documentsToday)} />}>
        {documents}
      </BoxSection>
      <BoxSection summary={<SummaryRow label="Notes" detail={todayCount(notesToday)} />}>
        {notes}
      </BoxSection>
    </BoxCard>
  )
}

function todayCount(n: number): string {
  return n === 0 ? "nothing today" : `${n} today`
}

function SummaryRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Label>{label}</Label>
      <span className="font-mono text-[11px] text-muted-foreground">{detail}</span>
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
