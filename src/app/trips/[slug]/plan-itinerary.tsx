"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { Label } from "@/components/together"
import {
  walkPlaceSeed,
  planItinerarySteps,
  profileAnswerFor,
  savedPlanFromItinerary,
  type ProfileAnswers,
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
  /** The trip's idea from its basic profile; shown read-only in the header. */
  idea: string
  /** The trip's saved avoid text; the walk prefills from it and writes it back. */
  avoid: string
  /** New-trip answers (stay, getting around, doing, food); a step with no
   * saved rows opens on its answer. */
  answers: ProfileAnswers
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

/** A pill in the itinerary's top toolbar row; `active` marks its panel open. */
export function toolbarPill(active: boolean): string {
  return `rounded-full border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] ${
    active
      ? "border-foreground text-foreground"
      : "border-border text-muted-foreground hover:text-foreground"
  }`
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
  idea,
  avoid: initialAvoid,
  answers,
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
  /** Places added in this walk on top of the trip's known ones (seedPlaces). */
  const [addedPlaces, setAddedPlaces] = React.useState<string[]>([])

  function seedPlaces(): string[] {
    return walkPlaceSeed(saved.places.map((p) => p.name), days, tripName, startDate)
  }
  /** What they want in this itinerary; goes to the drafter only, not saved. */
  const [freeText, setFreeText] = React.useState("")
  const [avoid, setAvoid] = React.useState(initialAvoid)
  const [steps, setSteps] = React.useState<ItineraryPlanStep[]>([])
  const [items, setItems] = React.useState<Record<string, ItemRow[]>>(() =>
    seedItems(saved),
  )
  const [stepIndex, setStepIndex] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const trimmedPlaces = [...seedPlaces(), ...addedPlaces]
    .map((n) => n.trim())
    .filter((n) => n.length > 0)

  function newRow(): ItemRow {
    return { id: `r-${seq.current++}`, subject: "", note: "" }
  }

  /** Opening always re-reads the itinerary, so a save then reopen shows the
   * saved state rather than the rows this component mounted with. It always
   * opens on the first box (what the itinerary looks like), with the places
   * prefilled. */
  function openWalk() {
    seedWalk()
    setOpen(true)
  }

  function reset() {
    setOpen(false)
    seedWalk()
  }

  function seedWalk() {
    setPhase("places")
    setAddedPlaces([])
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
        next[s.key] = prev[s.key] ?? [
          { ...newRow(), subject: profileAnswerFor(s.category, answers) },
        ]
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

  /** The pill sits in the parent's wrapping toolbar row; the open panel is a
   * sibling flex item that takes a full line below the pills. */
  return (
    <>
      <button type="button" onClick={open ? reset : openWalk} className={toolbarPill(open)}>
        {title}
      </button>
      {open ? (
        <div className="order-last w-full rounded-lg border border-border bg-card px-3.5 py-3">
          {phase === "places"
            ? renderPlaces()
            : phase === "walk"
              ? renderStep(steps[stepIndex])
              : renderReview()}
        </div>
      ) : null}
    </>
  )

  function renderPlaces() {
    return (
      <>
        <Label>{title}</Label>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {destination}
          </span>
          {idea ? (
            <span
              title={idea}
              className="min-w-0 truncate font-serif text-[13px] italic text-muted-foreground"
            >
              {idea}
            </span>
          ) : null}
        </div>

        <div className="mt-3 text-[13px] text-foreground">
          What does your itinerary look like for this trip?
        </div>
        <textarea
          value={freeText}
          placeholder="optional — e.g. surf school for 5 days, maybe a trek or two"
          rows={3}
          maxLength={2000}
          autoFocus
          onChange={(e) => setFreeText(e.target.value)}
          className="mt-1.5 w-full resize-y rounded-md border border-border bg-transparent px-2.5 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-foreground"
        />

        {addedPlaces.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {addedPlaces.map((name, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={name}
                  placeholder="New place"
                  autoFocus
                  onChange={(e) =>
                    setAddedPlaces((prev) =>
                      prev.map((n, idx) => (idx === i ? e.target.value : n)),
                    )
                  }
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
                />
                <button
                  type="button"
                  onClick={() => setAddedPlaces((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label="Remove place"
                  className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setAddedPlaces((prev) => [...prev, ""])}
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
            className="mt-3 w-full resize-y rounded-md border border-border bg-transparent px-2.5 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-foreground"
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
