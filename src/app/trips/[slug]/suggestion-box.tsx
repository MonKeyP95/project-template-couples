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
  const [isPending, startTransition] = React.useTransition()
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex touch-none items-start gap-3 rounded-md border border-rule bg-card px-3 py-2 ${
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
      <button
        type="button"
        disabled={isPending}
        // Keep a press on Dismiss from starting a drag.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => startTransition(async () => void (await deleteSuggestion(suggestion.id, tripSlug)))}
        className="shrink-0 border-0 bg-transparent p-0 font-mono text-[11px] text-muted-foreground hover:text-clay disabled:opacity-50"
      >
        Dismiss
      </button>
    </div>
  )
}

/** A suggestion sitting on a blank day: one line, never mistaken for an event. */
export function SuggestionLine({
  suggestion,
  onOpen,
}: {
  suggestion: TripSuggestion
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-1.5 flex w-full items-baseline gap-2 border-0 bg-transparent p-0 text-left text-[12.5px] italic text-muted-foreground hover:text-foreground"
    >
      <span className="font-mono text-[9px] not-italic uppercase tracking-[0.14em] text-sea">
        Suggestion
      </span>
      <span>{suggestion.title}</span>
    </button>
  )
}
