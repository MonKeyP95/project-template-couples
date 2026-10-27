"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { Label } from "@/components/together"
import {
  placesFromTags,
  planItinerarySteps,
  savedPlanFromItinerary,
  type ItineraryPlanStep,
  type PlanEntry,
  type SavedPlan,
} from "@/lib/ai/itinerary-planner"
import { positionLabel, type ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import { applyPlanEntries, draftAndApplyItinerary } from "@/lib/ai/itinerary-actions"

export interface PlanItineraryProps {
  tripId: string
  tripSlug: string
  /** The trip's own name — the place, when no locations were ever added. */
  tripName: string
  destination: string
  /** The trip's saved avoid text; the walk prefills from it and writes it back. */
  avoid: string
  /** The trip's existing locations and days — the walk opens on them. */
  locations: ItineraryLocation[]
  days: ItineraryDay[]
  /** Day 1's date; null on a dream, whose days read "Day N". */
  startDate: string | null
  /** The trip's length; null on an older dream, so the walk asks for it. */
  dayCount: number | null
}

interface ItemRow {
  id: string
  subject: string
  /** Free-text note, kept alongside the structured day/range. */
  note: string
  /** Day number as a string; a start (+ optional end) folds into the `when` hint. */
  whenStart?: string
  whenEnd?: string
  /** Range mode: the end-day picker is shown. */
  range?: boolean
  /** Set when the row was read back off an existing event; makes a save patch it. */
  serverId?: string
}

type Phase = "places" | "walk" | "review"

/** A row's day picker over Day 1..N, each labelled by its date on a dated
 * trip and as "Day N" on a dream. */
function DaySelect({
  label,
  value,
  dayCount,
  startDate,
  from = 1,
  onChange,
}: {
  label: string
  value: string
  dayCount: number
  startDate: string | null
  from?: number
  onChange: (value: string) => void
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-border bg-transparent px-1.5 py-1 font-mono text-[10px] text-foreground outline-none focus:border-foreground"
    >
      <option value="">{label === "Day" ? "day" : "to"}</option>
      {Array.from({ length: Math.max(0, dayCount - from + 1) }, (_, i) => from + i).map((d) => (
        <option key={d} value={String(d)}>
          {positionLabel(d, startDate)}
        </option>
      ))}
    </select>
  )
}

/** The picked day or range as a hint string: "12 Jan – 14 Jan" on a dated
 * trip, "Day 3 – Day 5" on a dream, or "". */
function rangeLabel(row: ItemRow, startDate: string | null): string {
  const fmt = (d: string) => positionLabel(Number(d), startDate)
  if (row.whenStart && row.whenEnd) return `${fmt(row.whenStart)} – ${fmt(row.whenEnd)}`
  if (row.whenStart) return fmt(row.whenStart)
  return ""
}

/** The `when` hint fed to the assistant: day/range joined with the free note. */
function rowWhen(row: ItemRow, startDate: string | null): string {
  return [rangeLabel(row, startDate), row.note.trim()].filter(Boolean).join(" · ")
}

function rowEmpty(row: ItemRow): boolean {
  return row.subject.trim() === "" && row.note.trim() === "" && !row.whenStart && !row.whenEnd
}

/** The Places step's opening rows: the trip's locations, else the places its
 * day tags name (a dream moved over from the old dream table), else the trip
 * itself, which is the place. The same fallback the write path uses
 * (applyPlanEdits files a location-less day under `trip.name`). */
function seedPlaceNames(saved: SavedPlan, days: ItineraryDay[], tripName: string): string[] {
  if (saved.places.length > 0) return saved.places.map((p) => p.name)
  const tagged = placesFromTags(days)
  return tagged.length > 0 ? tagged : [tripName.trim()]
}

/** The walk's opening rows, keyed by step. A seeded row is keyed by its own
 * serverId, which is already unique and never collides with a `r-N` new row. */
function seedItems(saved: SavedPlan): Record<string, ItemRow[]> {
  const out: Record<string, ItemRow[]> = {}
  for (const [key, rows] of Object.entries(saved.rows)) {
    out[key] = rows.map((r) => ({
      id: r.serverId,
      subject: r.subject,
      note: "",
      whenStart: String(r.day),
      serverId: r.serverId,
    }))
  }
  return out
}

/**
 * Guided itinerary planner, the itinerary twin of the budget drafter. A places
 * question first, then per-place category steps (Accommodation, Food,
 * Activities) plus trip-wide (Transportation, Anything else), walked with
 * Back/Next. At the end, Generate hands everything to the assistant, which
 * drafts a day-by-day itinerary from the entered plans + the trip/couple
 * profile and writes it. Auto-opens on `?plan=1` (the onboarding hand-off).
 */
export function PlanItinerary({
  tripId,
  tripSlug,
  tripName,
  destination,
  avoid: initialAvoid,
  locations,
  days,
  startDate,
  dayCount: tripDayCount,
}: PlanItineraryProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const seq = React.useRef(0)
  const saved = React.useMemo(
    () => savedPlanFromItinerary(locations, days),
    [locations, days],
  )
  const hasDays = days.length > 0
  const title = hasDays ? "Edit your itinerary" : "Plan your itinerary"
  /** A trip with no length yet (an older dream) asks for one on the Places step. */
  const asksDays = tripDayCount === null
  const [daysAsked, setDaysAsked] = React.useState("")
  const dayCount = tripDayCount ?? (parseInt(daysAsked, 10) || 0)
  const lastDay = Math.max(1, ...days.map((d) => d.dayIndex))
  const daysValid = !asksDays || (dayCount >= lastDay && dayCount <= 365)
  const [open, setOpen] = React.useState(searchParams.get("plan") === "1")
  const [phase, setPhase] = React.useState<Phase>("places")
  const [placeNames, setPlaceNames] = React.useState<string[]>(seedPlaces)

  function seedPlaces(): string[] {
    return seedPlaceNames(saved, days, tripName)
  }
  const [freeText, setFreeText] = React.useState("")
  const [avoid, setAvoid] = React.useState(initialAvoid)
  const [steps, setSteps] = React.useState<ItineraryPlanStep[]>([])
  const [items, setItems] = React.useState<Record<string, ItemRow[]>>(() =>
    seedItems(saved),
  )
  const [stepIndex, setStepIndex] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const trimmedPlaces = placeNames.map((n) => n.trim()).filter((n) => n.length > 0)

  function newRow(): ItemRow {
    return { id: `r-${seq.current++}`, subject: "", note: "" }
  }

  /** Opening always re-reads the itinerary, so a save then reopen shows the
   * saved state rather than the rows this component mounted with. Editing never
   * asks where you are going: the trip's locations — or the trip itself — are
   * the places, so the walk starts at step 1. Back from there still reaches the
   * Places step to add one. */
  function openWalk() {
    seedWalk()
    const known = seedPlaces().filter((n) => n.length > 0)
    if (hasDays && !asksDays && known.length > 0) beginWalk(known)
    setOpen(true)
  }

  function reset() {
    setOpen(false)
    seedWalk()
  }

  function seedWalk() {
    setPhase("places")
    setPlaceNames(seedPlaces())
    setDaysAsked("")
    setFreeText("")
    setAvoid(initialAvoid)
    setSteps([])
    setItems(seedItems(saved))
    setStepIndex(0)
    setError(null)
  }

  function startWalk() {
    if (trimmedPlaces.length === 0 || !daysValid) return
    beginWalk(trimmedPlaces)
  }

  function beginWalk(names: string[]) {
    const nextSteps = planItinerarySteps(names)
    setItems((prev) => {
      const next: Record<string, ItemRow[]> = {}
      for (const s of nextSteps) {
        if (s.kind !== "entries") continue
        next[s.key] = prev[s.key] ?? [newRow()]
      }
      return next
    })
    setSteps(nextSteps)
    setStepIndex(0)
    setError(null)
    setPhase("walk")
  }

  function addItem(key: string) {
    setItems((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), newRow()] }))
  }
  function patchItem(key: string, id: string, patch: Partial<ItemRow>) {
    setItems((prev) => ({
      ...prev,
      [key]: (prev[key] ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }))
  }
  function removeItem(key: string, id: string) {
    setItems((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((r) => r.id !== id) }))
  }

  function walkBack() {
    if (stepIndex === 0) {
      setPhase("places")
      return
    }
    setStepIndex((i) => i - 1)
  }
  function walkNext() {
    if (stepIndex >= steps.length - 1) {
      setError(null)
      setPhase("review")
      return
    }
    setStepIndex((i) => i + 1)
  }

  function collectEntries(): PlanEntry[] {
    const entries: PlanEntry[] = []
    for (const step of steps) {
      for (const row of items[step.key] ?? []) {
        if (rowEmpty(row)) continue
        entries.push({
          category: step.category,
          place: step.place ?? "",
          subject: row.subject.trim(),
          when: rowWhen(row, startDate),
          day: row.whenStart ? Number(row.whenStart) : undefined,
          endDay: row.whenEnd ? Number(row.whenEnd) : undefined,
          serverId: row.serverId,
        })
      }
    }
    return entries
  }

  /** Write the entered plans as-is — no assistant, no invention. */
  function apply() {
    if (isPending) return
    setError(null)
    const entries = collectEntries()
    startTransition(async () => {
      const r = await applyPlanEntries({
        tripId,
        tripSlug,
        places: trimmedPlaces,
        entries,
        avoid: avoid.trim(),
        dayCount: asksDays ? dayCount : undefined,
      })
      if (r.error) {
        setError(r.error)
        return
      }
      router.refresh()
      reset()
    })
  }

  function generate() {
    if (isPending) return
    setError(null)
    const entries = collectEntries()
    startTransition(async () => {
      const r = await draftAndApplyItinerary({
        tripId,
        tripSlug,
        places: trimmedPlaces,
        entries,
        freeText: freeText.trim(),
        avoid: avoid.trim(),
        dayCount: asksDays ? dayCount : undefined,
      })
      if (r.error) {
        setError(r.error)
        return
      }
      router.refresh()
      reset()
    })
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between border-t border-border px-5 pt-4 pb-2">
        <button
          type="button"
          onClick={openWalk}
          className="rounded-full border border-border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          {title}
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-border px-5 pt-4 pb-2">
      <div className="rounded-lg border border-border bg-card px-3.5 py-3">
        {phase === "places"
          ? renderPlaces()
          : phase === "walk"
            ? renderStep(steps[stepIndex])
            : renderReview()}
      </div>
    </div>
  )

  function renderPlaces() {
    return (
      <>
        <Label>{title}</Label>
        <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {destination}
        </div>

        <div className="mt-3 text-[13px] text-foreground">Where are you going?</div>
        <div className="mt-2 space-y-1.5">
          {placeNames.map((name, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                placeholder={`Place ${i + 1}`}
                onChange={(e) =>
                  setPlaceNames((prev) => prev.map((n, idx) => (idx === i ? e.target.value : n)))
                }
                className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
              />
              {placeNames.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setPlaceNames((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label="Remove place"
                  className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setPlaceNames((prev) => [...prev, ""])}
            className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
          >
            + add place
          </button>
        </div>

        {asksDays ? (
          <label className="mt-4 block">
            <span className="block text-[13px] text-foreground">How many days?</span>
            <input
              type="text"
              inputMode="numeric"
              value={daysAsked}
              placeholder="10"
              onChange={(e) => setDaysAsked(e.target.value.replace(/\D/g, ""))}
              className="mt-1.5 w-20 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
            />
          </label>
        ) : null}

        <div className="mt-4 text-[13px] text-foreground">Sum up this trip in a few words</div>
        <textarea
          value={freeText}
          placeholder="optional — e.g. relaxed 2 weeks surfing in Portugal"
          rows={2}
          onChange={(e) => setFreeText(e.target.value)}
          className="mt-1.5 w-full resize-y border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
        />

        <div className="mt-4 flex items-center justify-between">
          <span />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={startWalk}
              disabled={trimmedPlaces.length === 0 || !daysValid}
              className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
            >
              next
            </button>
          </div>
        </div>
      </>
    )
  }

  function renderStep(step: ItineraryPlanStep) {
    const isLast = stepIndex === steps.length - 1
    const rows = items[step.key] ?? []

    if (step.kind === "text") {
      return (
        <>
          <div className="flex items-center justify-between">
            <Label>{title}</Label>
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              step {stepIndex + 1} of {steps.length}
            </span>
          </div>

          <div className="mt-2 font-serif text-[15px] italic text-foreground">
            {step.title}
          </div>
          <div className="mt-1 text-[13px] text-foreground">{step.question}</div>
          <div className="mt-1 font-mono text-[10px] leading-snug tracking-[0.06em] text-muted-foreground">
            {step.hint}
          </div>

          <textarea
            value={avoid}
            placeholder="e.g. no long drives, skip the big tourist spots"
            rows={3}
            maxLength={500}
            onChange={(e) => setAvoid(e.target.value)}
            className="mt-3 w-full resize-y border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
          />

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={walkBack}
              className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
            >
              back
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={reset}
                className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={walkNext}
                className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
              >
                {isLast ? "review" : "next"}
              </button>
            </div>
          </div>
        </>
      )
    }

    return (
      <>
        <div className="flex items-center justify-between">
          <Label>{title}</Label>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            step {stepIndex + 1} of {steps.length}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-baseline gap-2">
          <span className="font-serif text-[15px] italic text-foreground">
            {step.place ? `${step.place} · ${step.title}` : step.title}
          </span>
        </div>
        <div className="mt-1 text-[13px] text-foreground">{step.question}</div>
        <div className="mt-1 font-mono text-[10px] leading-snug tracking-[0.06em] text-muted-foreground">
          {step.hint}
        </div>

        <div className="mt-3 space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-md border border-rule px-2.5 py-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.subject}
                  placeholder="What"
                  onChange={(e) => patchItem(step.key, row.id, { subject: e.target.value })}
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
                />
                <button
                  type="button"
                  onClick={() => removeItem(step.key, row.id)}
                  aria-label="Remove"
                  className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <input
                  type="text"
                  value={row.note ?? ""}
                  placeholder="when (optional) — e.g. 3 nights, 12-14 Jan"
                  onChange={(e) => patchItem(step.key, row.id, { note: e.target.value })}
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent font-mono text-[11px] tracking-[0.04em] text-muted-foreground outline-none focus:border-foreground"
                />
                <DaySelect
                  label="Day"
                  value={row.whenStart ?? ""}
                  dayCount={dayCount}
                  startDate={startDate}
                  onChange={(v) => patchItem(step.key, row.id, { whenStart: v })}
                />

                <button
                  type="button"
                  onClick={() =>
                    patchItem(step.key, row.id, {
                      range: !row.range,
                      whenEnd: row.range ? "" : row.whenEnd,
                    })
                  }
                  className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${
                    row.range
                      ? "border-0 bg-foreground text-background"
                      : "border border-border bg-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  range
                </button>
                {row.range ? (
                  <DaySelect
                    label="End day"
                    value={row.whenEnd ?? ""}
                    dayCount={dayCount}
                    startDate={startDate}
                    from={parseInt(row.whenStart ?? "", 10) || 1}
                    onChange={(v) => patchItem(step.key, row.id, { whenEnd: v })}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2">
          <button
            type="button"
            onClick={() => addItem(step.key)}
            className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
          >
            + add {step.addNoun}
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={walkBack}
            className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          >
            back
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={walkNext}
              className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
            >
              {isLast ? "review" : "next"}
            </button>
          </div>
        </div>
      </>
    )
  }

  function renderReview() {
    const lines: { id: string; primary: string; when: string }[] = []
    for (const step of steps) {
      for (const row of items[step.key] ?? []) {
        if (rowEmpty(row)) continue
        const subject = row.subject.trim()
        const primary = step.place
          ? subject
            ? `${step.place} · ${subject}`
            : `${step.place} · ${step.title}`
          : subject || step.title
        lines.push({ id: row.id, primary, when: rowWhen(row, startDate) })
      }
    }

    return (
      <>
        <div className="flex items-center justify-between">
          <Label>Your plans</Label>
          <button
            type="button"
            onClick={() => {
              setStepIndex(steps.length - 1)
              setPhase("walk")
            }}
            className="border-0 bg-transparent p-0 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          >
            back
          </button>
        </div>

        <div className="mt-2 border-t border-rule">
          {lines.length === 0 ? (
            <div className="py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Nothing added — the assistant will draft from your places and profile.
            </div>
          ) : (
            lines.map((line) => (
              <div
                key={line.id}
                className="flex items-center justify-between gap-3 border-t border-rule py-2 first:border-t-0"
              >
                <span className="min-w-0 text-[13px] text-foreground">{line.primary}</span>
                {line.when ? (
                  <span className="shrink-0 font-mono text-[10px] tracking-[0.04em] text-muted-foreground">
                    {line.when}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          Generate drafts a day-by-day itinerary — apply saves just these.
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={generate}
            disabled={isPending}
            className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "Generating…" : "Generate"}
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={isPending || lines.length === 0}
            className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-foreground disabled:opacity-40"
          >
            apply
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={isPending}
            className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
          >
            cancel
          </button>
          {error ? <span className="font-mono text-[9px] text-clay">{error}</span> : null}
        </div>
      </>
    )
  }
}
