"use client"

import * as React from "react"
import {
  CloudIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  SunIcon,
} from "lucide-react"

import type { Weather } from "@/lib/weather/get-weather"
import { labelFor } from "@/lib/weather/wmo"

/** Maps a WMO weather code to one of five condition icons. */
function iconFor(code: number) {
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return CloudSnowIcon
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95)
    return CloudRainIcon
  if (code === 0) return SunIcon
  if (code === 1 || code === 2) return CloudSunIcon
  return CloudIcon
}

/** A weather-reflective color (oklch) for a WMO code, applied to the icon. */
function colorFor(code: number): string {
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return "oklch(0.78 0.07 220)" // snow — icy blue
  if (code >= 95) return "oklch(0.56 0.14 285)" // storm — indigo
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))
    return "oklch(0.60 0.13 240)" // rain — blue
  if (code === 0) return "oklch(0.80 0.14 85)" // clear — gold
  if (code === 1 || code === 2) return "oklch(0.74 0.10 75)" // mostly clear — warm
  if (code === 45 || code === 48) return "oklch(0.66 0.02 240)" // fog — gray
  return "oklch(0.62 0.035 240)" // cloudy — slate
}

/**
 * Compact current-weather chip (icon + condition + temp) that taps open into a
 * mini-forecast (high/low, wind, humidity, next hours). Client-only for the
 * expand toggle. Data comes from the (currently stubbed) `getWeather`.
 */
export function WeatherCard({
  weather,
  className,
}: {
  weather: Weather
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className={`rounded-lg border border-border bg-card ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3.5 py-2.5"
      >
        <span className="flex items-center gap-2">
          {React.createElement(iconFor(weather.code), {
            className: "h-4 w-4",
            strokeWidth: 2,
            color: colorFor(weather.code),
          })}
          <span className="text-[13px] text-foreground">{labelFor(weather.code)}</span>
          <span className="t-num text-[13px] text-muted-foreground">
            {Math.round(weather.tempC)}°
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
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Stat label="High" value={`${Math.round(weather.highC)}°`} />
            <Stat label="Low" value={`${Math.round(weather.lowC)}°`} />
            <Stat label="Wind" value={`${Math.round(weather.windKph)} km/h`} />
            <Stat label="Humidity" value={`${Math.round(weather.humidityPct)}%`} />
            <Stat label="Rain" value={`${Math.round(weather.rainPct)}%`} />
          </div>
          {weather.hourly.length > 0 ? (
            <div className="mt-3 flex gap-3 border-t border-border pt-3">
              {weather.hourly.map((h) => (
                <div key={h.time} className="flex flex-col items-center gap-1">
                  <span className="font-mono text-[9px] tracking-[0.06em] text-muted-foreground">
                    {h.time}
                  </span>
                  {React.createElement(iconFor(h.code), {
                    className: "h-3.5 w-3.5",
                    strokeWidth: 2,
                    color: colorFor(h.code),
                  })}
                  <span className="t-num text-[11px] text-foreground">
                    {Math.round(h.tempC)}°
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className="t-num text-[12px] text-foreground">{value}</span>
    </div>
  )
}
