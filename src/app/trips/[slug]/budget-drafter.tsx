"use client"

import * as React from "react"

import { Label } from "@/components/together"
import { planBudgetSteps, type BudgetStep } from "@/lib/ai/budget-planner"
import {
  draftAndFillBudget,
  type EnteredLine,
} from "@/lib/ai/budget-actions"
import { saveBudgetItems, type SaveBudgetItemInput } from "@/lib/trips/actions"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
import {
  locationDateLabel,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

function fmt(cents: number): string {
  return (cents / 100).toFixed(0)
}

function asCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

interface ItemRow {
  id: string
  subject: string
  when: string
  /** Euros, "" when blank or no reliable price. */
  value: string
  /** The assistant supplied this amount. */
  estimated?: boolean
  /** Backing web-search URL, when it found one. */
  sourceUrl?: string | null
  /** The assistant couldn't price this; value stays "". */
  priceUnknown?: boolean
}

interface Session {
  steps: BudgetStep[]
  /** bucket id (`${stepKey}:${locId|trip}`) -> rows. */
  items: Record<string, ItemRow[]>
}

const CATEGORY_BY_STEP: Record<string, string> = {
  accommodation: "Accommodation",
  transport: "Transportation",
  food: "Food",
  activities: "Activities",
  other: "Other",
}
const STEP_BY_CATEGORY: Record<string, string> = {
  Accommodation: "accommodation",
  Transportation: "transport",
  Food: "food",
  Activities: "activities",
  Other: "other",
}
const PER_LOCATION = new Set(["accommodation", "food", "activities"])
const isBufferSubject = (s: string) => /^buffer \(/i.test(s.trim())

export interface BudgetDrafterProps {
  tripId: string
  tripSlug: string
  tripName: string
  /** Whole-trip duration in days, from the trip's date span (0 for a dateless dream). */
  tripDays: number
  plannedBudgetCents: number
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
  memberCount: number
  initialItems: BudgetItem[]
  /** Walk seeds from the itinerary: bucket id -> candidate subjects. */
  itinerarySeeds: Record<string, string[]>
  /** Recommended buffer % + one-line reason, from the couple's history. */
  bufferRec: { pct: number; reason: string }
}

export function BudgetDrafter({
  tripId,
  tripSlug,
  tripName,
  tripDays,
  plannedBudgetCents,
  locations,
  itineraryDays,
  memberCount,
  initialItems,
  itinerarySeeds,
  bufferRec,
}: BudgetDrafterProps) {
  const [session, setSession] = React.useState<Session | null>(null)
  const [stepIndex, setStepIndex] = React.useState(0)
  const [bufferPct, setBufferPct] = React.useState(bufferRec.pct)
  const [generated, setGenerated] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const itemSeq = React.useRef(0)

  const totalDays = tripDays > 0 ? tripDays : itineraryDays.length
  if (totalDays === 0 && locations.length === 0) return null

  const bufferIndex = session ? session.steps.length : 0
  const reviewIndex = bufferIndex + 1

  function newRow(fields: Partial<ItemRow> = {}): ItemRow {
    return { id: `it-${itemSeq.current++}`, subject: "", when: "", value: "", ...fields }
  }

  /** Per-location nights + date label, and an id->name map, from the itinerary. */
  function locContext() {
    const nightsByLoc: Record<string, number> = {}
    const datesByLoc: Record<string, string[]> = {}
    for (const d of itineraryDays) {
      if (d.locationId) {
        nightsByLoc[d.locationId] = (nightsByLoc[d.locationId] ?? 0) + 1
        ;(datesByLoc[d.locationId] ??= []).push(d.dayDate)
      }
    }
    const locInput = locations.map((l) => ({
      name: l.name,
      nights: nightsByLoc[l.id] ?? 0,
      dateLabel: locationDateLabel(l.startDate, l.endDate, datesByLoc[l.id] ?? []),
    }))
    const nameById: Record<string, string> = {}
    for (const l of locations) nameById[l.id] = l.name
    return { locInput, nameById }
  }

  /** Existing budget items -> saved rows per bucket (drops the derived buffer
   * line; keeps marks). Per-location items on a missing place fall to the first. */
  function savedRows(): Record<string, Partial<ItemRow>[]> {
    const ids = new Set(locations.map((l) => l.id))
    const fallback = locations[0]?.id ?? "trip"
    const out: Record<string, Partial<ItemRow>[]> = {}
    for (const it of initialItems) {
      if (isBufferSubject(it.subject)) continue
      const catKey = STEP_BY_CATEGORY[it.category]
      if (!catKey) continue
      const locKey = PER_LOCATION.has(catKey)
        ? it.locationId && ids.has(it.locationId)
          ? it.locationId
          : fallback
        : "trip"
      ;(out[`${catKey}:${locKey}`] ??= []).push({
        subject: it.subject,
        when: it.whenLabel,
        value: it.priceUnknown ? "" : it.amountCents ? fmt(it.amountCents) : "",
        estimated: it.estimated,
        sourceUrl: it.sourceUrl,
        priceUnknown: it.priceUnknown,
      })
    }
    return out
  }

  function seedFromItinerary(): Record<string, Partial<ItemRow>[]> {
    const out: Record<string, Partial<ItemRow>[]> = {}
    for (const [bucket, subjects] of Object.entries(itinerarySeeds)) {
      out[bucket] = subjects.map((subject) => ({ subject }))
    }
    return out
  }

  function seedSession(seed: Record<string, Partial<ItemRow>[]>) {
    const steps = planBudgetSteps({
      tripName,
      totalDays,
      memberCount,
      locations: locContext().locInput.map((l, i) => ({
        id: locations[i]?.id ?? "trip",
        name: l.name,
        nights: l.nights,
        dateLabel: l.dateLabel,
      })),
    })
    const items: Record<string, ItemRow[]> = {}
    for (const step of steps) {
      items[step.key] = (seed[step.key] ?? []).map((r) => newRow(r))
    }
    setError(null)
    setGenerated(false)
    setBufferPct(bufferRec.pct)
    setStepIndex(0)
    setSession({ steps, items })
  }

  function open(fromScratch = false) {
    const restore = !fromScratch && plannedBudgetCents > 0
    seedSession(restore ? savedRows() : seedFromItinerary())
  }

  function addItem(bucketId: string) {
    setSession((s) =>
      s
        ? { ...s, items: { ...s.items, [bucketId]: [...(s.items[bucketId] ?? []), newRow()] } }
        : s,
    )
  }

  function patchItem(bucketId: string, id: string, patch: Partial<ItemRow>) {
    setSession((s) =>
      s
        ? {
            ...s,
            items: {
              ...s.items,
              [bucketId]: (s.items[bucketId] ?? []).map((r) =>
                r.id === id ? { ...r, ...patch } : r,
              ),
            },
          }
        : s,
    )
  }

  /** Editing a price makes the line the couple's own — clears the marks. */
  function editValue(bucketId: string, id: string, value: string) {
    patchItem(bucketId, id, { value, estimated: false, sourceUrl: null, priceUnknown: false })
  }

  function removeItem(bucketId: string, id: string) {
    setSession((s) =>
      s
        ? {
            ...s,
            items: {
              ...s.items,
              [bucketId]: (s.items[bucketId] ?? []).filter((r) => r.id !== id),
            },
          }
        : s,
    )
  }

  /** Leaving a category step: drop rows that are entirely empty. */
  function normalizeStep(step: BudgetStep) {
    setSession((s) => {
      if (!s) return s
      const rows = (s.items[step.key] ?? []).filter(
        (r) => r.subject.trim() !== "" || r.when.trim() !== "" || r.value.trim() !== "",
      )
      return { ...s, items: { ...s.items, [step.key]: rows } }
    })
  }

  function goNext() {
    if (!session) return
    if (stepIndex < session.steps.length) normalizeStep(session.steps[stepIndex])
    setStepIndex((i) => i + 1)
  }

  function collectLines(s: Session): EnteredLine[] {
    const { nameById } = locContext()
    const lines: EnteredLine[] = []
    for (const [bucketId, rows] of Object.entries(s.items)) {
      const [stepKey, locKey] = bucketId.split(":")
      const category = CATEGORY_BY_STEP[stepKey]
      if (!category) continue
      const place = locKey && locKey !== "trip" ? nameById[locKey] ?? "" : ""
      for (const r of rows) {
        if (r.subject.trim() === "" && r.value.trim() === "") continue
        const cents = asCents(r.value)
        lines.push({
          category,
          place,
          subject: r.subject.trim(),
          whenLabel: r.when.trim(),
          amountEuros: cents > 0 ? cents / 100 : null,
        })
      }
    }
    return lines
  }

  /** Filled review lines -> bucket-keyed rows, matching by place name. */
  function filledToItems(
    lines: {
      category: string
      place: string
      subject: string
      whenLabel: string
      amountCents: number
      estimated: boolean
      sourceUrl: string | null
      priceUnknown: boolean
    }[],
  ): Record<string, ItemRow[]> {
    const idByName = new Map(locations.map((l) => [l.name.trim().toLowerCase(), l.id]))
    const fallback = locations[0]?.id ?? "trip"
    const out: Record<string, ItemRow[]> = {}
    for (const line of lines) {
      const catKey = STEP_BY_CATEGORY[line.category]
      if (!catKey) continue
      const bucket = PER_LOCATION.has(catKey)
        ? `${catKey}:${(line.place && idByName.get(line.place.trim().toLowerCase())) || fallback}`
        : `${catKey}:trip`
      ;(out[bucket] ??= []).push(
        newRow({
          subject: line.subject,
          when: line.whenLabel,
          value: line.priceUnknown ? "" : fmt(line.amountCents),
          estimated: line.estimated,
          sourceUrl: line.sourceUrl,
          priceUnknown: line.priceUnknown,
        }),
      )
    }
    return out
  }

  function generate() {
    if (!session || isPending) return
    setError(null)
    const { locInput } = locContext()
    const lines = collectLines(session)
    startTransition(async () => {
      const r = await draftAndFillBudget({
        tripId,
        tripSlug,
        lines,
        locations: locInput,
        memberCount,
      })
      if (r.error) {
        setError(r.error)
        return
      }
      setSession((s) => (s ? { ...s, items: filledToItems(r.lines ?? []) } : s))
      setGenerated(true)
    })
  }

  function subtotalCents(s: Session): number {
    let sum = 0
    for (const rows of Object.values(s.items)) {
      for (const r of rows) sum += asCents(r.value)
    }
    return sum
  }

  function unknownCount(s: Session): number {
    let n = 0
    for (const rows of Object.values(s.items)) {
      for (const r of rows) if (r.priceUnknown) n++
    }
    return n
  }

  function apply() {
    if (!session || isPending) return
    const items: SaveBudgetItemInput[] = []
    for (const [bucketId, rows] of Object.entries(session.items)) {
      const [stepKey, locKey] = bucketId.split(":")
      const category = CATEGORY_BY_STEP[stepKey]
      if (!category) continue
      const locationId = locKey && locKey !== "trip" ? locKey : null
      for (const r of rows) {
        const cents = asCents(r.value)
        if (r.subject.trim() === "" && cents === 0 && !r.priceUnknown) continue
        items.push({
          category,
          subject: r.subject,
          whenLabel: r.when,
          amountCents: cents,
          locationId,
          estimated: r.estimated ?? false,
          sourceUrl: r.sourceUrl ?? null,
          priceUnknown: r.priceUnknown ?? false,
        })
      }
    }
    const buffer = Math.round((subtotalCents(session) * bufferPct) / 100)
    if (buffer > 0) {
      items.push({
        category: "Other",
        subject: `Buffer (${bufferPct}%)`,
        whenLabel: "",
        amountCents: buffer,
        locationId: null,
      })
    }
    startTransition(async () => {
      const r = await saveBudgetItems({ tripId, tripSlug, items })
      if (r.error) {
        setError(r.error)
        return
      }
      setSession(null)
    })
  }

  if (!session) {
    return (
      <div className="flex items-center justify-between border-t border-border px-5 pt-4 pb-2">
        <button
          type="button"
          onClick={() => open()}
          className="rounded-full border border-border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          {plannedBudgetCents > 0 ? "Edit budget" : "Plan a budget"}
        </button>
        {plannedBudgetCents > 0 ? (
          <button
            type="button"
            onClick={() => open(true)}
            className="rounded-full border border-dashed border-border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            Start over
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="border-t border-border px-5 pt-4 pb-2">
      <div className="rounded-lg border border-border bg-card px-3.5 py-3">
        {stepIndex < session.steps.length
          ? renderStep(session.steps[stepIndex])
          : stepIndex === bufferIndex
            ? renderBuffer()
            : renderReview()}
      </div>
    </div>
  )

  function renderRow(bucketId: string, row: ItemRow) {
    return (
      <div key={row.id} className="rounded-md border border-rule px-2.5 py-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={row.subject}
            placeholder="What"
            onChange={(e) => patchItem(bucketId, row.id, { subject: e.target.value })}
            disabled={isPending}
            className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
          />
          <button
            type="button"
            onClick={() => removeItem(bucketId, row.id)}
            disabled={isPending}
            aria-label="Remove"
            className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <input
            type="text"
            value={row.when}
            placeholder="When (e.g. 3 days, 12 Jan)"
            onChange={(e) => patchItem(bucketId, row.id, { when: e.target.value })}
            disabled={isPending}
            className="min-w-0 flex-1 border-0 border-b border-border bg-transparent font-mono text-[11px] tracking-[0.04em] text-muted-foreground outline-none focus:border-foreground"
          />
          <span className="inline-flex items-baseline gap-1">
            <span className="font-mono text-[12px] text-muted-foreground">€</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={row.value}
              onChange={(e) => editValue(bucketId, row.id, e.target.value)}
              disabled={isPending}
              className="t-num w-20 border-0 border-b border-border bg-transparent text-right text-[14px] text-foreground outline-none focus:border-foreground"
            />
          </span>
        </div>
      </div>
    )
  }

  function renderStep(step: BudgetStep) {
    return (
      <>
        <div className="flex items-center justify-between">
          <Label>/ assistant</Label>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            step {stepIndex + 1} of {session!.steps.length}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-baseline gap-2">
          <span className="font-serif text-[15px] italic text-foreground">
            {step.place ? `${step.place} · ${step.title}` : step.title}
          </span>
          {step.placeWhen ? (
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              {step.placeWhen}
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-[13px] text-foreground">{step.question}</div>
        {step.hint ? (
          <div className="mt-1 font-mono text-[10px] leading-snug tracking-[0.06em] text-muted-foreground">
            {step.hint}
          </div>
        ) : null}

        <div className="mt-3 space-y-2">
          {(session!.items[step.key] ?? []).map((row) => renderRow(step.key, row))}
        </div>
        <div className="mt-2">
          <button
            type="button"
            onClick={() => addItem(step.key)}
            disabled={isPending}
            className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
          >
            + add {step.addNoun}
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={stepIndex === 0}
            className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            back
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSession(null)}
              className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={goNext}
              className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
            >
              next
            </button>
          </div>
        </div>
      </>
    )
  }

  function renderBuffer() {
    const choices = [5, 10, 15]
    const isPreset = choices.includes(bufferPct)
    return (
      <>
        <Label>Buffer</Label>
        <div className="mt-2 font-serif text-[15px] italic text-foreground">
          How much buffer?
        </div>
        <div className="mt-1 font-mono text-[10px] leading-snug tracking-[0.06em] text-muted-foreground">
          A cushion on top of the total — {bufferRec.reason}.
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          {choices.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setBufferPct(c)}
              className={`rounded-md border px-3 py-1.5 font-mono text-[11px] ${
                bufferPct === c
                  ? "border-0 bg-foreground text-background"
                  : "border-border bg-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {c}%
            </button>
          ))}
          <span className="inline-flex items-baseline gap-1 pl-1">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={isPreset ? "" : String(bufferPct)}
              placeholder="custom"
              onChange={(e) => setBufferPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="t-num w-16 border-0 border-b border-border bg-transparent text-right text-[13px] text-foreground outline-none focus:border-foreground"
            />
            <span className="font-mono text-[12px] text-muted-foreground">%</span>
          </span>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStepIndex(session!.steps.length - 1)}
            className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          >
            back
          </button>
          <button
            type="button"
            onClick={() => setStepIndex(reviewIndex)}
            className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
          >
            review
          </button>
        </div>
      </>
    )
  }

  function renderReview() {
    const lines: { bucketId: string; row: ItemRow; primary: string }[] = []
    for (const step of session!.steps) {
      for (const row of session!.items[step.key] ?? []) {
        const subject = row.subject.trim()
        const primary = step.place
          ? subject
            ? `${step.place} · ${subject}`
            : `${step.place} · ${step.title}`
          : subject || step.title
        lines.push({ bucketId: step.key, row, primary })
      }
    }
    const subtotal = subtotalCents(session!)
    const buffer = Math.round((subtotal * bufferPct) / 100)
    const toPrice = unknownCount(session!)

    return (
      <>
        <div className="flex items-center justify-between">
          <Label>Your budget</Label>
          <button
            type="button"
            onClick={() => setStepIndex(bufferIndex)}
            disabled={isPending}
            className="border-0 bg-transparent p-0 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          >
            back
          </button>
        </div>

        <div className="mt-2 border-t border-rule">
          {lines.length === 0 ? (
            <div className="py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Nothing added yet
            </div>
          ) : (
            lines.map(({ bucketId, row, primary }) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 border-t border-rule py-2 first:border-t-0"
              >
                <span className="min-w-0">
                  <span className="text-[13px] text-foreground">{primary}</span>
                  {row.when ? (
                    <span className="ml-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground">
                      {row.when}
                    </span>
                  ) : null}
                  {row.estimated ? (
                    <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.14em] text-clay">
                      est.
                    </span>
                  ) : null}
                  {row.sourceUrl ? (
                    <a
                      href={row.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-sea underline"
                    >
                      source
                    </a>
                  ) : null}
                </span>
                {row.priceUnknown ? (
                  <span className="inline-flex items-baseline gap-1">
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                      no price
                    </span>
                    <span className="font-mono text-[12px] text-muted-foreground">€</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      placeholder="add"
                      value={row.value}
                      onChange={(e) => editValue(bucketId, row.id, e.target.value)}
                      disabled={isPending}
                      className="t-num w-16 border-0 border-b border-border bg-transparent text-right text-[13px] text-foreground outline-none focus:border-foreground"
                    />
                  </span>
                ) : (
                  <span className="inline-flex items-baseline gap-1">
                    <span className="font-mono text-[12px] text-muted-foreground">€</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      placeholder="0"
                      value={row.value}
                      onChange={(e) => editValue(bucketId, row.id, e.target.value)}
                      disabled={isPending}
                      className="t-num w-20 border-0 border-b border-border bg-transparent text-right text-[13px] text-foreground outline-none focus:border-foreground"
                    />
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {buffer > 0 ? (
          <div className="mt-2 flex items-center justify-between border-t border-rule pt-2 font-mono text-[11px] text-muted-foreground">
            <span>Buffer ({bufferPct}%)</span>
            <span className="t-num">€{fmt(buffer)}</span>
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="font-serif text-[15px] italic text-foreground">Total</span>
          <span className="t-num text-[18px] text-foreground">€{fmt(subtotal + buffer)}</span>
        </div>
        {toPrice > 0 ? (
          <div className="mt-1 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-clay">
            + {toPrice} still to price
          </div>
        ) : null}

        <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          {generated
            ? "Applying sets your trip budget."
            : "Generate fills the gaps, then apply to save."}
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={generate}
            disabled={isPending}
            className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-foreground disabled:opacity-40"
          >
            {isPending ? "…" : generated ? "regenerate" : "generate"}
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={isPending}
            className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            apply
          </button>
          <button
            type="button"
            onClick={() => setSession(null)}
            disabled={isPending}
            className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
          >
            dismiss
          </button>
          {error ? <span className="font-mono text-[9px] text-clay">{error}</span> : null}
        </div>
      </>
    )
  }
}
