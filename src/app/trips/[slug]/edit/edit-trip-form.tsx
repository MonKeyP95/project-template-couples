"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { deleteTrip, updateTrip } from "@/lib/trips/actions"

const SLUG_RE = /^[a-z0-9-]+$/

const PREVIEW_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

function fmtPreview(yyyyMmDd: string): string {
  return PREVIEW_FMT.format(new Date(`${yyyyMmDd}T00:00:00Z`))
}

function derivedEnd(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days - 1)
  return d.toISOString().slice(0, 10)
}

function parseFloatOrNull(s: string): number | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export interface EditTripInitial {
  name: string
  slug: string
  isDream: boolean
  startDate: string | null
  endDate: string | null
  fuzzyWhen: string | null
  country: string | null
  lat: number | null
  lng: number | null
}

export function EditTripForm({
  tripId,
  dreamDayCount,
  initial,
}: {
  tripId: string
  dreamDayCount: number
  initial: EditTripInitial
}) {
  const router = useRouter()
  const [name, setName] = React.useState(initial.name)
  const [slug, setSlug] = React.useState(initial.slug)
  const [isDream, setIsDream] = React.useState(initial.isDream)
  const [startDate, setStartDate] = React.useState(initial.startDate ?? "")
  const [endDate, setEndDate] = React.useState(initial.endDate ?? "")
  const [fuzzyWhen, setFuzzyWhen] = React.useState(initial.fuzzyWhen ?? "")
  const [country, setCountry] = React.useState(initial.country ?? "")
  const [advancedOpen, setAdvancedOpen] = React.useState(
    initial.lat !== null || initial.lng !== null,
  )
  const [lat, setLat] = React.useState(
    initial.lat === null ? "" : String(initial.lat),
  )
  const [lng, setLng] = React.useState(
    initial.lng === null ? "" : String(initial.lng),
  )
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const canSubmit =
    name.trim().length > 0 && SLUG_RE.test(slug.trim()) && !isPending

  const promotingDreamWithDays =
    initial.isDream && !isDream && dreamDayCount > 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    startTransition(async () => {
      const result = await updateTrip({
        tripId,
        currentSlug: initial.slug,
        name,
        slug: slug.trim(),
        isDream,
        wasDream: initial.isDream,
        startDate: isDream ? null : startDate || null,
        endDate: isDream ? null : endDate || null,
        fuzzyWhen: isDream ? fuzzyWhen.trim() || null : null,
        country: country.trim() || null,
        lat: parseFloatOrNull(lat),
        lng: parseFloatOrNull(lng),
      })
      if (result.error) {
        setError(result.error)
        return
      }
      router.push(`/trips/${result.slug}`)
    })
  }

  return (
    <>
      <form onSubmit={submit} className="mt-6">
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={isDream}
            onChange={(e) => setIsDream(e.target.checked)}
            disabled={isPending}
            className="h-4 w-4 accent-foreground disabled:opacity-50"
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            This is a dream (no dates yet)
          </span>
        </label>

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Where to?"
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[16px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Slug
          </span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="iceland-ring-road"
            disabled={isPending}
            className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
          <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
            URL: /trips/{slug || "—"}
          </span>
        </label>

        {isDream ? (
          <label className="mt-5 block">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              When?
            </span>
            <input
              type="text"
              value={fuzzyWhen}
              onChange={(e) => setFuzzyWhen(e.target.value)}
              placeholder="summer 2030, someday, ..."
              maxLength={64}
              disabled={isPending}
              className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </label>
        ) : promotingDreamWithDays ? (
          <div className="mt-5">
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Start
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
            {startDate ? (
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {dreamDayCount} planned days → {fmtPreview(startDate)}–
                {fmtPreview(derivedEnd(startDate, dreamDayCount))}
                <br />
                (end date set by your itinerary)
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Start
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                End
              </span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
          </div>
        )}

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Country
          </span>
          <input
            type="text"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Optional"
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>

        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          disabled={isPending}
          className="mt-5 inline-flex items-center gap-1 border-0 bg-transparent font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          aria-expanded={advancedOpen}
        >
          <span>{advancedOpen ? "▾" : "›"}</span>
          <span>advanced (lat / lng)</span>
        </button>

        {advancedOpen ? (
          <div className="mt-3 grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Latitude
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="-8.6500"
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Longitude
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="116.3200"
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
          </div>
        ) : null}

        {error ? (
          <div className="mt-5 font-mono text-[10px] text-clay">{error}</div>
        ) : null}

        <div className="mt-7 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            disabled={isPending}
            className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "…" : "save changes"}
          </button>
        </div>
      </form>

      <hr className="mt-10 border-rule" />
      <form
        action={deleteTrip.bind(null, tripId, initial.slug)}
        onSubmit={(e) => {
          if (
            !window.confirm(
              "Delete this trip? Packing list, expenses, and itinerary will be removed.",
            )
          ) {
            e.preventDefault()
          }
        }}
        className="mt-4 flex items-center justify-between"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          / danger
        </span>
        <button
          type="submit"
          disabled={isPending}
          className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-clay hover:text-foreground disabled:opacity-40"
        >
          {"// delete trip"}
        </button>
      </form>
    </>
  )
}
