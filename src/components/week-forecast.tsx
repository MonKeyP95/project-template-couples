"use client"

import * as React from "react"

import { Chevron, DayChip, Label } from "@/components/together"
import type { DayForecast } from "@/lib/weather/get-weather"
import { glyphFor, labelFor } from "@/lib/weather/wmo"

const WEEKDAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  timeZone: "UTC",
})

function formatWeekday(date: string): string {
  return WEEKDAY.format(new Date(`${date}T00:00:00Z`)).toUpperCase()
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

function formatDay(date: string): string {
  return DAY.format(new Date(`${date}T00:00:00Z`))
}

/**
 * The desktop 7-day forecast bar. Collapsed it shows the compact day chips;
 * pressing the header expands a stacked per-day list with condition, high/low,
 * wind and rain chance. Client-only for the expand toggle.
 */
export function WeekForecast({ forecast }: { forecast: DayForecast[] }) {
  const [open, setOpen] = React.useState(false)
  if (forecast.length === 0) return null

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between"
      >
        <Label>Weather · 7 day</Label>
        <Chevron dir={open ? "down" : "right"} className="text-muted-foreground" />
      </button>

      {open ? (
        <div className="mt-2.5 overflow-hidden rounded-lg border border-border">
          {forecast.map((day, i) => (
            <DayRow key={day.date} day={day} first={i === 0} />
          ))}
        </div>
      ) : (
        <div className="mt-2.5 overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-7">
            {forecast.map((day, i) => (
              <DayChip
                key={day.date}
                d={formatWeekday(day.date)}
                t={Math.round(day.highC)}
                glyph={glyphFor(day.code)}
                active={i === 0}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DayRow({ day, first }: { day: DayForecast; first: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 ${first ? "" : "border-t border-border"}`}
    >
      <div className="w-14 shrink-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-foreground">
          {formatWeekday(day.date)}
        </div>
        <div className="t-num text-[11px] text-muted-foreground">
          {formatDay(day.date)}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-foreground">{labelFor(day.code)}</div>
        <div className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground">
          Wind {Math.round(day.windKph)} km/h · Rain {Math.round(day.rainPct)}%
        </div>
      </div>
      <div className="t-num shrink-0 text-right text-[12px] text-foreground">
        {Math.round(day.highC)}°{" "}
        <span className="text-muted-foreground">{Math.round(day.lowC)}°</span>
      </div>
    </div>
  )
}
