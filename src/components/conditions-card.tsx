"use client"

import * as React from "react"

import { AddToDayForm, type DispatchDay } from "@/components/add-to-day-form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TideChart } from "@/components/tide-chart"
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

const TITLE: Record<Activity, string> = { surf: "Surf", dive: "Dive" }

/** What lands on the itinerary when an activity is added from the card. */
const EVENT_TEXT: Record<Activity, string> = { surf: "Surfing", dive: "Diving" }

const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"

/** The look of the check-another-place input, shared by the activity dropdown
 * that sits beside it. */
const FIELD =
  "rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground"

/**
 * Surf or dive conditions for one day: a compact row that taps open into three
 * times of day plus tide, the place checked, and a row to switch activity or
 * check another place. Checking an activity the plan does not name offers to
 * add it. Numbers only, no verdicts -- what makes a good day depends on the
 * spot. Tide and current are model output, so labelled approximate.
 */
export function ConditionsCard({
  card,
  usual,
  tripId,
  tripSlug,
  days,
  expanded,
  onToggle,
}: {
  card: DayConditions
  /** Every activity, the couple's most usual first: the dropdown's order. */
  usual: Activity[]
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
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className={`block ${LABEL}`}>
            {TITLE[c.activity]} · {card.dayLabel}
          </span>
          {expanded ? null : (
            <span className="t-num mt-0.5 block text-[14px] text-foreground">
              {summaryText(c)}
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
        <OpenBody
          card={card}
          usual={usual}
          tripId={tripId}
          tripSlug={tripSlug}
          days={days}
        />
      ) : null}
    </div>
  )
}

function summaryText(c: Conditions): string {
  const first = c.slots[0]
  return c.activity === "surf"
    ? `${swellText(first)} · wind ${windText(first)}`
    : `Waves ${num(first.waveM, 1, " m")}`
}

/** The opened card. Its own component so a switched activity or looked-up
 * place is forgotten when the card closes: unmounting is the reset. */
function OpenBody({
  card,
  usual,
  tripId,
  tripSlug,
  days,
}: {
  card: DayConditions
  usual: Activity[]
  tripId: string
  tripSlug: string
  days: DispatchDay[]
}) {
  const [shown, setShown] = React.useState(card.conditions)
  return (
    <div className="border-t border-border px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-foreground">{shown.place.fullName}</span>
        {shown !== card.conditions ? (
          <button
            type="button"
            onClick={() => setShown(card.conditions)}
            className="font-mono text-[10px] text-muted-foreground underline underline-offset-2"
          >
            back to plan
          </button>
        ) : null}
      </div>
      <div className="mt-2">
        <SlotTable conditions={shown} />
      </div>
      <div className="mt-3 border-t border-border pt-3">
        <span className={LABEL}>Tide approx.</span>
        <TideChart levels={shown.tideLevels} turns={shown.tides} />
      </div>
      {shown.activity === "surf" ? null : (
        <div className="mt-3 space-y-1 border-t border-border pt-3">
          <Line label="Water" value={num(shown.waterC, 0, "°")} />
          <Line label="Rain, last 3 days" value={num(shown.rainMm3d, 0, " mm")} />
        </div>
      )}
      {card.planned.includes(shown.activity) ? null : (
        <AddToPlan
          key={shown.activity}
          activity={shown.activity}
          dayDate={card.conditions.dayDate}
          tripId={tripId}
          tripSlug={tripSlug}
          days={days}
        />
      )}
      <CheckRow shown={shown} usual={usual} onShow={setShown} />
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

/**
 * The card's one control row: the activity dropdown, then a box to check
 * another place. Changing the activity keeps the place; picking a place keeps
 * the activity.
 */
function CheckRow({
  shown,
  usual,
  onShow,
}: {
  shown: Conditions
  usual: Activity[]
  onShow: (conditions: Conditions) => void
}) {
  const [query, setQuery] = React.useState("")
  const [matches, setMatches] = React.useState<NearbyPlace[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const load = (activity: Activity, place: NearbyPlace | Conditions["place"]) =>
    startTransition(async () => {
      const result = await conditionsAt(activity, place, shown.dayDate)
      if (!result) {
        setError("No forecast for there.")
        return
      }
      onShow(result)
      setMatches(null)
      setQuery("")
      setError(null)
    })

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const found = await findPlacesNear(query, shown.place)
      setMatches(found)
      setError(found.length === 0 ? "No place by that name." : null)
    })
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <form onSubmit={search} className="flex gap-2">
        <Select
          value={shown.activity}
          onValueChange={(next: Activity | null) => {
            if (next && next !== shown.activity) load(next, shown.place)
          }}
          disabled={pending}
        >
          <SelectTrigger
            aria-label="Activity"
            className={`mt-0 w-auto shrink-0 ${FIELD} focus:border-clay`}
          >
            <SelectValue>{(value: Activity) => TITLE[value]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {usual.map((a) => (
              <SelectItem key={a} value={a}>
                {TITLE[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Check another place"
          aria-label="Check another place"
          className={`min-w-0 flex-1 ${FIELD}`}
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
                onClick={() => load(shown.activity, m)}
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
