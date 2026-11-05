"use client"

import * as React from "react"
import { useDraggable } from "@dnd-kit/core"

import { deleteSuggestion } from "@/lib/trips/suggestion-actions"
import type { TripSuggestion } from "@/lib/trips/suggestion-types"

/** Drag ids of box cards, so the itinerary's one drag handler can tell them
 * apart from days. */
export const SUGGESTION_DRAG_PREFIX = "suggestion:"

function kindLabel(s: TripSuggestion): string {
  return s.kind === "big" ? "Idea" : "Eat & drink"
}

/** The suggestions that don't sit on a blank day. Each card drags onto a day. */
export function SuggestionBox({
  suggestions,
  tripSlug,
}: {
  suggestions: TripSuggestion[]
  tripSlug: string
}) {
  if (suggestions.length === 0) return null
  return (
    <section className="mb-4 rounded-lg border border-dashed border-rule p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Suggestions
        </span>
        <span className="text-[11px] text-muted-foreground">drag one onto a day</span>
      </div>
      <div className="space-y-2">
        {suggestions.map((s) => (
          <SuggestionCard key={s.id} suggestion={s} tripSlug={tripSlug} />
        ))}
      </div>
    </section>
  )
}

function SuggestionCard({ suggestion, tripSlug }: { suggestion: TripSuggestion; tripSlug: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: SUGGESTION_DRAG_PREFIX + suggestion.id,
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex items-start gap-3 rounded-md border border-rule bg-card px-3 py-2 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {kindLabel(suggestion)} · {suggestion.category}
        </div>
        <div className="text-[14px] text-foreground">{suggestion.title}</div>
        {suggestion.why ? (
          <div className="text-[12px] leading-snug text-muted-foreground">{suggestion.why}</div>
        ) : null}
      </div>
      <DismissButton id={suggestion.id} tripSlug={tripSlug} />
    </div>
  )
}

function DismissButton({ id, tripSlug }: { id: string; tripSlug: string }) {
  const [isPending, startTransition] = React.useTransition()
  return (
    <button
      type="button"
      disabled={isPending}
      // Keep a press on Dismiss from starting a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => startTransition(async () => void (await deleteSuggestion(id, tripSlug)))}
      className="shrink-0 border-0 bg-transparent p-0 font-mono text-[11px] text-muted-foreground hover:text-clay disabled:opacity-50"
    >
      Dismiss
    </button>
  )
}

/** While a card's options are searched (10-20s), and the way back when it fails. */
export function SuggestionLookup({
  title,
  error,
  onRetry,
  onCancel,
}: {
  title: string
  error?: string
  onRetry: () => void
  onCancel: () => void
}) {
  const action = "border-0 bg-transparent p-0 font-mono text-[11px] hover:text-foreground"
  return (
    <div role="status" className="mb-4 flex items-baseline gap-3 rounded-md border border-rule px-3 py-2 text-[12.5px]">
      {error ? (
        <>
          <span className="min-w-0 flex-1 text-clay">
            {title}: {error}
          </span>
          <button type="button" onClick={onRetry} className={`${action} text-sea`}>
            Try again
          </button>
          <button type="button" onClick={onCancel} className={`${action} text-muted-foreground`}>
            Cancel
          </button>
        </>
      ) : (
        <span className="text-muted-foreground">Finding options for {title}...</span>
      )}
    </div>
  )
}

/** A suggestion sitting on a blank day: one line, never mistaken for an event. */
export function SuggestionLine({
  suggestion,
  tripSlug,
  onOpen,
}: {
  suggestion: TripSuggestion
  tripSlug: string
  onOpen: () => void
}) {
  return (
    <div className="mt-1.5 flex items-baseline gap-3">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-baseline gap-2 border-0 bg-transparent p-0 text-left text-[12.5px] italic text-muted-foreground hover:text-foreground"
      >
        <span className="font-mono text-[9px] not-italic uppercase tracking-[0.14em] text-sea">
          Suggestion
        </span>
        <span>{suggestion.title}</span>
      </button>
      <DismissButton id={suggestion.id} tripSlug={tripSlug} />
    </div>
  )
}
