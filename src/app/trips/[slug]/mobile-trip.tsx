import type { ReactNode } from "react"
import Link from "next/link"
import { MapPin } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { Bar, Label } from "@/components/together"
import { BoxCard, BoxSection } from "@/components/collapsible-box"
import { FlipCountdown } from "@/components/flip-countdown"
import { MobileHeaderNav, type NavDestination } from "@/components/app-nav"
import { AssistantPill } from "@/components/ai-mode"
import { moneyRounded } from "@/lib/money"
import type { TripHeader } from "@/lib/trips/queries"

export interface MobileTripProps {
  header: TripHeader
  destinations: NavDestination[]
  dateRange: string | null
  dayCount: number
  spentCents: number
  /** Sum of the planned budget lines (buffer excluded). */
  plannedLinesCents: number
  notesCount: number
  /** A note reminder is due: the Notes box turns clay. */
  notesDue: boolean
  itinerary: ReactNode
  budget: ReactNode
  /** The one PackingTab, rendering Packing, then `between`, then Checklist. */
  packingAround: (between: ReactNode) => ReactNode
  documents: ReactNode
  documentsCount: number
  notes: ReactNode
}

/** The phone trip page: a header line (with the one assistant switch), then
 * one collapsible box per section. */
export function MobileTrip(props: MobileTripProps) {
  const { header } = props
  return (
    <div className="flex flex-col gap-4 px-4">
      <MobileHeaderNav
        destinations={props.destinations}
        current="trip"
        center={
          <Link
            href={`/trips/${header.slug}/edit`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Edit trip
          </Link>
        }
      />
      <HeaderLine header={header} />
      <TripCard {...props} />
      <BudgetCard {...props} />
      {props.packingAround(
        <>
          <BoxCard>
            <BoxSection
              summary={<SummaryRow label="Documents" detail={`${props.documentsCount}`} />}
            >
              {props.documents}
            </BoxSection>
          </BoxCard>
          <BoxCard className={props.notesDue ? "border-clay bg-clay-tint" : undefined}>
            <BoxSection
              summary={
                props.notesDue ? (
                  <SummaryRow label="Notes" detail="reminder due" tone="text-clay" />
                ) : (
                  <SummaryRow label="Notes" detail={`${props.notesCount}`} />
                )
              }
            >
              {props.notes}
            </BoxSection>
          </BoxCard>
        </>,
      )}
    </div>
  )
}

function HeaderLine({ header }: { header: TripHeader }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-y border-border py-2">
      <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        <MapPin className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{header.country ?? header.name}</span>
      </span>
      <AssistantPill className="mr-auto shrink-0" />
      {header.startDate ? (
        <FlipCountdown startDate={header.startDate} size="sm" />
      ) : (
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground">
          No dates yet
        </span>
      )}
    </div>
  )
}

function TripCard({ header, dateRange, dayCount, itinerary }: MobileTripProps) {
  const p = header.tripProfile
  const rows = [
    ["Sleeping", p.stay],
    ["Getting around", p.move],
    ["Doing", p.acts],
    ["Eating", p.food],
    ["Avoid", p.avoid],
  ].filter(([, value]) => value)
  const days = header.startDate
    ? `${dayCount} days`
    : dayCount > 0
      ? `${dayCount} days · no dates yet`
      : "no dates yet"
  return (
    <BoxCard>
      <BoxSection
        summary={
          <span className="block py-1 font-serif text-[22px] leading-tight text-foreground">
            {p.idea || header.name}
          </span>
        }
      >
        <div className="flex flex-col gap-2 px-[18px] py-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {dateRange ?? "No dates yet"}
          </span>
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-3 text-[14px] leading-snug">
              <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
              <span className="text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </BoxSection>
      <BoxSection summary={<SummaryRow label="Itinerary" detail={days} />}>
        {itinerary}
      </BoxSection>
    </BoxCard>
  )
}

function BudgetCard({
  header,
  dayCount,
  spentCents,
  plannedLinesCents,
  budget,
}: MobileTripProps) {
  const planned = header.plannedBudgetCents
  const currency = header.homeCurrency
  // The bar measures against the budget, else the planned lines; with neither
  // there is nothing to measure, so no bar and no spent line.
  const target = planned > 0 ? planned : plannedLinesCents
  const pct = target === 0 ? 0 : Math.round((spentCents / target) * 100)
  return (
    <BoxCard>
      <BoxSection
        summary={
          <div className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label>Budget</Label>
              {planned > 0 && dayCount > 0 ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                  about {moneyRounded(planned / dayCount, currency)} a day
                </span>
              ) : null}
            </div>
            <div className="mt-1 font-serif text-[34px] leading-none text-foreground">
              {planned > 0 ? moneyRounded(planned, currency) : "No budget yet"}
            </div>
            {target > 0 ? (
              <>
                <Bar pct={pct} tone="sea" className="mt-3" />
                <div className="mt-1.5 flex justify-between font-mono text-[11px] text-muted-foreground">
                  <span>{moneyRounded(spentCents, currency)} spent</span>
                  <span>{moneyRounded(target - spentCents, currency)} left</span>
                </div>
              </>
            ) : null}
          </div>
        }
      >
        {budget}
      </BoxSection>
    </BoxCard>
  )
}

function SummaryRow({
  label,
  detail,
  tone = "text-muted-foreground",
}: {
  label: string
  detail: string
  tone?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Label>{label}</Label>
      <span className={`font-mono text-[11px] ${tone}`}>{detail}</span>
    </div>
  )
}
