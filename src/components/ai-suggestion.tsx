"use client"

import * as React from "react"

import { SuggestionCard } from "@/components/together"
import { suggestionFor, type SurfaceKey } from "@/lib/ai/suggestions"

export function AiSuggestion({
  surface,
  className,
}: {
  surface: SurfaceKey
  className?: string
}) {
  const suggestion = React.useMemo(() => suggestionFor(surface), [surface])
  const [dismissed, setDismissed] = React.useState(false)

  if (!suggestion || dismissed) return null

  return (
    <SuggestionCard
      label={suggestion.label}
      dismissLabel="dismiss"
      onDismiss={() => setDismissed(true)}
      className={className}
    >
      {suggestion.body}
    </SuggestionCard>
  )
}
