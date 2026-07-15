"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { Label } from "@/components/together"
import {
  ITINERARY_CATEGORIES,
  itemsToSkeleton,
  type DraftItem,
} from "@/lib/ai/itinerary-planner"
import { applyItinerarySkeleton, draftItineraryItems } from "@/lib/ai/itinerary-actions"
import { formatShortDate } from "@/lib/trips/itinerary-types"

export interface PlanItineraryProps {
  tripId: string
  tripSlug: string
  destination: string
  /** The trip's own name — the location fallback when no place is typed (never the country). */
  tripName: string
  startDate: string
  dayCount: number
}

type Phase = "setup" | "walk"

/** Advance a YYYY-MM-DD date by n days (UTC, no tz drift). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function PlanItinerary({
  tripId,
  tripSlug,
  destination,
  tripName,
  startDate,
  dayCount,
}: PlanItineraryProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = React.useState(searchParams.get("plan") === "1")
  const [phase, setPhase] = React.useState<Phase>("setup")
  const [catIdx, setCatIdx] = React.useState(0)
  const [placeNames, setPlaceNames] = React.useState<string[]>([""])
  const [freeText, setFreeText] = React.useState("")
  const [answer, setAnswer] = React.useState("")
  const [question, setQuestion] = React.useState("")
  const [items, setItems] = React.useState<DraftItem[]>([])
  const [drafted, setDrafted] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const tripDates = React.useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(startDate, i)),
    [startDate, dayCount],
  )
  const trimmedPlaces = placeNames.map((n) => n.trim()).filter((n) => n.length > 0)

  function reset() {
    setOpen(false)
    setPhase("setup")
    setCatIdx(0)
    setPlaceNames([""])
    setFreeText("")
    setAnswer("")
    setQuestion("")
    setItems([])
    setDrafted(true)
    setError(null)
  }

  function generate() {
    const combined = [freeText.trim(), answer.trim()].filter(Boolean).join(" ")
    setError(null)
    startTransition(async () => {
      try {
        const res = await draftItineraryItems({
          tripSlug,
          dayCount,
          placeNames: trimmedPlaces,
          freeText: combined,
        })
        if (res.question) {
          setQuestion(res.question)
          return
        }
        setItems(res.items)
        setDrafted(res.drafted)
        setQuestion("")
        setPhase("walk")
        setCatIdx(0)
      } catch {
        setError("Couldn't draft right now — try again.")
      }
    })
  }

  function skip() {
    setItems([])
    setDrafted(true)
    setQuestion("")
    setPhase("walk")
    setCatIdx(0)
  }

  function editItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === index ? { ...it, ...patch } : it)))
  }

  function addItem(category: string) {
    setItems((prev) => [...prev, { category, place: "", text: "", date: "", time: "" }])
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== index))
  }

  function apply() {
    if (isPending) return
    const skeleton = itemsToSkeleton(items, trimmedPlaces, tripName, startDate, dayCount)
    startTransition(async () => {
      const r = await applyItinerarySkeleton({ tripId, tripSlug, skeleton })
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
        {phase === "setup" ? (
          <SetupStep
            destination={destination}
            placeNames={placeNames}
            freeText={freeText}
            question={question}
            answer={answer}
            isPending={isPending}
            error={error}
            onPlaceName={(i, v) =>
              setPlaceNames((prev) => prev.map((n, idx) => (idx === i ? v : n)))
            }
            onAddPlace={() => setPlaceNames((prev) => [...prev, ""])}
            onRemovePlace={(i) => setPlaceNames((prev) => prev.filter((_, idx) => idx !== i))}
            onFreeText={setFreeText}
            onAnswer={setAnswer}
            onGenerate={generate}
            onSkip={skip}
            onCancel={reset}
          />
        ) : (
          <CategoryStep
            category={ITINERARY_CATEGORIES[catIdx]}
            stepNo={catIdx + 1}
            stepCount={ITINERARY_CATEGORIES.length}
            items={items}
            placeNames={trimmedPlaces}
            tripDates={tripDates}
            drafted={drafted}
            isPending={isPending}
            error={error}
            isLast={catIdx === ITINERARY_CATEGORIES.length - 1}
            onEdit={editItem}
            onAdd={addItem}
            onRemove={removeItem}
            onBack={() => (catIdx === 0 ? setPhase("setup") : setCatIdx((c) => c - 1))}
            onNext={() => setCatIdx((c) => c + 1)}
            onApply={apply}
            onCancel={reset}
          />
        )}
      </div>
    </div>
  )
}

function SetupStep({
  destination,
  placeNames,
  freeText,
  question,
  answer,
  isPending,
  error,
  onPlaceName,
  onAddPlace,
  onRemovePlace,
  onFreeText,
  onAnswer,
  onGenerate,
  onSkip,
  onCancel,
}: {
  destination: string
  placeNames: string[]
  freeText: string
  question: string
  answer: string
  isPending: boolean
  error: string | null
  onPlaceName: (i: number, v: string) => void
  onAddPlace: () => void
  onRemovePlace: (i: number) => void
  onFreeText: (v: string) => void
  onAnswer: (v: string) => void
  onGenerate: () => void
  onSkip: () => void
  onCancel: () => void
}) {
  return (
    <>
      <Label>Plan your itinerary</Label>
      <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {destination}
      </div>

      <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Places
      </div>
      <div className="mt-1.5 space-y-1.5">
        {placeNames.map((name, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={name}
              placeholder={`Place ${i + 1}`}
              onChange={(e) => onPlaceName(i, e.target.value)}
              className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
            />
            <button
              type="button"
              onClick={() => onRemovePlace(i)}
              aria-label="Remove place"
              className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2">
        <button
          type="button"
          onClick={onAddPlace}
          className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
        >
          + add place
        </button>
      </div>

      <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Anything else
      </div>
      <textarea
        value={freeText}
        onChange={(e) => onFreeText(e.target.value)}
        rows={2}
        placeholder="Notes for the assistant…"
        className="mt-1.5 w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-foreground"
      />

      {question ? (
        <div className="mt-3 rounded-md border border-l-2 border-border border-l-moss bg-background px-2.5 py-2">
          <p className="text-[12.5px] leading-snug text-moss">{question}</p>
          <input
            type="text"
            value={answer}
            onChange={(e) => onAnswer(e.target.value)}
            placeholder="your answer (optional)…"
            className="mt-1.5 w-full border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
          />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onGenerate}
          disabled={isPending}
          className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "Drafting…" : question ? "Answer & generate" : "Generate"}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={isPending}
          className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-40"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-40"
        >
          Cancel
        </button>
        {error ? <span className="font-mono text-[9px] text-clay">{error}</span> : null}
      </div>
    </>
  )
}

function CategoryStep({
  category,
  stepNo,
  stepCount,
  items,
  placeNames,
  tripDates,
  drafted,
  isPending,
  error,
  isLast,
  onEdit,
  onAdd,
  onRemove,
  onBack,
  onNext,
  onApply,
  onCancel,
}: {
  category: string
  stepNo: number
  stepCount: number
  items: DraftItem[]
  placeNames: string[]
  tripDates: string[]
  drafted: boolean
  isPending: boolean
  error: string | null
  isLast: boolean
  onEdit: (index: number, patch: Partial<DraftItem>) => void
  onAdd: (category: string) => void
  onRemove: (index: number) => void
  onBack: () => void
  onNext: () => void
  onApply: () => void
  onCancel: () => void
}) {
  // Keep each item's real index in the full array so edits target the right one.
  const rows = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.category === category)

  return (
    <>
      <div className="flex items-center justify-between">
        <Label>{category}</Label>
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          {stepNo} of {stepCount}
        </span>
      </div>
      {!drafted ? (
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          blank draft — turn the assistant on for suggestions.
        </p>
      ) : null}

      <div className="mt-2 space-y-2">
        {rows.length === 0 ? (
          <p className="font-serif text-[14px] italic text-muted-foreground">Nothing here yet.</p>
        ) : (
          rows.map(({ item, index }) => (
            <div key={index} className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.text}
                  placeholder="What"
                  onChange={(e) => onEdit(index, { text: e.target.value })}
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
                />
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label="Remove item"
                  className="border-0 bg-transparent font-mono text-[12px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={item.place}
                  onChange={(e) => onEdit(index, { place: e.target.value })}
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground outline-none focus:border-foreground"
                >
                  <option value="">(no place)</option>
                  {placeNames.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <select
                  value={item.date}
                  onChange={(e) => onEdit(index, { date: e.target.value })}
                  className="t-num shrink-0 border-0 border-b border-border bg-transparent font-mono text-[10px] text-muted-foreground outline-none focus:border-foreground"
                >
                  <option value="">no date</option>
                  {tripDates.map((d) => (
                    <option key={d} value={d}>
                      {formatShortDate(d)}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={item.time}
                  placeholder="time"
                  onChange={(e) => onEdit(index, { time: e.target.value })}
                  className="t-num w-14 shrink-0 border-0 border-b border-border bg-transparent font-mono text-[11px] text-muted-foreground outline-none focus:border-foreground"
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-2">
        <button
          type="button"
          onClick={() => onAdd(category)}
          className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
        >
          + add {category.toLowerCase()}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onBack}
          disabled={isPending}
          className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-40"
        >
          Back
        </button>
        {isLast ? (
          <button
            type="button"
            onClick={onApply}
            disabled={isPending}
            className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "…" : "Apply"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            disabled={isPending}
            className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            Next →
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-40"
        >
          Cancel
        </button>
        {error ? <span className="font-mono text-[9px] text-clay">{error}</span> : null}
      </div>
    </>
  )
}
