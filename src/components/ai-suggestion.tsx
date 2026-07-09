"use client"

import * as React from "react"

import { SuggestionCard } from "@/components/together"
import { useAiMode } from "@/components/ai-mode"
import { suggestForSurface } from "@/lib/ai/suggestion-actions"
import type { SurfaceKey, Suggestion } from "@/lib/ai/suggestion-types"

/** On-demand AI suggestion for a surface. Collapsed to a "/ suggest" affordance
 * until clicked; then one Claude call fills the card, with "another" (regenerate)
 * and "dismiss" (collapse). AI-mode-gated; renders nothing when AI is off. */
export function AiSuggestion({
  surface,
  tripSlug,
  className,
}: {
  surface: SurfaceKey
  tripSlug?: string
  className?: string
}) {
  const { enabled } = useAiMode()
  const [suggestion, setSuggestion] = React.useState<Suggestion | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const run = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    const res = await suggestForSurface(surface, tripSlug)
    if (res.suggestion) setSuggestion(res.suggestion)
    else setError(res.error ?? "Couldn't reach the assistant.")
    setBusy(false)
  }, [surface, tripSlug])

  if (!enabled) return null

  if (!suggestion) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-lg border border-border border-l-[3px] border-l-moss bg-card px-3.5 py-3 text-left font-mono text-[9.5px] uppercase tracking-[0.2em] text-moss disabled:opacity-60"
        >
          {busy ? "thinking..." : "/ suggest"}
        </button>
        {error ? (
          <p className="mt-1.5 text-[12.5px] leading-snug text-clay">{error}</p>
        ) : null}
      </div>
    )
  }

  return (
    <SuggestionCard
      label={suggestion.label}
      applyLabel={busy ? "thinking..." : "another"}
      dismissLabel="dismiss"
      onApply={run}
      onDismiss={() => {
        setSuggestion(null)
        setError(null)
      }}
      className={className}
    >
      {suggestion.body}
    </SuggestionCard>
  )
}
