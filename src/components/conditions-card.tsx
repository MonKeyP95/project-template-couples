"use client"

import * as React from "react"

import { AddToDayForm, type DispatchDay } from "@/components/add-to-day-form"
import type { Activity } from "@/lib/conditions/activity"
import type {
  Conditions,
  ConditionsSlot,
  DayConditions,
} from "@/lib/conditions/get-conditions"
import {
  conditionsAt,
  findPlacesNear,
  type NearbyPlace,
} from "@/lib/conditions/conditions-actions"

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]

/** 8-point compass name for a "comes from" bearing. */
function compass(deg: number | null): string {
  return deg == null ? "-" : COMPASS[Math.round(deg / 45) % 8]
}

const num = (v: number | null, digits: number, unit: string) =>
  v == null ? "-" : `${v.toFixed(digits)}${unit}`

const ACTIVITIES: Activity[] = ["surf", "dive"]

const TITLE: Record<Activity, string> = { surf: "Surf", dive: "Dive" }

/** What lands on the itinerary when an activity is added from the card. */
const EVENT_TEXT: Record<Activity, string> = { surf: "Surfing", dive: "Diving" }

const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"

/**
 * Surf or dive conditions for one day: a compact row that taps open into three
 * times of day plus tide, the place checked, a Surf / Dive switch and a box to
 * check another place. With nothing planned it opens on the switch alone.
 * Checking an activity the plan does not name offers to add it. Numbers only,
 * no verdicts -- what makes a good day depends on the spot. Tide and current
 * are model output, so labelled approximate.
 */
export function ConditionsCard({
  card,
  tripId,
  tripSlug,
  days,
  expanded,
  onToggle,
}: {
  card: DayConditions
  tripId: string
  tripSlug: string
  days: DispatchDay[]
  expanded: boolean
  onToggle: (next: boolean) => void
}) {
  const c = card.conditions
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => onToggle(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5"
      >
        <span className="flex items-baseline gap-2">
          <span className={LABEL}>
            {c ? TITLE[c.activity] : "Conditions"} · {card.dayLabel}
          </span>
          {expanded ? null : (
            <span className="t-num text-[13px] text-foreground">
              {c ? summaryText(c) : "Check surf or dive"}
            </span>
          )}
        </span>
        <span
          aria-hidden
          className={`font-mono text-[12px] text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          ›
        </span>
      </button>
      {expanded ? (
        <OpenBody card={card} tripId={tripId} tripSlug={tripSlug} days={days} />
      ) : null}
    </div>
  )
}

function summaryText(c: Conditions): string {
  const first = c.slots[0]
  return c.activity === "surf" ? swellText(first) : `Waves ${num(first.waveM, 1, " m")}`
}

/** The opened card. Its own component so a switched activity or looked-up
 * place is forgotten when the card closes: unmounting is the reset. */
function OpenBody({
  card,
  tripId,
  tripSlug,
  days,
}: {
  card: DayConditions
  tripId: string
  tripSlug: string
  days: DispatchDay[]
}) {
  const [shown, setShown] = React.useState(card.conditions)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const place = shown?.place ?? card.place

  const switchTo = (activity: Activity) => {
    startTransition(async () => {
      const result = await conditionsAt(activity, place, card.dayDate)
      setError(result ? null : "No forecast for there.")
      if (result) setShown(result)
    })
  }

  return (
    <div className="border-t border-border px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-foreground">{place.fullName}</span>
        {shown !== card.conditions ? (
          <button
            type="button"
            onClick={() => setShown(card.conditions)}
            className="font-mono text-[10px] text-muted-foreground underline underline-offset-2"
          >
            {card.conditions ? "back to plan" : "back"}
          </button>
        ) : null}
      </div>
      <ActivitySwitch
        active={shown?.activity ?? null}
        pending={pending}
        onPick={switchTo}
      />
      {error ? <div className="mt-2 text-[12px] text-muted-foreground">{error}</div> : null}
      {shown ? (
        <>
          <div className="mt-2">
            <SlotTable conditions={shown} />
          </div>
          <div className="mt-3 space-y-1 border-t border-border pt-3">
            <Line label="Tide approx." value={tideText(shown)} />
            {shown.activity === "surf" ? null : (
              <>
                <Line label="Water" value={num(shown.waterC, 0, "°")} />
                <Line label="Rain, last 3 days" value={num(shown.rainMm3d, 0, " mm")} />
              </>
            )}
          </div>
          {card.planned.includes(shown.activity) ? null : (
            <AddToPlan
              key={shown.activity}
              activity={shown.activity}
              dayDate={card.dayDate}
              tripId={tripId}
              tripSlug={tripSlug}
              days={days}
            />
          )}
          <PlaceLookup shown={shown} onPick={setShown} />
        </>
      ) : null}
    </div>
  )
}

/** Surf / Dive buttons; tapping the other one fetches it for the same place. */
function ActivitySwitch({
  active,
  pending,
  onPick,
}: {
  active: Activity | null
  pending: boolean
  onPick: (activity: Activity) => void
}) {
  return (
    <div className="mt-2 flex gap-1.5">
      {ACTIVITIES.map((a) => (
        <button
          key={a}
          type="button"
          disabled={pending || a === active}
          aria-pressed={a === active}
          onClick={() => onPick(a)}
          className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] disabled:cursor-default ${
            a === active
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
          }`}
        >
          {TITLE[a]}
        </button>
      ))}
    </div>
  )
}

/** Asks before adding: the form opens only on yes. */
function AddToPlan({
  activity,
  dayDate,
  tripId,
  tripSlug,
  days,
}: {
  activity: Activity
  dayDate: string
  tripId: string
  tripSlug: string
  days: DispatchDay[]
}) {
  const [step, setStep] = React.useState<"ask" | "form" | "added" | "no">("ask")
  if (step === "no") return null
  return (
    <div className="mt-3 border-t border-border pt-3">
      {step === "ask" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-foreground">
            Add {EVENT_TEXT[activity].toLowerCase()} to the plan?
          </span>
          <button
            type="button"
            onClick={() => setStep("form")}
            className="rounded-full border-0 bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
          >
            yes
          </button>
          <button
            type="button"
            onClick={() => setStep("no")}
            className="rounded-full border border-rule px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          >
            no
          </button>
        </div>
      ) : step === "form" ? (
        <AddToDayForm
          tripId={tripId}
          tripSlug={tripSlug}
          days={days}
          defaultDate={dayDate}
          text={EVENT_TEXT[activity]}
          category="Activities"
          onAdded={() => setStep("added")}
          onCancel={() => setStep("ask")}
        />
      ) : (
        <span className="rounded-full bg-foreground/40 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background">
          added
        </span>
      )}
    </div>
  )
}

/** Type a place, pick one of the nearest matches, see the same activity there. */
function PlaceLookup({
  shown,
  onPick,
}: {
  shown: Conditions
  onPick: (conditions: Conditions) => void
}) {
  const [query, setQuery] = React.useState("")
  const [matches, setMatches] = React.useState<NearbyPlace[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const found = await findPlacesNear(query, shown.place)
      setMatches(found)
      setError(found.length === 0 ? "No place by that name." : null)
    })
  }

  const pick = (place: NearbyPlace) => {
    startTransition(async () => {
      const result = await conditionsAt(shown.activity, place, shown.dayDate)
      if (!result) {
        setError("No forecast for there.")
        return
      }
      onPick(result)
      setMatches(null)
      setQuery("")
      setError(null)
    })
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <form onSubmit={search} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Check another place"
          aria-label="Check another place"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground"
        />
        <button
          type="submit"
          disabled={pending || !query.trim()}
          className="rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground disabled:opacity-50"
        >
          {pending ? "..." : "check"}
        </button>
      </form>
      {matches && matches.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {matches.map((m) => (
            <li key={`${m.lat},${m.lng}`}>
              <button
                type="button"
                disabled={pending}
                onClick={() => pick(m)}
                className="w-full text-left text-[12px] text-foreground hover:underline"
              >
                {m.fullName}{" "}
                <span className="t-num text-muted-foreground">
                  · {Math.round(m.distanceKm)} km
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <div className="mt-2 text-[12px] text-muted-foreground">{error}</div> : null}
    </div>
  )
}

function swellText(slot: ConditionsSlot): string {
  return `${num(slot.swellM, 1, " m")} · ${num(slot.swellPeriodS, 0, " s")} · ${compass(slot.swellDirDeg)}`
}

function windText(slot: ConditionsSlot): string {
  return `${compass(slot.windDirDeg)} ${num(slot.windKph, 0, " km/h")}`
}

function tideText(conditions: Conditions): string {
  if (conditions.tides.length === 0) return "-"
  return conditions.tides
    .map((t) => `${t.kind === "high" ? "High" : "Low"} ${t.time}`)
    .join(" · ")
}

function SlotTable({ conditions }: { conditions: Conditions }) {
  const surf = conditions.activity === "surf"
  const headers = surf ? ["Swell", "Wind"] : ["Waves", "Wind", "Current approx."]
  return (
    <table className="w-full text-left">
      <thead>
        <tr className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          <th className="pb-1 font-normal" />
          {headers.map((h) => (
            <th key={h} className="pb-1 font-normal">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="t-num text-[12px] text-foreground">
        {conditions.slots.map((slot) => (
          <tr key={slot.time}>
            <td className="py-0.5 pr-2 font-mono text-[10px] text-muted-foreground">
              {slot.time}
            </td>
            {surf ? (
              <td className="py-0.5 pr-2">{swellText(slot)}</td>
            ) : (
              <td className="py-0.5 pr-2">{num(slot.waveM, 1, " m")}</td>
            )}
            <td className="py-0.5 pr-2">{windText(slot)}</td>
            {surf ? null : (
              <td className="py-0.5">{num(slot.currentKph, 1, " km/h")}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={LABEL}>{label}</span>
      <span className="t-num text-[12px] text-foreground">{value}</span>
    </div>
  )
}
