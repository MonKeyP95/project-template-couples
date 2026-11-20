"use client"

import * as React from "react"

import { Label } from "@/components/together"
import { planBudgetSteps } from "@/lib/ai/budget-planner"
import {
  draftAndFillBudget,
  type EnteredLine,
  type FilledBudgetLine,
} from "@/lib/ai/budget-actions"
import { deviceToday } from "@/lib/time/today"
import {
  addExpenseCategory,
  payBudgetItem,
  unpayBudgetItem,
  saveBudgetItems,
  savePreTripItems,
  type SaveBudgetItemInput,
} from "@/lib/trips/actions"
import { isBufferSubject, type BudgetItem } from "@/lib/trips/budget-item-types"
import {
  locationDateLabel,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import { moneyInput, moneyRounded, currencySymbol } from "@/lib/money"
import { useCurrency } from "@/components/currency-context"

import {
  preTripBucketFor,
  PreTripStepBody,
  PRE_TRIP_CATEGORY,
  PRE_TRIP_STEPS,
} from "./budget-drafter-pretrip"
import { BudgetDrafterList, type ListGroup } from "./budget-drafter-list"
import { AddCategoryForm } from "./budget-drafter-add-category"
import { PaidChip } from "./paid-chip"
import {
  CATEGORY_BY_STEP,
  extraStep,
  fromPlannedStep,
  insertStep,
  isMultiPlace,
  scopeOf,
  stepFor,
  withLineSteps,
  type DraftStep,
  type StepPlace,
} from "./budget-drafter-steps"
import { toolbarPill } from "./plan-itinerary"

/** stepIndex value for edit mode's heading list. */
const LIST = -1

function asCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

interface ItemRow {
  id: string
  subject: string
  /** Free-text note, kept alongside the structured date range. */
  when: string
  /** Euros; per-day when a range is set, else the one-off total. "" when blank/unknown. */
  value: string
  /** yyyy-mm-dd; a start+end pair means the value is per-day over the span. */
  whenStart?: string
  whenEnd?: string
  /** How the value multiplies: once (x1), times (count or a dated span), daily (day-slots). */
  freq?: "once" | "times" | "daily"
  /** The multiplier for freq "times" (ignored when a date range is set). */
  count?: number
  /** The assistant supplied this amount. */
  estimated?: boolean
  /** Backing web-search URL, when it found one. */
  sourceUrl?: string | null
  /** The assistant couldn't price this; value stays "". */
  priceUnknown?: boolean
  /** Persisted item id, for rows that round-tripped from the budget. */
  serverId?: string
  /** The line's own place; null = trip-wide. A step only sets it for new rows. */
  locationId: string | null
  /** The expense logged when this line was paid, as saved; null while unpaid. */
  paidExpenseId: string | null
  /** Whether the couple wants it paid; Apply pays or unpays to match. */
  paid: boolean
}

/** A saved line, with what the drafter needs to find its step. */
interface SavedLine {
  category: string
  locationId: string | null
  row: Partial<ItemRow>
}

/** Units a dated range spans: nights for accommodation (12->14 = 2), inclusive
 * days for everything else (day 1->5 = 5). Min 1; 1 for a bad/single range. */
function spanCount(category: string, start: string, end: string): number {
  const s = Date.parse(`${start}T00:00:00Z`)
  const e = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 1
  const nights = Math.round((e - s) / 86_400_000)
  return category === "Accommodation" ? Math.max(1, nights) : Math.max(1, nights + 1)
}

function fmtDate(d: string): string {
  const t = Date.parse(`${d}T00:00:00Z`)
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    : d
}

function rangeLabel(row: ItemRow): string {
  if (row.whenStart && row.whenEnd) return `${fmtDate(row.whenStart)} – ${fmtDate(row.whenEnd)}`
  if (row.whenStart) return fmtDate(row.whenStart)
  return ""
}

interface Session {
  steps: DraftStep[]
  /** bucket id (`${stepKey}:${locId|trip}`) -> rows. */
  items: Record<string, ItemRow[]>
  /** Saved category lines this session loaded (buffer included): the only
   * lines Apply may delete. */
  loadedIds: string[]
}

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
  /** The trip's own categories, offered by "+ add a category". */
  expenseCategories: ExpenseCategoryRow[]
  /** Shown at the top of the open drafter's box. */
  header: React.ReactNode
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
  expenseCategories,
  header,
}: BudgetDrafterProps) {
  const { currency } = useCurrency()
  const fmt = (cents: number) => moneyRounded(cents, currency)
  const [session, setSession] = React.useState<Session | null>(null)
  const [stepIndex, setStepIndex] = React.useState(0)
  /** Opened as Edit budget: steps return to the list instead of walking on. */
  const [fromList, setFromList] = React.useState(false)
  const [bufferPct, setBufferPct] = React.useState(bufferRec.pct)
  const [generated, setGenerated] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const itemSeq = React.useRef(0)

  const totalDays = tripDays > 0 ? tripDays : itineraryDays.length
  const places: StepPlace[] = locations.map((l) => ({ id: l.id, name: l.name }))
  if (totalDays === 0 && locations.length === 0) return null

  const preCount = PRE_TRIP_STEPS.length
  const bufferIndex = session ? preCount + session.steps.length : 0
  const reviewIndex = bufferIndex + 1

  function newRow(locationId: string | null, fields: Partial<ItemRow> = {}): ItemRow {
    return {
      id: `it-${itemSeq.current++}`,
      subject: "",
      when: "",
      value: "",
      freq: "once",
      count: 1,
      locationId,
      paidExpenseId: null,
      paid: false,
      ...fields,
    }
  }

  function stepByKey(key: string): DraftStep | undefined {
    return session?.steps.find((s) => s.key === key)
  }

  /** Day-slots for a line: its place's dated days, or the whole trip for a
   * trip-wide line; falls back to the whole trip when a place has none. */
  function placeDays(locationId: string | null): number {
    if (!locationId) return totalDays
    let n = 0
    for (const d of itineraryDays) if (d.locationId === locationId) n++
    return n || totalDays
  }

  /** The multiplier for a row: once -> 1, times -> a dated span or the count,
   * daily -> day-slots (nights for accommodation, inclusive days otherwise). */
  function resolveQty(category: string, row: ItemRow): number {
    const freq = row.freq ?? "once"
    if (freq === "daily") {
      const days = placeDays(row.locationId)
      return category === "Accommodation" ? Math.max(1, days - 1) : Math.max(1, days)
    }
    if (freq === "times") {
      if (row.whenStart && row.whenEnd) return spanCount(category, row.whenStart, row.whenEnd)
      return Math.max(1, row.count ?? 1)
    }
    return 1
  }

  /** A row's total in cents: per-unit value times its resolved quantity. */
  function rowTotalCents(category: string, row: ItemRow): number {
    return asCents(row.value) * resolveQty(category, row)
  }

  /** Unit hint shown after the price input. */
  function rowUnitSuffix(row: ItemRow): string {
    const freq = row.freq ?? "once"
    if (freq === "daily") return "/day"
    if (freq === "times") return row.whenStart && row.whenEnd ? "/day" : "each"
    return ""
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

  /** Every saved trip line (not the derived buffer, not Pre-trip), keeping its
   * own category, place, marks and id. Each gets a step; none is moved. */
  function savedRows(): SavedLine[] {
    const out: SavedLine[] = []
    for (const it of initialItems) {
      if (isBufferSubject(it.subject) || it.category === PRE_TRIP_CATEGORY) continue
      // Pre-how-often rows stored a dated range under the default freq; treat them as times.
      const freq: ItemRow["freq"] =
        it.freq === "times" || it.freq === "daily"
          ? it.freq
          : it.whenStart && it.whenEnd
            ? "times"
            : "once"
      const rowLike: ItemRow = {
        id: "",
        subject: it.subject,
        when: it.whenLabel,
        value: "",
        freq,
        count: it.count || 1,
        whenStart: it.whenStart ?? "",
        whenEnd: it.whenEnd ?? "",
        locationId: it.locationId,
        paidExpenseId: it.paidExpenseId,
        paid: it.paidExpenseId != null,
      }
      // A stored line holds the total; divide back to the per-unit value.
      const qty = resolveQty(it.category, rowLike)
      const per = qty > 1 ? Math.round(it.amountCents / qty) : it.amountCents
      out.push({ category: it.category, locationId: it.locationId, row: {
        serverId: it.id,
        locationId: it.locationId,
        paidExpenseId: it.paidExpenseId,
        paid: it.paidExpenseId != null,
        subject: it.subject,
        when: it.whenLabel,
        value: it.priceUnknown ? "" : per ? moneyInput(per) : "",
        freq,
        count: it.count || 1,
        whenStart: it.whenStart ?? "",
        whenEnd: it.whenEnd ?? "",
        estimated: it.estimated,
        sourceUrl: it.sourceUrl,
        priceUnknown: it.priceUnknown,
      } })
    }
    return out
  }

  /** Saved Pre-trip items -> rows per pre-trip bucket, keeping each item's id so
   * a later save updates it in place (and keeps its paid link). */
  function savedPreTripRows(): Record<string, Partial<ItemRow>[]> {
    const out: Record<string, Partial<ItemRow>[]> = {}
    for (const it of initialItems) {
      if (it.category !== PRE_TRIP_CATEGORY) continue
      const bucket = preTripBucketFor(it.subject)
      ;(out[bucket] ??= []).push({
        serverId: it.id,
        paidExpenseId: it.paidExpenseId,
        paid: it.paidExpenseId != null,
        subject: it.subject,
        when: it.whenLabel,
        value: it.amountCents > 0 ? moneyInput(it.amountCents) : "",
      })
    }
    return out
  }

  /** The buffer % an existing budget was saved with, read back off its derived
   * line. Null means the saved budget carries no buffer line at all, which the
   * write path only does for a deliberate 0% — not "unknown". */
  function savedBufferPct(): number | null {
    const it = initialItems.find((i) => isBufferSubject(i.subject))
    const n = Number(it?.subject.match(/\((\d+(?:\.\d+)?)\s*%\)/)?.[1])
    return Number.isFinite(n) ? n : null
  }

  /** Saved lines each go to their step; on a first plan, itinerary items not
   * already among a step's lines follow, so the save keeps both. */
  function seedSession(
    saved: SavedLine[],
    seeds: Record<string, string[]>,
    pct: number,
    startIndex: number,
  ) {
    const planned = planBudgetSteps({
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
    const steps = withLineSteps(
      planned.map((s) => fromPlannedStep(s, places)),
      saved,
      places,
    )
    const items: Record<string, ItemRow[]> = {}
    for (const l of saved) {
      const step = stepFor(steps, l.category, l.locationId, places)!
      ;(items[step.key] ??= []).push(newRow(l.locationId, l.row))
    }
    for (const [key, subjects] of Object.entries(seeds)) {
      const step = steps.find((s) => s.key === key)
      if (!step) continue
      const rows = (items[key] ??= [])
      const have = new Set(rows.map((r) => r.subject.trim().toLowerCase()))
      for (const subject of subjects) {
        if (!have.has(subject.toLowerCase())) rows.push(newRow(step.locationId, { subject }))
      }
    }
    for (const step of steps) {
      if (!items[step.key]?.length) items[step.key] = [newRow(step.locationId)]
    }
    // Pre-trip buckets always come from what's saved: there is nothing in the
    // itinerary to seed them from.
    const pre = savedPreTripRows()
    for (const step of PRE_TRIP_STEPS) {
      const rows = (pre[step.key] ?? []).map((r) =>
        newRow(null, { subject: step.fixedSubject ?? "", ...r }),
      )
      items[step.key] =
        rows.length > 0
          ? rows
          : step.fixedSubject === null
            ? []
            : [newRow(null, { subject: step.fixedSubject })]
    }
    setError(null)
    setGenerated(false)
    setBufferPct(pct)
    setStepIndex(startIndex)
    const loadedIds = saved.flatMap((l) => (l.row.serverId ? [l.row.serverId] : []))
    const buffer = initialItems.find((i) => isBufferSubject(i.subject))
    if (buffer) loadedIds.push(buffer.id)
    setSession({ steps, items, loadedIds })
  }

  /** A saved budget opens on the heading list; a first plan walks from step 1. */
  function open() {
    const restore = plannedBudgetCents > 0
    setFromList(restore)
    if (restore) seedSession(savedRows(), {}, savedBufferPct() ?? 0, LIST)
    else seedSession(savedRows(), itinerarySeeds, bufferRec.pct, 0)
  }

  function addItem(bucketId: string, fields: Partial<ItemRow> = {}) {
    const row = newRow(stepByKey(bucketId)?.locationId ?? null, fields)
    setSession((s) =>
      s
        ? {
            ...s,
            items: { ...s.items, [bucketId]: [...(s.items[bucketId] ?? []), row] },
          }
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

  /** Flips the wanted paid state only; Apply settles it with the server. */
  function togglePaid(bucketId: string, id: string) {
    setSession((s) =>
      s
        ? {
            ...s,
            items: {
              ...s.items,
              [bucketId]: (s.items[bucketId] ?? []).map((r) =>
                r.id === id ? { ...r, paid: !r.paid } : r,
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
  function normalizeStep(step: DraftStep) {
    setSession((s) => {
      if (!s) return s
      const rows = (s.items[step.key] ?? []).filter(
        (r) => r.subject.trim() !== "" || r.when.trim() !== "" || r.value.trim() !== "",
      )
      return { ...s, items: { ...s.items, [step.key]: rows } }
    })
  }

  function leaveStepTo(next: number) {
    if (!session) return
    const catIndex = stepIndex - preCount
    if (catIndex >= 0 && catIndex < session.steps.length) {
      normalizeStep(session.steps[catIndex])
    }
    setStepIndex(next)
  }

  function goNext() {
    leaveStepTo(stepIndex + 1)
  }

  function collectLines(s: Session): EnteredLine[] {
    const { nameById } = locContext()
    const lines: EnteredLine[] = []
    for (const step of s.steps) {
      for (const r of s.items[step.key] ?? []) {
        if (r.subject.trim() === "" && r.value.trim() === "") continue
        const cents = rowTotalCents(step.category, r)
        const whenLabel = [rangeLabel(r), r.when.trim()].filter(Boolean).join(" · ")
        lines.push({
          rowId: r.id,
          category: step.category,
          place: r.locationId ? (nameById[r.locationId] ?? "") : "",
          subject: r.subject.trim(),
          whenLabel,
          amountEuros: cents > 0 ? cents / 100 : null,
        })
      }
    }
    return lines
  }

  /** Generate's results patched onto the rows they came from. Only the lines
   * the assistant priced (or couldn't) change; typed prices stay as typed. */
  function applyFills(
    items: Record<string, ItemRow[]>,
    lines: FilledBudgetLine[],
  ): Record<string, ItemRow[]> {
    const fills = new Map(
      lines.filter((l) => l.estimated || l.priceUnknown).map((l) => [l.rowId, l]),
    )
    const out: Record<string, ItemRow[]> = {}
    for (const [key, rows] of Object.entries(items)) {
      out[key] = rows.map((r) => {
        const f = fills.get(r.id)
        if (!f) return r
        return {
          ...r,
          value: f.priceUnknown ? "" : moneyInput(f.amountCents),
          estimated: f.estimated,
          sourceUrl: f.sourceUrl,
          priceUnknown: f.priceUnknown,
          freq: "once",
          count: 1,
        }
      })
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
      setSession((s) => (s ? { ...s, items: applyFills(s.items, r.lines ?? []) } : s))
      setGenerated(true)
    })
  }

  /** The trip-category subtotal — the base the buffer is a percentage of. */
  function subtotalCents(s: Session): number {
    let sum = 0
    for (const step of s.steps) {
      for (const r of s.items[step.key] ?? []) sum += rowTotalCents(step.category, r)
    }
    return sum
  }

  /** The before-you-go subtotal. Sits outside the buffer base: flights and
   * insurance are prices you looked up, not estimates needing a cushion. */
  function preTripSubtotalCents(s: Session): number {
    let sum = 0
    for (const step of PRE_TRIP_STEPS) {
      for (const r of s.items[step.key] ?? []) sum += asCents(r.value)
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
    for (const step of session.steps) {
      for (const r of session.items[step.key] ?? []) {
        const cents = rowTotalCents(step.category, r)
        if (r.subject.trim() === "" && cents === 0 && !r.priceUnknown) continue
        items.push({
          id: r.serverId,
          category: step.category,
          subject: r.subject,
          whenLabel: r.when,
          amountCents: cents,
          locationId: r.locationId,
          whenStart: r.whenStart || null,
          whenEnd: r.whenEnd || null,
          estimated: r.estimated ?? false,
          sourceUrl: r.sourceUrl ?? null,
          priceUnknown: r.priceUnknown ?? false,
          freq: r.freq ?? "once",
          count: r.count ?? 1,
        })
      }
    }
    const buffer = Math.round((subtotalCents(session) * bufferPct) / 100)
    // Keyed on the percentage, not the amount: a chosen % with nothing priced
    // yet still has to be recorded, or reopening loses it.
    if (bufferPct > 0) {
      items.push({
        category: "Other",
        subject: `Buffer (${bufferPct}%)`,
        whenLabel: "",
        amountCents: buffer,
        locationId: null,
      })
    }
    const preItems: SaveBudgetItemInput[] = []
    for (const step of PRE_TRIP_STEPS) {
      for (const r of session.items[step.key] ?? []) {
        const cents = asCents(r.value)
        if (cents === 0 || r.subject.trim() === "") continue
        preItems.push({
          id: r.serverId,
          category: PRE_TRIP_CATEGORY,
          subject: r.subject.trim(),
          whenLabel: r.when.trim(),
          amountCents: cents,
          locationId: null,
        })
      }
    }

    const keptIds = new Set(items.map((it) => it.id))
    const removedIds = session.loadedIds.filter((id) => !keptIds.has(id))
    // Saved lines whose paid mark changed; settled after the saves so a paid
    // expense carries the amount just written.
    const savedIds = new Set([...keptIds, ...preItems.map((it) => it.id)])
    const toggles = Object.values(session.items)
      .flat()
      .filter(
        (r) => r.serverId && savedIds.has(r.serverId) && r.paid !== (r.paidExpenseId != null),
      )

    startTransition(async () => {
      // Pre-trip first so the estimate seed, which runs on the second save,
      // sees both halves.
      const pre = await savePreTripItems({ tripId, tripSlug, items: preItems })
      if (pre.error) {
        setError(pre.error)
        return
      }
      const r = await saveBudgetItems({ tripId, tripSlug, items, removedIds })
      if (r.error) {
        setError(r.error)
        return
      }
      for (const row of toggles) {
        const id = row.serverId!
        const res = row.paid
          ? await payBudgetItem(id, tripSlug, deviceToday())
          : await unpayBudgetItem(id, tripSlug)
        if (res.error) {
          setError(res.error)
          return
        }
      }
      setSession(null)
    })
  }

  // A pill plus, when open, a full-width box: both are flex children of the
  // budget toolbar's pill row.
  const pill = (
    <button
      type="button"
      onClick={session ? () => setSession(null) : open}
      aria-expanded={session !== null}
      className={toolbarPill(session !== null, "dusk")}
    >
      {plannedBudgetCents > 0 ? "edit budget" : "plan a budget"}
    </button>
  )

  if (!session) return pill

  return (
    <>
      {pill}
      <div className="order-last w-full overflow-hidden rounded-xl border border-border bg-card">
        {header}
        <div className="px-5 pt-4 pb-4">
          <div className="rounded-lg border border-border bg-card px-3.5 py-3">
            {stepIndex === LIST
              ? renderList()
              : stepIndex < preCount
              ? renderPreTripStep(stepIndex)
              : stepIndex < bufferIndex
                ? renderStep(session.steps[stepIndex - preCount])
                : stepIndex === bufferIndex
                  ? renderBuffer()
                  : renderReview()}
          </div>
        </div>
      </div>
    </>
  )

  /** The review step's write, offered from every step: editing one line
   * shouldn't need a walk to the end. Carries the error, which otherwise only
   * has a home on the review step. */
  function saveFromHere() {
    return (
      <>
        {error ? <span className="font-mono text-[9px] text-clay">{error}</span> : null}
        <button
          type="button"
          onClick={apply}
          disabled={isPending}
          className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-foreground disabled:opacity-40"
        >
          {isPending ? "…" : "save"}
        </button>
      </>
    )
  }

  function listButton() {
    return (
      <button
        type="button"
        onClick={() => leaveStepTo(LIST)}
        disabled={isPending}
        className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
      >
        list
      </button>
    )
  }

  /** The trip steps as list groups: one per place then Trip on a multi-place
   * trip, else a single Trip group. The group names the place, so rows don't. */
  function tripGroups(s: Session, amount: (cents: number) => string): ListGroup[] {
    const row = (step: DraftStep) => ({
      index: preCount + s.steps.indexOf(step),
      label: step.title,
      amount: amount(
        (s.items[step.key] ?? []).reduce((n, r) => n + rowTotalCents(step.category, r), 0),
      ),
    })
    const inScope = (scope: string | null) =>
      s.steps.filter((st) => scopeOf(st.locationId, places) === scope).map(row)
    if (!isMultiPlace(places)) return [{ title: "Trip", rows: s.steps.map(row) }]
    return [
      ...places.map((p) => ({ title: p.name, rows: inScope(p.id) })),
      { title: "Trip", rows: inScope(null) },
    ]
  }

  /** Opens the step for a category in a scope, creating it (and, for a new
   * name, the trip category) first. Names match existing ones ignoring case. */
  function addCategory(name: string, locationId: string | null) {
    if (!session || isPending) return
    const known = categoryNames()
    const category = known.find((c) => c.toLowerCase() === name.toLowerCase()) ?? name
    const isNew = !known.includes(category)
    setError(null)
    startTransition(async () => {
      if (isNew) {
        const r = await addExpenseCategory(tripId, tripSlug, category)
        if (r.error) {
          setError(r.error)
          return
        }
      }
      const existing = stepFor(session.steps, category, locationId, places)
      const step = existing ?? extraStep(category, locationId, places)
      const steps = existing ? session.steps : insertStep(session.steps, step, places)
      const items = existing
        ? session.items
        : { ...session.items, [step.key]: [newRow(locationId)] }
      setSession({ ...session, steps, items })
      setStepIndex(preCount + steps.indexOf(step))
    })
  }

  /** The fixed six plus the trip's own categories, without Pre-trip. */
  function categoryNames(): string[] {
    const names = [...Object.values(CATEGORY_BY_STEP)]
    for (const c of expenseCategories) {
      if (c.name !== PRE_TRIP_CATEGORY && !names.includes(c.name)) names.push(c.name)
    }
    return names
  }

  function renderList() {
    const s = session!
    const amount = (cents: number) => (cents > 0 ? fmt(cents) : "")
    const subtotal = subtotalCents(s)
    const buffer = Math.round((subtotal * bufferPct) / 100)
    const total = preTripSubtotalCents(s) + subtotal + buffer
    const groups: ListGroup[] = [
      {
        title: "Before you go",
        rows: PRE_TRIP_STEPS.map((step, i) => ({
          index: i,
          label: step.label,
          amount: amount((s.items[step.key] ?? []).reduce((n, r) => n + asCents(r.value), 0)),
        })),
      },
      ...tripGroups(s, amount),
      {
        title: "Finish",
        rows: [
          {
            index: bufferIndex,
            label: `Buffer (${bufferPct}%)`,
            amount: amount(buffer),
          },
          { index: reviewIndex, label: "Review & generate", amount: amount(total) },
        ],
      },
    ]
    return (
      <BudgetDrafterList
        groups={groups}
        total={fmt(total)}
        error={error}
        isPending={isPending}
        onOpen={setStepIndex}
        onSave={apply}
        onCancel={() => setSession(null)}
        footer={
          <AddCategoryForm
            categories={categoryNames()}
            places={isMultiPlace(places) ? places : []}
            disabled={isPending}
            onAdd={addCategory}
          />
        }
      />
    )
  }

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
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input
            type="text"
            value={row.when}
            placeholder="Note (optional)"
            onChange={(e) => patchItem(bucketId, row.id, { when: e.target.value })}
            disabled={isPending}
            className="min-w-0 flex-1 border-0 border-b border-border bg-transparent font-mono text-[11px] tracking-[0.04em] text-muted-foreground outline-none focus:border-foreground"
          />

          <div className="inline-flex items-center gap-0.5">
            {(["once", "times", "daily"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => patchItem(bucketId, row.id, { freq: f })}
                disabled={isPending}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${
                  (row.freq ?? "once") === f
                    ? "border-0 bg-foreground text-background"
                    : "border border-border bg-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "times" ? "× n" : f}
              </button>
            ))}
          </div>

          {(row.freq ?? "once") === "times" ? (
            <>
              {!(row.whenStart && row.whenEnd) ? (
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  aria-label="Times"
                  value={row.count ?? 1}
                  onChange={(e) =>
                    patchItem(bucketId, row.id, {
                      count: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                    })
                  }
                  disabled={isPending}
                  className="t-num w-10 border-0 border-b border-border bg-transparent text-right text-[13px] text-foreground outline-none focus:border-foreground"
                />
              ) : null}
              <input
                type="date"
                aria-label="Start date"
                value={row.whenStart ?? ""}
                onChange={(e) => patchItem(bucketId, row.id, { whenStart: e.target.value })}
                disabled={isPending}
                className="rounded border border-border bg-transparent px-1.5 py-1 font-mono text-[10px] text-foreground outline-none focus:border-foreground"
              />
              <input
                type="date"
                aria-label="End date"
                value={row.whenEnd ?? ""}
                min={row.whenStart || undefined}
                onChange={(e) => patchItem(bucketId, row.id, { whenEnd: e.target.value })}
                disabled={isPending}
                className="rounded border border-border bg-transparent px-1.5 py-1 font-mono text-[10px] text-foreground outline-none focus:border-foreground"
              />
            </>
          ) : null}

          <span className="inline-flex items-baseline gap-1">
            <span className="font-mono text-[12px] text-muted-foreground">{currencySymbol(currency)}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={row.value}
              onChange={(e) => editValue(bucketId, row.id, e.target.value)}
              disabled={isPending}
              className="t-num w-16 border-0 border-b border-border bg-transparent text-right text-[14px] text-foreground outline-none focus:border-foreground"
            />
            {rowUnitSuffix(row) ? (
              <span className="font-mono text-[9px] text-muted-foreground">{rowUnitSuffix(row)}</span>
            ) : null}
          </span>
          {row.serverId && asCents(row.value) > 0 ? (
            <PaidChip
              paid={row.paid}
              disabled={isPending}
              onToggle={() => togglePaid(bucketId, row.id)}
            />
          ) : null}
        </div>
      </div>
    )
  }

  function renderPreTripStep(i: number) {
    const step = PRE_TRIP_STEPS[i]
    return (
      <>
        <div className="flex items-center justify-between">
          <Label>before you go</Label>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            step {i + 1} of {bufferIndex + 2}
          </span>
        </div>

        <PreTripStepBody
          step={step}
          rows={session!.items[step.key] ?? []}
          disabled={isPending}
          onPatch={(id, patch) => patchItem(step.key, id, patch)}
          onAdd={() => addItem(step.key, { subject: step.fixedSubject ?? "" })}
          onRemove={(id) => removeItem(step.key, id)}
          onTogglePaid={(id) => togglePaid(step.key, id)}
        />

        <div className="mt-4 flex items-center justify-between">
          {fromList ? (
            listButton()
          ) : (
            <button
              type="button"
              onClick={() => setStepIndex((s) => Math.max(0, s - 1))}
              disabled={i === 0}
              className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              back
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSession(null)}
              className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              cancel
            </button>
            {saveFromHere()}
            {fromList ? null : (
              <button
                type="button"
                onClick={() => setStepIndex((s) => s + 1)}
                className="rounded-full border-0 bg-sea px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
              >
                next
              </button>
            )}
          </div>
        </div>
      </>
    )
  }

  function renderStep(step: DraftStep) {
    return (
      <>
        <div className="flex items-center justify-between">
          <Label>/ assistant</Label>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            step {stepIndex + 1} of {bufferIndex + 2}
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
          {fromList ? (
            listButton()
          ) : (
            <button
              type="button"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              disabled={stepIndex === 0}
              className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              back
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSession(null)}
              className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              cancel
            </button>
            {saveFromHere()}
            {fromList ? null : (
              <button
                type="button"
                onClick={goNext}
                className="rounded-full border-0 bg-sea px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
              >
                next
              </button>
            )}
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
          {fromList ? (
            listButton()
          ) : (
            <button
              type="button"
              onClick={() => setStepIndex(bufferIndex - 1)}
              className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
            >
              back
            </button>
          )}
          <div className="flex items-center gap-1.5">
            {saveFromHere()}
            {fromList ? null : (
              <button
                type="button"
                onClick={() => setStepIndex(reviewIndex)}
                className="rounded-full border-0 bg-sea px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
              >
                review
              </button>
            )}
          </div>
        </div>
      </>
    )
  }

  function renderReview() {
    const lines: { bucketId: string; category: string; row: ItemRow; primary: string }[] = []
    for (const step of session!.steps) {
      for (const row of session!.items[step.key] ?? []) {
        const subject = row.subject.trim()
        const primary = step.place
          ? subject
            ? `${step.place} · ${subject}`
            : `${step.place} · ${step.title}`
          : subject || step.title
        lines.push({ bucketId: step.key, category: step.category, row, primary })
      }
    }
    const subtotal = subtotalCents(session!)
    const buffer = Math.round((subtotal * bufferPct) / 100)
    const toPrice = unknownCount(session!)
    const preLines: { key: string; row: ItemRow }[] = []
    for (const step of PRE_TRIP_STEPS) {
      for (const row of session!.items[step.key] ?? []) {
        if (asCents(row.value) === 0 && row.subject.trim() === "") continue
        preLines.push({ key: step.key, row })
      }
    }
    const preSubtotal = preTripSubtotalCents(session!)

    return (
      <>
        <div className="flex items-center justify-between">
          <Label>Your budget</Label>
          <button
            type="button"
            onClick={() => setStepIndex(fromList ? LIST : bufferIndex)}
            disabled={isPending}
            className="border-0 bg-transparent p-0 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          >
            {fromList ? "list" : "back"}
          </button>
        </div>

        {preLines.length > 0 ? (
          <div className="mt-2">
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              Before you go
            </div>
            <div className="mt-1 border-t border-rule">
              {preLines.map(({ key, row }) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-3 border-t border-rule py-2 first:border-t-0"
                >
                  <span className="min-w-0">
                    <span className="text-[13px] text-foreground">{row.subject.trim()}</span>
                    {row.when.trim() ? (
                      <span className="ml-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground">
                        {row.when.trim()}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-flex items-baseline gap-1">
                      <span className="font-mono text-[12px] text-muted-foreground">{currencySymbol(currency)}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        placeholder="0"
                        value={row.value}
                        onChange={(e) => patchItem(key, row.id, { value: e.target.value })}
                        disabled={isPending}
                        className="t-num w-16 border-0 border-b border-border bg-transparent text-right text-[13px] text-foreground outline-none focus:border-foreground"
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(key, row.id)}
                      disabled={isPending}
                      aria-label="Remove"
                      className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-rule pt-2 font-mono text-[11px] text-muted-foreground">
              <span>Before you go</span>
              <span className="t-num">{fmt(preSubtotal)}</span>
            </div>
            <div className="mt-3 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              Trip
            </div>
          </div>
        ) : null}

        <div className="mt-2 border-t border-rule">
          {lines.length === 0 ? (
            <div className="py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Nothing added yet
            </div>
          ) : (
            lines.map(({ bucketId, category, row, primary }) => {
              const qty = resolveQty(category, row)
              const freq = row.freq ?? "once"
              const qtyLabel =
                freq === "daily"
                  ? "daily"
                  : freq === "times" && !(row.whenStart && row.whenEnd)
                    ? `× ${row.count ?? 1}`
                    : ""
              const meta = [rangeLabel(row), qtyLabel, row.when.trim()].filter(Boolean).join(" · ")
              const multi = qty > 1 && !row.priceUnknown
              return (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 border-t border-rule py-2 first:border-t-0"
              >
                <span className="min-w-0">
                  <span className="text-[13px] text-foreground">{primary}</span>
                  {meta ? (
                    <span className="ml-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground">
                      {meta}
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
                <span className="flex items-center gap-2">
                {row.priceUnknown ? (
                  <span className="inline-flex items-baseline gap-1">
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                      no price
                    </span>
                    <span className="font-mono text-[12px] text-muted-foreground">{currencySymbol(currency)}</span>
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
                    <span className="font-mono text-[12px] text-muted-foreground">{currencySymbol(currency)}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      placeholder="0"
                      value={row.value}
                      onChange={(e) => editValue(bucketId, row.id, e.target.value)}
                      disabled={isPending}
                      className="t-num w-16 border-0 border-b border-border bg-transparent text-right text-[13px] text-foreground outline-none focus:border-foreground"
                    />
                    {multi ? (
                      <span className="font-mono text-[9px] text-muted-foreground">
                        × {qty} = {fmt(rowTotalCents(category, row))}
                      </span>
                    ) : null}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeItem(bucketId, row.id)}
                  disabled={isPending}
                  aria-label="Remove"
                  className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
                </span>
              </div>
              )
            })
          )}
        </div>

        {buffer > 0 ? (
          <div className="mt-2 flex items-center justify-between border-t border-rule pt-2 font-mono text-[11px] text-muted-foreground">
            <span>Buffer ({bufferPct}%)</span>
            <span className="t-num">{fmt(buffer)}</span>
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="font-serif text-[15px] italic text-foreground">Total</span>
          <span className="t-num text-[18px] text-foreground">
            {fmt(preSubtotal + subtotal + buffer)}
          </span>
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
            className="rounded-full border-0 bg-sea px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
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
