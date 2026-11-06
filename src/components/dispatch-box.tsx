"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { WeatherCard } from "@/components/weather-card"
import { BudgetCard } from "@/components/budget-card"
import { ConditionsCard } from "@/components/conditions-card"
import type { DayConditions } from "@/lib/conditions/get-conditions"
import type { Activity } from "@/lib/conditions/activity"
import type { PeriodCheck } from "@/lib/trips/budget-period"
import { DispatchItemCard } from "@/components/dispatch-item-card"
import type { DispatchDay } from "@/components/add-to-day-form"
import type { Weather } from "@/lib/weather/get-weather"
import type { NewsDay } from "@/lib/trips/dispatch-types"

const ADVANCE_MS = 7000

function emptyNewsText(day: NewsDay): string {
  const when = day.dayLabel.toLowerCase()
  return day.checkedAt === null
    ? `Checking ${when}'s news...`
    : `Nothing notable ${when}.`
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

/** Never changes after mount; the snapshot alone carries the answer. */
const noSubscribe = () => () => {}

/** True only once hydration is done. Lets the client-only deck (random start,
 * timers) mount without the server render disagreeing with it. */
function useIsClient(): boolean {
  return React.useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  )
}

function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION)
      query.addEventListener("change", onChange)
      return () => query.removeEventListener("change", onChange)
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  )
}

/**
 * Which card the box opens on. First visit of the day opens on weather; every
 * later visit that day opens on a random dispatch card, because the timer
 * resets on each load and a weather-first box would otherwise be the only thing
 * short visits ever show. Per-device by design: each partner gets their own
 * first visit. Read-only — the marking happens in an effect.
 */
function pickStart(storageKey: string, count: number): number {
  const seen = window.localStorage.getItem(seenKey(storageKey)) !== null
  if (!seen) return 0
  const pool = count - 1
  return pool > 0 ? 1 + Math.floor(Math.random() * pool) : 0
}

const seenKey = (storageKey: string) => `dispatch-seen:${storageKey}`

/**
 * The one ambient box at the top of /on-the-road: weather first, then the
 * news (today's, plus tomorrow's from the evening on). Rotates itself; pauses
 * whenever the user is hovering or focused inside it. Weather, budget and each
 * news day always hold a card — an empty one keeps its header — so the box
 * never disappears on a no-data day.
 */
export function DispatchBox({
  weather,
  conditions,
  usual,
  news,
  storageKey,
  budget,
  tripId,
  tripSlug,
  days,
  className,
}: {
  weather: Weather | null
  /** Today always (the usual activity when nothing is planned), plus a planned surf or dive tomorrow. */
  conditions: DayConditions[]
  /** Every activity, the couple's most usual first. */
  usual: Activity[]
  news: NewsDay[]
  /** The trip's budget check; null when there is no estimate or no running trip. */
  budget: PeriodCheck | null
  /** Distinguishes one trip-day from another in localStorage. */
  storageKey: string
  tripId: string
  tripSlug: string
  days: DispatchDay[]
  className?: string
}) {
  const isClient = useIsClient()
  const ctx = { tripId, tripSlug, days, budget, news, conditions, usual }

  // Server and hydration render the first card, static and collapsed. The live
  // deck takes over immediately after, which is where the random start is
  // chosen and where a card can be opened.
  if (!isClient) {
    return (
      <Frame
        className={className}
        cards={buildCards(weather, ctx, null, () => {})}
        index={0}
      />
    )
  }
  return (
    <LiveDeck
      weather={weather}
      storageKey={storageKey}
      ctx={ctx}
      className={className}
    />
  )
}

/** What every item card needs to act: the trip and the days it can
 * drop an event on. */
interface CardContext {
  tripId: string
  tripSlug: string
  days: DispatchDay[]
  budget: PeriodCheck | null
  news: NewsDay[]
  conditions: DayConditions[]
  usual: Activity[]
}

/** A news day with no findings: one card naming why. */
function EmptyNewsCard({ day }: { day: NewsDay }) {
  return (
    <EmptyCard
      label={`News · ${day.dayLabel}`}
      text={emptyNewsText(day)}
      checkedAt={day.checkedAt}
    />
  )
}

/** How many deck slots the news takes: each day's items, or one empty card. */
function newsSlots(news: NewsDay[]): number {
  return news.reduce((n, day) => n + Math.max(day.items.length, 1), 0)
}

/** The deck in order: weather, any surf or dive conditions, budget, then each
 * news day's findings (or one empty card per day). Weather and budget are not
 * pressable; conditions and items are. `expanded` is a deck index. */
function buildCards(
  weather: Weather | null,
  ctx: CardContext,
  expanded: number | null,
  onToggle: (deckIndex: number | null) => void,
): React.ReactNode[] {
  const cards: React.ReactNode[] = [
    weather ? (
      <WeatherCard key="weather" weather={weather} />
    ) : (
      <EmptyCard key="weather" label="Weather" text="No forecast for here." />
    ),
    ...ctx.conditions.map((c, i) => (
      <ConditionsCard
        key={`conditions-${c.conditions.dayDate}-${c.conditions.activity}`}
        card={c}
        usual={ctx.usual}
        tripId={ctx.tripId}
        tripSlug={ctx.tripSlug}
        days={ctx.days}
        expanded={expanded === i + 1}
        onToggle={(next) => onToggle(next ? i + 1 : null)}
      />
    )),
    ctx.budget ? (
      <BudgetCard key="budget" check={ctx.budget} />
    ) : (
      <EmptyCard key="budget" label="Budget" text="No budget set for this trip." />
    ),
  ]
  for (const day of ctx.news) {
    if (day.items.length === 0) {
      cards.push(<EmptyNewsCard key={`news-${day.dayDate}`} day={day} />)
      continue
    }
    day.items.forEach((item, i) => {
      const deckIndex = cards.length
      cards.push(
        <DispatchItemCard
          key={`item-${day.dayDate}-${i}`}
          item={item}
          index={i}
          dayDate={day.dayDate}
          dayLabel={day.dayLabel}
          checkedAt={day.checkedAt}
          tripId={ctx.tripId}
          tripSlug={ctx.tripSlug}
          days={ctx.days}
          expanded={expanded === deckIndex}
          onToggle={(next) => onToggle(next ? deckIndex : null)}
        />,
      )
    })
  }
  return cards
}

function LiveDeck({
  weather,
  storageKey,
  ctx,
  className,
}: {
  weather: Weather | null
  storageKey: string
  ctx: CardContext
  className?: string
}) {
  const reduced = useReducedMotion()
  const [index, setIndex] = React.useState(() =>
    pickStart(storageKey, 2 + ctx.conditions.length + newsSlots(ctx.news)),
  )
  const [paused, setPaused] = React.useState(false)
  const [expanded, setExpanded] = React.useState<number | null>(null)
  // Opening a card holds the deck for good, not just while it is open: the
  // reader has a place in it now, and an answer they asked for lives on that
  // card. Resuming on collapse rotates their place away seven seconds later.
  const [held, setHeld] = React.useState(false)
  const toggle = (deckIndex: number | null) => {
    if (deckIndex !== null) setHeld(true)
    setExpanded(deckIndex)
  }
  const cards = buildCards(weather, ctx, expanded, toggle)
  const count = cards.length

  React.useEffect(() => {
    window.localStorage.setItem(seenKey(storageKey), "1")
  }, [storageKey])

  React.useEffect(() => {
    if (count < 2 || paused || reduced || held) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), ADVANCE_MS)
    return () => clearInterval(timer)
  }, [count, paused, reduced, held])

  // The deck grows from one card to several when the findings land and the page
  // refreshes, so a held index can outrun the count it was picked against.
  // Clamping beats resetting: landing on the last card is the least surprising.
  const active = Math.min(index, count - 1)

  return (
    <Frame
      className={className}
      cards={cards}
      index={active}
      onSelect={(i) => {
        setExpanded(null)
        setIndex(i)
      }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    />
  )
}

function Frame({
  cards,
  index,
  onSelect,
  className,
  ...handlers
}: {
  cards: React.ReactNode[]
  index: number
  onSelect?: (i: number) => void
  className?: string
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onFocusCapture?: () => void
  onBlurCapture?: () => void
}) {
  return (
    <div className={className} {...handlers}>
      {/* Every card occupies the same grid cell, so the box is as tall as its
          tallest card and the page never reflows as it rotates. One column
          capped at the box width: an auto column grows to the widest card's
          content and the box clips it. */}
      <div className="grid grid-cols-1">
        {cards.map((card, i) => (
          <div
            key={i}
            className={`col-start-1 row-start-1 ${i === index ? "" : "invisible"}`}
            inert={i !== index}
          >
            {card}
          </div>
        ))}
      </div>
      {cards.length > 1 ? (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          <StepButton
            label="Previous card"
            onClick={() => onSelect?.((index - 1 + cards.length) % cards.length)}
          >
            <ChevronLeft className="size-4" />
          </StepButton>
          {cards.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Show card ${i + 1} of ${cards.length}`}
              aria-current={i === index}
              onClick={() => onSelect?.(i)}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                i === index ? "bg-foreground" : "bg-border"
              }`}
            />
          ))}
          <StepButton
            label="Next card"
            onClick={() => onSelect?.((index + 1) % cards.length)}
          >
            <ChevronRight className="size-4" />
          </StepButton>
        </div>
      ) : null}
    </div>
  )
}

function StepButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </button>
  )
}

/** A deck slot with no data: keeps its header so the feature stays visible. */
function EmptyCard({
  label,
  text,
  checkedAt = null,
}: {
  label: string
  text: string
  checkedAt?: string | null
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-[13px] text-muted-foreground">{text}</div>
      {checkedAt ? (
        <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          checked {checkedAt}
        </div>
      ) : null}
    </div>
  )
}
