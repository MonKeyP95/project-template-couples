import type { ReactNode } from "react"
import Link from "next/link"
import { MapPin } from "lucide-react"

import { Bar, Label } from "@/components/together"
import { BoxCard, BoxSection } from "@/components/collapsible-box"
import { FlipCountdown } from "@/components/flip-countdown"
import { MobileHeaderNav, type NavDestination } from "@/components/app-nav"
import { moneyRounded } from "@/lib/money"
import type { TripHeader } from "@/lib/trips/queries"

export interface MobileTripProps {
  header: TripHeader
  destinations: NavDestination[]
  dateRange: string | null
  dayCount: number
  spentCents: number
  notesCount: number
  itinerary: ReactNode
  budget: ReactNode
  /** The one PackingTab, rendering Packing, then `between`, then Checklist. */
  packingAround: (between: ReactNode) => ReactNode
  documents: ReactNode
  documentsCount: number
  notes: ReactNode
}

/** The phone trip page: a header line, then one collapsible box per section. */
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
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            {"// edit trip"}
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
          <BoxCard>
            <BoxSection
              summary={<SummaryRow label="Notes" detail={`${props.notesCount}`} />}
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
    ["Vibe", [...p.vibe, p.vibeNote].filter(Boolean).join(", ")],
    ["Getting around", p.transport.join(", ")],
    ["Avoid", p.avoid],
  ].filter(([, value]) => value)
  const days = header.startDate ? `${dayCount} days` : "no dates yet"
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

function BudgetCard({ header, dayCount, spentCents, budget }: MobileTripProps) {
  const planned = header.plannedBudgetCents
  const currency = header.homeCurrency
  const pct = planned === 0 ? 0 : Math.round((spentCents / planned) * 100)
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
            <Bar pct={pct} tone="sea" className="mt-3" />
            <div className="mt-1.5 flex justify-between font-mono text-[11px] text-muted-foreground">
              <span>{moneyRounded(spentCents, currency)} spent</span>
              {planned > 0 ? (
                <span>{moneyRounded(planned - spentCents, currency)} left</span>
              ) : null}
            </div>
          </div>
        }
      >
        {budget}
      </BoxSection>
    </BoxCard>
  )
}

function SummaryRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Label>{label}</Label>
      <span className="font-mono text-[11px] text-muted-foreground">{detail}</span>
    </div>
  )
}
