import React from "react"
import Link from "next/link"
import { CloudIcon, CloudRainIcon, CloudSnowIcon, SunIcon } from "lucide-react"

import {
  Bar,
  Chevron,
  Coord,
  MonoBadge,
  TopoBg,
} from "@/components/together"
import { FlipCountdown } from "@/components/flip-countdown"
import { moneyRounded } from "@/lib/money"
import type { TripListItem } from "@/lib/trips/list-queries"
import { slugToTone, type CardTone } from "@/lib/trips/slug-tone"
import { type Weather } from "@/lib/weather/get-weather"
import { getTripWeather } from "@/lib/weather/get-trip-weather"
import { daySummary, type ItineraryDay } from "@/lib/trips/itinerary-types"
import { TodayNextEvent } from "./today-next-event"

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

/** One thin bar with its amount-of-budget figure and percentage label. */
function MiniBar({
  amount,
  planned,
  tone,
  label,
  currency,
}: {
  amount: number
  planned: number
  tone: "sea" | "moss"
  label: string
  currency: string
}) {
  const pct = Math.min(100, Math.round((amount / planned) * 100))
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 font-mono text-[9px] tracking-[0.06em] text-foreground">
        {moneyRounded(amount, currency)} / {moneyRounded(planned, currency)}
      </span>
      <Bar pct={pct} tone={tone} className="h-0.5 flex-1" />
      <span className="shrink-0 font-mono text-[9px] tracking-[0.06em] text-muted-foreground">
        {pct}% {label}
      </span>
    </div>
  )
}

/**
 * Spent-against-budget over saved-against-budget. Renders nothing until a
 * budget is set, matching the budget tab's rule.
 */
function BudgetBars({
  spent,
  saved,
  planned,
  currency,
}: {
  spent: number
  saved: number
  planned: number
  currency: string
}) {
  if (planned <= 0) return null
  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      <MiniBar amount={spent} planned={planned} tone="sea" label="spent" currency={currency} />
      <MiniBar amount={saved} planned={planned} tone="moss" label="saved" currency={currency} />
    </div>
  )
}

/** Maps a WMO weather code to one of four condition icons. */
function weatherIcon(code: number) {
  if (code >= 71 && code <= 77) return CloudSnowIcon
  if (code === 85 || code === 86) return CloudSnowIcon
  if (code >= 51 && code <= 67) return CloudRainIcon
  if (code >= 80 && code <= 82) return CloudRainIcon
  if (code >= 95) return CloudRainIcon
  if (code === 0) return SunIcon
  return CloudIcon
}

/** Condition icon + current temperature, shown top-left on the hero card. */
function WeatherBadge({ tempC, code }: Weather) {
  return (
    <span className="flex items-center gap-1 font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
      {React.createElement(weatherIcon(code), { className: "h-3 w-3", strokeWidth: 2 })}
      {Math.round(tempC)}°
    </span>
  )
}

/** Top-of-page hero card. Used for at most one trip per render. */
export async function HeroCard({
  trip,
  today,
}: {
  trip: TripListItem
  today?: ItineraryDay | null
}) {
  const tone = slugToTone(trip.slug)
  const coord = formatCoord(trip.lat, trip.lng)
  const dateRange = formatDateRange(trip.startDate, trip.endDate)
  const weather = await getTripWeather(trip)
  return (
    <Link
      href={`/trips/${trip.slug}`}
      className="block overflow-hidden rounded-[14px] border border-border bg-card shadow-md transition-shadow md:hover:shadow-lg"
    >
      <div
        className={`relative overflow-hidden ${surface[tone]} ${
          today ? "min-h-[104px] md:min-h-[150px]" : "min-h-[132px] md:min-h-[180px]"
        }`}
      >
        <TopoBg tone={tone} opacity={0.16} />
        <div className="relative flex h-full flex-col justify-between p-4 md:p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              {trip.state === "now" ? (
                <MonoBadge tone={monoBadgeTone[tone]}>{"// now"}</MonoBadge>
              ) : null}
              {weather ? <WeatherBadge {...weather} /> : null}
            </div>
            {coord ? <Coord>{coord}</Coord> : <span />}
          </div>
          <div>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <div
                className={`t-display leading-none text-foreground ${
                  today ? "text-[32px] md:text-[36px]" : "text-[38px] md:text-[44px]"
                }`}
              >
                <em>{trip.name}</em>
              </div>
              {trip.startDate ? (
                <FlipCountdown
                  startDate={trip.startDate}
                  size="sm"
                  className="shrink-0"
                />
              ) : null}
            </div>
            {trip.country ? (
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {trip.country}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className={`px-4 md:px-5 ${today ? "py-4 md:py-5" : "py-3 md:py-3.5"}`}>
        {today ? (
          <div className="mb-3">
            {today.title ? (
              <div className="t-display text-[24px] leading-tight text-foreground md:text-[28px]">
                {today.title}
              </div>
            ) : null}
            {daySummary(today) ? (
              <div className="mt-1 text-[13px] leading-snug text-muted-foreground">
                {daySummary(today)}
              </div>
            ) : null}
            <TodayNextEvent events={today.events} />
          </div>
        ) : null}
        <div className="flex items-center justify-between">
          <div>
            {dateRange ? (
              <div className="font-mono text-[11px] tracking-[0.04em] text-foreground">
                {dateRange}
              </div>
            ) : null}
          </div>
          <Chevron />
        </div>
        <BudgetBars
          spent={trip.spentCents}
          saved={trip.savedCents}
          planned={trip.plannedBudgetCents}
          currency={trip.currency}
        />
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
        className={`relative min-h-[112px] overflow-hidden ${surface[tone]} md:aspect-[16/10] md:h-auto`}
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
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
              <div className="t-display text-[28px] leading-none text-foreground md:text-[32px]">
                <em>{trip.name}</em>
              </div>
              {trip.startDate ? (
                <FlipCountdown
                  startDate={trip.startDate}
                  size="sm"
                  className="shrink-0"
                />
              ) : null}
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
            <span className="font-mono text-[10px] tracking-[0.06em] text-foreground">
              {dateRange}
            </span>
          ) : (
            <span />
          )}
          <Chevron />
        </div>
        <BudgetBars
          spent={trip.spentCents}
          saved={trip.savedCents}
          planned={trip.plannedBudgetCents}
          currency={trip.currency}
        />
      </div>
    </Link>
  )
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

/** One-line past trip: name and the month it started. */
export function PastChip({ trip }: { trip: TripListItem }) {
  return (
    <Link
      href={`/trips/${trip.slug}`}
      className="flex shrink-0 snap-start items-baseline gap-3.5 rounded-[10px] border border-border bg-card px-3.5 py-2.5 opacity-60 transition-opacity hover:opacity-100"
    >
      <span className="t-display text-[18px] leading-none text-foreground">
        <em>{trip.name}</em>
      </span>
      {trip.startDate ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
          {MONTH_YEAR.format(new Date(trip.startDate))}
        </span>
      ) : null}
    </Link>
  )
}

/** Saving and budget for a dream tile, whichever of the two exists. */
function dreamMoney(trip: TripListItem): string {
  const saved = moneyRounded(trip.savedCents, trip.currency)
  const budget = moneyRounded(trip.plannedBudgetCents, trip.currency)
  if (trip.plannedBudgetCents > 0) return `${saved} saved of ${budget}`
  if (trip.savedCents > 0) return `${saved} saved · no budget yet`
  return "no budget yet"
}

/** Three-line dream tile on the trip's tint: name and fuzzy "when", the
 * country, then saving and budget. */
export function DreamTile({ trip }: { trip: TripListItem }) {
  const tone = slugToTone(trip.slug)
  const money = dreamMoney(trip)
  return (
    <Link
      href={`/trips/${trip.slug}`}
      className={`flex min-w-[150px] shrink-0 snap-start flex-col gap-1.5 rounded-[10px] border border-border px-3.5 py-2.5 transition-shadow md:hover:shadow-md ${surface[tone]}`}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="t-display text-[20px] leading-none text-foreground">
          <em>{trip.name}</em>
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          {trip.fuzzyWhen ?? "someday"}
        </span>
      </span>
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {trip.country ?? "no place yet"}
      </span>
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-foreground">
        {money}
      </span>
    </Link>
  )
}
