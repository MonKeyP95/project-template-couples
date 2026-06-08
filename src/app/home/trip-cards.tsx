import Link from "next/link"

import {
  Bar,
  Chevron,
  Coord,
  Label,
  MonoBadge,
  TopoBg,
} from "@/components/together"
import { TripCountdown } from "@/components/trip-countdown"
import type { TripListItem } from "@/lib/trips/list-queries"
import { slugToTone, type CardTone } from "@/lib/trips/slug-tone"

const surface: Record<CardTone, string> = {
  sea: "bg-sea-tint",
  clay: "bg-clay-tint",
  moss: "bg-moss-tint",
  sand: "bg-sand-tint",
}

const monoBadgeTone: Record<CardTone, "sea" | "clay" | "moss" | "sand"> = {
  sea: "sea",
  clay: "clay",
  moss: "moss",
  sand: "sand",
}

const SHORT_MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

function formatDayLabel(date: string): string {
  return SHORT_MONTH.format(new Date(date)).toUpperCase()
}

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start || !end) return null
  const startYear = start.slice(0, 4)
  const endYear = end.slice(0, 4)
  // Show the year once when start and end share it; otherwise on both ends.
  const startLabel =
    startYear === endYear
      ? formatDayLabel(start)
      : `${formatDayLabel(start)} ${startYear}`
  return `${startLabel} — ${formatDayLabel(end)} ${endYear}`
}

function formatCoord(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null
  const latStr = `${Math.abs(lat).toFixed(1)}° ${lat < 0 ? "S" : "N"}`
  const lngStr = `${Math.abs(lng).toFixed(1)}° ${lng < 0 ? "W" : "E"}`
  return `${latStr} · ${lngStr}`
}

/**
 * Thin moss progress bar showing saved-so-far against the planned budget.
 * Renders nothing until a budget is set, matching the budget tab's rule.
 */
function SavedBar({ saved, planned }: { saved: number; planned: number }) {
  if (planned <= 0) return null
  const pct = Math.min(100, Math.round((saved / planned) * 100))
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <Bar pct={pct} tone="moss" className="h-0.5 flex-1" />
      <span className="shrink-0 font-mono text-[9px] tracking-[0.06em] text-muted-foreground">
        {pct}% saved
      </span>
    </div>
  )
}

/** Top-of-page hero card. Used for at most one trip per render. */
export function HeroCard({ trip }: { trip: TripListItem }) {
  const tone = slugToTone(trip.slug)
  const coord = formatCoord(trip.lat, trip.lng)
  const dateRange = formatDateRange(trip.startDate, trip.endDate)
  return (
    <Link
      href={`/trips/${trip.slug}`}
      className="block overflow-hidden rounded-[14px] border border-border bg-card shadow-md transition-shadow md:hover:shadow-lg"
    >
      <div
        className={`relative h-[132px] overflow-hidden ${surface[tone]} md:aspect-[16/10] md:h-auto`}
      >
        <TopoBg tone={tone} opacity={0.16} />
        <div className="relative flex h-full flex-col justify-between p-4 md:p-5">
          <div className="flex items-start justify-between">
            {trip.state === "now" ? (
              <MonoBadge tone={monoBadgeTone[tone]}>{"// now"}</MonoBadge>
            ) : (
              <span />
            )}
            {coord ? <Coord>{coord}</Coord> : <span />}
          </div>
          <div>
            <div className="t-display text-[38px] leading-none text-foreground md:text-[44px]">
              <em>{trip.name}</em>
            </div>
            {trip.country ? (
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {trip.country}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="px-4 py-3 md:px-5 md:py-3.5">
        <div className="flex items-center justify-between">
          <div>
            {dateRange ? (
              <div className="flex items-baseline gap-2.5">
                <div className="font-mono text-[11px] tracking-[0.04em] text-foreground">
                  {dateRange}
                </div>
                {trip.startDate ? (
                  <TripCountdown
                    startDate={trip.startDate}
                    className="text-[9px] tracking-[0.12em]"
                  />
                ) : null}
              </div>
            ) : null}
          </div>
          <Chevron />
        </div>
        <SavedBar saved={trip.savedCents} planned={trip.plannedBudgetCents} />
      </div>
    </Link>
  )
}

/** Mid-size card for the "Trips" band (non-hero upcoming). A shorter hero. */
export function TripCard({ trip }: { trip: TripListItem }) {
  const tone = slugToTone(trip.slug)
  const coord = formatCoord(trip.lat, trip.lng)
  const dateRange = formatDateRange(trip.startDate, trip.endDate)
  return (
    <Link
      href={`/trips/${trip.slug}`}
      className="block overflow-hidden rounded-[12px] border border-border bg-card shadow-sm transition-shadow md:hover:shadow-md"
    >
      <div
        className={`relative h-[112px] overflow-hidden ${surface[tone]} md:aspect-[16/10] md:h-auto`}
      >
        <TopoBg tone={tone} opacity={0.14} />
        <div className="relative flex h-full flex-col justify-between p-3.5 md:p-4">
          <div className="flex items-start justify-between">
            {trip.state === "now" ? (
              <MonoBadge tone={monoBadgeTone[tone]}>{"// now"}</MonoBadge>
            ) : (
              <span />
            )}
            {coord ? <Coord>{coord}</Coord> : <span />}
          </div>
          <div>
            <div className="t-display text-[28px] leading-none text-foreground md:text-[32px]">
              <em>{trip.name}</em>
            </div>
            {trip.country ? (
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                {trip.country}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="px-3.5 py-2.5 md:px-4 md:py-3">
        <div className="flex items-center justify-between gap-2">
          {dateRange ? (
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-mono text-[10px] tracking-[0.06em] text-foreground">
                {dateRange}
              </span>
              {trip.startDate ? (
                <TripCountdown
                  startDate={trip.startDate}
                  className="text-[9px] tracking-[0.1em]"
                />
              ) : null}
            </span>
          ) : (
            <span />
          )}
          <Chevron />
        </div>
        <SavedBar saved={trip.savedCents} planned={trip.plannedBudgetCents} />
      </div>
    </Link>
  )
}

/** Compact row used in Past. */
export function CompactRow({
  trip,
  dimmed = false,
}: {
  trip: TripListItem
  dimmed?: boolean
}) {
  const dateRange = formatDateRange(trip.startDate, trip.endDate)
  return (
    <Link
      href={`/trips/${trip.slug}`}
      className={`flex items-center justify-between rounded-[10px] border border-border bg-card px-4 py-3 transition-shadow md:hover:shadow-md ${dimmed ? "opacity-60" : ""}`}
    >
      <div>
        <div className="t-display text-[18px] leading-tight text-foreground">
          <em>{trip.name}</em>
        </div>
        {trip.country ? (
          <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            {trip.country}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2.5">
        {dateRange ? (
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {dateRange}
          </span>
        ) : null}
        <Chevron />
      </div>
    </Link>
  )
}

/** Dream tile — square on mobile (2-col) and tall on desktop (4-col). */
export function DreamTile({ trip }: { trip: TripListItem }) {
  const tone = slugToTone(trip.slug)
  const labelText = (trip.fuzzyWhen ?? "someday").toUpperCase()
  return (
    <Link
      href={`/trips/${trip.slug}`}
      className={`relative flex aspect-square flex-col justify-between overflow-hidden rounded-[10px] border border-border p-3 transition-shadow md:aspect-[4/5] md:p-4 md:hover:shadow-md ${surface[tone]}`}
    >
      <TopoBg tone={tone} opacity={0.1} />
      <Label className="relative">{`// dream`}</Label>
      <div className="relative">
        <div className="t-display text-[20px] text-foreground md:text-[26px]">
          <em>{trip.name}</em>
        </div>
        <Coord>{labelText}</Coord>
        <SavedBar saved={trip.savedCents} planned={trip.plannedBudgetCents} />
      </div>
    </Link>
  )
}
