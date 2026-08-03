"use client"

import * as React from "react"

import { WeatherCard } from "@/components/weather-card"
import type { Weather } from "@/lib/weather/get-weather"
import {
  DISPATCH_KIND_LABEL,
  type DispatchItem,
} from "@/lib/trips/dispatch-types"

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
  className,
}: {
  weather: Weather | null
  items: DispatchItem[]
  /** Distinguishes one trip-day from another in localStorage. */
  storageKey: string
  className?: string
}) {
  const isClient = useIsClient()

  const cards: React.ReactNode[] = [
    ...(weather ? [<WeatherCard key="weather" weather={weather} />] : []),
    ...items.map((item, i) => <ItemCard key={`item-${i}`} item={item} />),
  ]
  if (cards.length === 0) return null

  // Server and hydration render the first card, static. The live deck takes
  // over immediately after, which is where the random start is chosen.
  if (!isClient) {
    return <Frame className={className} cards={cards} index={0} />
  }
  return (
    <LiveDeck
      cards={cards}
      storageKey={storageKey}
      hasWeather={weather !== null}
      className={className}
    />
  )
}

function LiveDeck({
  cards,
  storageKey,
  hasWeather,
  className,
}: {
  cards: React.ReactNode[]
  storageKey: string
  hasWeather: boolean
  className?: string
}) {
  const reduced = useReducedMotion()
  const count = cards.length
  const [index, setIndex] = React.useState(() =>
    pickStart(storageKey, count, hasWeather),
  )
  const [paused, setPaused] = React.useState(false)

  React.useEffect(() => {
    window.localStorage.setItem(seenKey(storageKey), "1")
  }, [storageKey])

  React.useEffect(() => {
    if (count < 2 || paused || reduced) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), ADVANCE_MS)
    return () => clearInterval(timer)
  }, [count, paused, reduced])

  return (
    <Frame
      className={className}
      cards={cards}
      index={index}
      onSelect={setIndex}
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

function ItemCard({ item }: { item: DispatchItem }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {DISPATCH_KIND_LABEL[item.kind]}
      </div>
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-1 block text-[13px] text-foreground underline-offset-2 hover:underline"
      >
        {item.title}
      </a>
      <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
        {item.body}
      </div>
      <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {item.window}
      </div>
    </div>
  )
}
