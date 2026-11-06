"use client"

import * as React from "react"

import type { Conditions, ConditionsSlot } from "@/lib/conditions/get-conditions"
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

const TITLE = { surf: "Surf", dive: "Dive" }

const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"

/**
 * Surf or dive conditions for one planned day: a compact row that taps open
 * into three times of day plus tide, the place checked, and a box to check
 * another place. Numbers only, no verdicts -- what makes a good day depends on
 * the spot. Tide and current are model output, so labelled approximate.
 */
export function ConditionsCard({
  conditions,
  dayLabel,
  expanded,
  onToggle,
}: {
  conditions: Conditions
  /** "Today" or "Tomorrow". */
  dayLabel: string
  expanded: boolean
  onToggle: (next: boolean) => void
}) {
  const first = conditions.slots[0]
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
            {TITLE[conditions.activity]} · {dayLabel}
          </span>
          {expanded ? null : (
            <span className="t-num text-[13px] text-foreground">
              {conditions.activity === "surf"
                ? swellText(first)
                : `Waves ${num(first.waveM, 1, " m")}`}
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
      {expanded ? <OpenBody planned={conditions} /> : null}
    </div>
  )
}

/** The opened card. Its own component so a looked-up place is forgotten when
 * the card closes: unmounting is the reset. */
function OpenBody({ planned }: { planned: Conditions }) {
  const [shown, setShown] = React.useState(planned)
  return (
    <div className="border-t border-border px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-foreground">{shown.place.fullName}</span>
        {shown !== planned ? (
          <button
            type="button"
            onClick={() => setShown(planned)}
            className="font-mono text-[10px] text-muted-foreground underline underline-offset-2"
          >
            back to plan
          </button>
        ) : null}
      </div>
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
      <PlaceLookup planned={planned} onPick={setShown} />
    </div>
  )
}

/** Type a place, pick one of the nearest matches, see its conditions. */
function PlaceLookup({
  planned,
  onPick,
}: {
  planned: Conditions
  onPick: (conditions: Conditions) => void
}) {
  const [query, setQuery] = React.useState("")
  const [matches, setMatches] = React.useState<NearbyPlace[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const found = await findPlacesNear(query, planned.place)
      setMatches(found)
      setError(found.length === 0 ? "No place by that name." : null)
    })
  }

  const pick = (place: NearbyPlace) => {
    startTransition(async () => {
      const result = await conditionsAt(planned.activity, place, planned.dayDate)
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
