"use client"

import * as React from "react"

import { WeatherCard } from "@/components/weather-card"
import {
  DispatchItemCard,
  type DispatchDay,
} from "@/components/dispatch-item-card"
import type { Weather } from "@/lib/weather/get-weather"
import type { DispatchItem } from "@/lib/trips/dispatch-types"

const ADVANCE_MS = 7000
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
function pickStart(
  storageKey: string,
  count: number,
  hasWeather: boolean,
): number {
  const seen = window.localStorage.getItem(seenKey(storageKey)) !== null
  if (!seen) return 0
  const first = hasWeather ? 1 : 0
  const pool = count - first
  return pool > 0 ? first + Math.floor(Math.random() * pool) : 0
}

const seenKey = (storageKey: string) => `dispatch-seen:${storageKey}`

/**
 * The one ambient box at the top of /on-the-road: weather first, then today's
 * dispatch items. Rotates itself; pauses whenever the user is hovering or
 * focused inside it. With a single card it is a plain static card — no dots,
 * no timer — which is the common, quiet-day state.
 */
export function DispatchBox({
  weather,
  items,
  storageKey,
  tripId,
  tripSlug,
  today,
  days,
  className,
}: {
  weather: Weather | null
  items: DispatchItem[]
  /** Distinguishes one trip-day from another in localStorage. */
  storageKey: string
  tripId: string
  tripSlug: string
  today: string
  days: DispatchDay[]
  className?: string
}) {
  const isClient = useIsClient()
  const ctx = { tripId, tripSlug, today, days }

  if (!weather && items.length === 0) return null

  // Server and hydration render the first card, static and collapsed. The live
  // deck takes over immediately after, which is where the random start is
  // chosen and where a card can be opened.
  if (!isClient) {
    return (
      <Frame
        className={className}
        cards={buildCards(weather, items, ctx, null, () => {})}
        index={0}
      />
    )
  }
  return (
    <LiveDeck
      weather={weather}
      items={items}
      storageKey={storageKey}
      ctx={ctx}
      className={className}
    />
  )
}

/** What every item card needs to act: the trip, today, and the days it can
 * drop an event on. */
interface CardContext {
  tripId: string
  tripSlug: string
  today: string
  days: DispatchDay[]
}

/** The deck in order: weather, then today's findings. Weather is not pressable;
 * every item is. `expanded` is a deck index, so the weather offset applies. */
function buildCards(
  weather: Weather | null,
  items: DispatchItem[],
  ctx: CardContext,
  expanded: number | null,
  onToggle: (deckIndex: number | null) => void,
): React.ReactNode[] {
  const offset = weather ? 1 : 0
  return [
    ...(weather ? [<WeatherCard key="weather" weather={weather} />] : []),
    ...items.map((item, i) => (
      <DispatchItemCard
        key={`item-${i}`}
        item={item}
        index={i}
        tripId={ctx.tripId}
        tripSlug={ctx.tripSlug}
        today={ctx.today}
        days={ctx.days}
        expanded={expanded === i + offset}
        onToggle={(next) => onToggle(next ? i + offset : null)}
      />
    )),
  ]
}

function LiveDeck({
  weather,
  items,
  storageKey,
  ctx,
  className,
}: {
  weather: Weather | null
  items: DispatchItem[]
  storageKey: string
  ctx: CardContext
  className?: string
}) {
  const reduced = useReducedMotion()
  const [index, setIndex] = React.useState(() =>
    pickStart(storageKey, (weather ? 1 : 0) + items.length, weather !== null),
  )
  const [paused, setPaused] = React.useState(false)
  const [expanded, setExpanded] = React.useState<number | null>(null)
  const cards = buildCards(weather, items, ctx, expanded, setExpanded)
  const count = cards.length

  React.useEffect(() => {
    window.localStorage.setItem(seenKey(storageKey), "1")
  }, [storageKey])

  // An opened card holds the deck still: the reader is mid-decision on it.
  React.useEffect(() => {
    if (count < 2 || paused || reduced || expanded !== null) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), ADVANCE_MS)
    return () => clearInterval(timer)
  }, [count, paused, reduced, expanded])

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
          tallest card and the page never reflows as it rotates. */}
      <div className="grid">
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
        <div className="mt-2 flex justify-center gap-1.5">
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
        </div>
      ) : null}
    </div>
  )
}
