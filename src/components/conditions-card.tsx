"use client"

import * as React from "react"

import type { Conditions, ConditionsSlot } from "@/lib/conditions/get-conditions"

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]

/** 8-point compass name for a "comes from" bearing. */
function compass(deg: number | null): string {
  return deg == null ? "-" : COMPASS[Math.round(deg / 45) % 8]
}

const num = (v: number | null, digits: number, unit: string) =>
  v == null ? "-" : `${v.toFixed(digits)}${unit}`

const TITLE = { surf: "Surf", dive: "Dive" }

/**
 * Surf or dive conditions for one planned day: a compact row that taps open
 * into three times of day plus tide. Numbers only, no verdicts -- what makes a
 * good day depends on the spot. Tide and current are model output, so labelled
 * approximate.
 */
export function ConditionsCard({
  conditions,
  dayLabel,
}: {
  conditions: Conditions
  /** "Today" or "Tomorrow". */
  dayLabel: string
}) {
  const [open, setOpen] = React.useState(false)
  const first = conditions.slots[0]
  const surf = conditions.activity === "surf"
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5"
      >
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {TITLE[conditions.activity]} · {dayLabel}
          </span>
          <span className="t-num text-[13px] text-foreground">
            {surf ? swellText(first) : `Waves ${num(first.waveM, 1, " m")}`}
          </span>
        </span>
        <span
          aria-hidden
          className={`font-mono text-[12px] text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
      </button>
      {open ? (
        <div className="border-t border-border px-3.5 py-3">
          <SlotTable conditions={conditions} />
          <div className="mt-3 space-y-1 border-t border-border pt-3">
            <Line label="Tide approx." value={tideText(conditions)} />
            {surf ? null : (
              <>
                <Line label="Water" value={num(conditions.waterC, 0, "°")} />
                <Line
                  label="Rain, last 3 days"
                  value={num(conditions.rainMm3d, 0, " mm")}
                />
              </>
            )}
          </div>
        </div>
      ) : null}
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
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className="t-num text-[12px] text-foreground">{value}</span>
    </div>
  )
}
