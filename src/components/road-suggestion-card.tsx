"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Label } from "@/components/together"
import {
  addSuggestion,
  dismissSuggestion,
} from "@/lib/trips/road-suggestion-actions"
import type { SuggestionCardData } from "@/lib/trips/road-suggestion-types"

/**
 * The one answerable card in the dispatch box. `add` commits it to today's day
 * through the same action the find door uses; dismiss records the refusal.
 * Either answer removes the card, so there is no answered state to render.
 */
export function RoadSuggestionCard({
  data,
  onInteract,
}: {
  data: SuggestionCardData
  /** Stops the box rotating: a card being answered must not slide away. */
  onInteract: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState("")

  function answer(run: () => Promise<{ error?: string }>) {
    onInteract()
    setError("")
    startTransition(async () => {
      const result = await run()
      if (result.error) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div
      className="rounded-lg border border-border border-l-[3px] border-l-moss bg-card px-3.5 py-3"
      onFocusCapture={onInteract}
    >
      <Label className="text-moss">/ suggested</Label>
      <div className="mt-1 text-[13px] text-foreground">{data.title}</div>
      <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
        {data.body}
      </div>
      <div className="mt-3 flex gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => answer(() => addSuggestion(data))}
          className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-50"
        >
          add to today
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => answer(() => dismissSuggestion(data.id))}
          className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-50"
        >
          not now
        </button>
      </div>
      {error ? <div className="mt-1.5 text-[11px] text-clay">{error}</div> : null}
    </div>
  )
}
