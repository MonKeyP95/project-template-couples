"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { Label } from "@/components/together"
import {
  planItinerarySteps,
  type ItineraryPlanStep,
  type PlanEntry,
} from "@/lib/ai/itinerary-planner"
import { draftAndApplyItinerary } from "@/lib/ai/itinerary-actions"

export interface PlanItineraryProps {
  tripId: string
  tripSlug: string
  destination: string
}

interface ItemRow {
  id: string
  subject: string
  /** Free-text note, kept alongside the structured date/range. */
  note: string
  /** yyyy-mm-dd; a start (+ optional end) folds into the `when` hint. */
  whenStart?: string
  whenEnd?: string
  /** Range mode: the end-date picker is shown. */
  range?: boolean
}

type Phase = "places" | "walk" | "review"

function fmtDate(d: string): string {
  const t = Date.parse(`${d}T00:00:00Z`)
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    : d
}

/** The picked date or range as a hint string: "12 Jan – 14 Jan", "12 Jan", or "". */
function rangeLabel(row: ItemRow): string {
  if (row.whenStart && row.whenEnd) return `${fmtDate(row.whenStart)} – ${fmtDate(row.whenEnd)}`
  if (row.whenStart) return fmtDate(row.whenStart)
  return ""
}

/** The `when` hint fed to the assistant: date/range joined with the free note. */
function rowWhen(row: ItemRow): string {
  return [rangeLabel(row), row.note.trim()].filter(Boolean).join(" · ")
}

function rowEmpty(row: ItemRow): boolean {
  return row.subject.trim() === "" && row.note.trim() === "" && !row.whenStart && !row.whenEnd
}

/**
 * Guided itinerary planner, the itinerary twin of the budget drafter. A places
 * question first, then per-place category steps (Accommodation, Food,
 * Activities) plus trip-wide (Transportation, Anything else), walked with
 * Back/Next. At the end, Generate hands everything to the assistant, which
 * drafts a day-by-day itinerary from the entered plans + the trip/couple
 * profile and writes it. Auto-opens on `?plan=1` (the onboarding hand-off).
 */
export function PlanItinerary({ tripId, tripSlug, destination }: PlanItineraryProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = React.useState(searchParams.get("plan") === "1")
  const [phase, setPhase] = React.useState<Phase>("places")
  const [placeNames, setPlaceNames] = React.useState<string[]>([""])
  const [freeText, setFreeText] = React.useState("")
  const [steps, setSteps] = React.useState<ItineraryPlanStep[]>([])
  const [items, setItems] = React.useState<Record<string, ItemRow[]>>({})
  const [stepIndex, setStepIndex] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const seq = React.useRef(0)

  const trimmedPlaces = placeNames.map((n) => n.trim()).filter((n) => n.length > 0)

  function newRow(): ItemRow {
    return { id: `r-${seq.current++}`, subject: "", note: "" }
  }

  function reset() {
    setOpen(false)
    setPhase("places")
    setPlaceNames([""])
    setFreeText("")
    setSteps([])
    setItems({})
    setStepIndex(0)
    setError(null)
  }

  function startWalk() {
    if (trimmedPlaces.length === 0) return
    const nextSteps = planItinerarySteps(trimmedPlaces)
    setItems((prev) => {
      const next: Record<string, ItemRow[]> = {}
      for (const s of nextSteps) next[s.key] = prev[s.key] ?? [newRow()]
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
          when: rowWhen(row),
        })
      }
    }
    return entries
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
          onClick={() => setOpen(true)}
          className="rounded-full border border-border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          Plan your itinerary
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
        <Label>Plan your itinerary</Label>
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
              disabled={trimmedPlaces.length === 0}
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
    return (
      <>
        <div className="flex items-center justify-between">
          <Label>Plan your itinerary</Label>
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
                <input
                  type="date"
                  aria-label="Date"
                  value={row.whenStart ?? ""}
                  onChange={(e) => patchItem(step.key, row.id, { whenStart: e.target.value })}
                  className="rounded border border-border bg-transparent px-1.5 py-1 font-mono text-[10px] text-foreground outline-none focus:border-foreground"
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
                  <input
                    type="date"
                    aria-label="End date"
                    value={row.whenEnd ?? ""}
                    min={row.whenStart || undefined}
                    onChange={(e) => patchItem(step.key, row.id, { whenEnd: e.target.value })}
                    className="rounded border border-border bg-transparent px-1.5 py-1 font-mono text-[10px] text-foreground outline-none focus:border-foreground"
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
        lines.push({ id: row.id, primary, when: rowWhen(row) })
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
          Generate drafts a day-by-day itinerary you can then edit.
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
