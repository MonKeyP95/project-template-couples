"use client"

import * as React from "react"

import { useAiMode } from "@/components/ai-mode"
import { SuggestionCard } from "@/components/together"
import { refreshHomeIdea } from "@/lib/ai/home-idea-actions"
import { suggestForSurface } from "@/lib/ai/suggestion-actions"
import type { Suggestion } from "@/lib/ai/suggestion-types"

const ACTIVITY_TINTS = ["bg-sand-tint", "bg-dusk-tint"]

const pill =
  "max-w-[9rem] shrink-0 truncate rounded-full border border-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground transition-colors hover:border-rule disabled:opacity-50"

/** One-line assistant for new trip ideas. `saved` is the couple's saved idea,
 * shown at once; on load it is checked against the profile and trip learnings
 * and only remade when they changed. "For us" shows it again, "another" makes
 * a new one. `activities` (top loved activities) and typed asks are one-off
 * ideas; those switch AI mode on, since asking is the consent. */
export function IdeasLine({
  saved,
  activities,
  className = "",
}: {
  saved: Suggestion | null
  activities: string[]
  className?: string
}) {
  const { enabled, setEnabled } = useAiMode()
  const [text, setText] = React.useState("")
  // null = the saved "for us" idea; a string = a one-off ask.
  const [lastAsk, setLastAsk] = React.useState<string | null>(null)
  const [idea, setIdea] = React.useState<Suggestion | null>(saved)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    refreshHomeIdea(false).then((res) => {
      if (res.idea) setIdea(res.idea)
    })
  }, [])

  async function showSaved(another: boolean) {
    setBusy(true)
    setError(null)
    setLastAsk(null)
    const res = await refreshHomeIdea(another)
    setIdea(res.idea ?? null)
    setError(res.error ?? null)
    setBusy(false)
  }

  async function ask(what: string) {
    if (!enabled) setEnabled(true)
    setBusy(true)
    setError(null)
    setLastAsk(what)
    const res = await suggestForSurface("home", undefined, { kind: "free", text: what })
    setIdea(res.suggestion ?? null)
    setError(res.error ?? null)
    setBusy(false)
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 rounded-[10px] border border-transparent bg-sea-tint py-2 pr-2.5 pl-4">
        <span className="mr-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-foreground">
          AI assistant
        </span>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim() && !busy) ask(text.trim())
          }}
          placeholder={busy ? "thinking..." : "Ask for an idea"}
          aria-label="Ask for a new trip idea"
          className="w-0 min-w-0 flex-1 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-foreground sm:max-w-[200px]"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => showSaved(false)}
          className={`${pill} bg-moss-tint`}
        >
          For us
        </button>
        {activities.map((a, i) => (
          <button
            key={a}
            type="button"
            disabled={busy}
            onClick={() => ask(`a trip for ${a}`)}
            className={`${pill} ${ACTIVITY_TINTS[i % ACTIVITY_TINTS.length]}`}
          >
            {a}
          </button>
        ))}
      </div>
      {error ? <p className="mt-2 text-[12.5px] text-clay">{error}</p> : null}
      {idea ? (
        <SuggestionCard
          label={idea.label}
          applyLabel={busy ? "thinking..." : "another"}
          dismissLabel="dismiss"
          onApply={() => (lastAsk === null ? showSaved(true) : ask(lastAsk))}
          onDismiss={() => setIdea(null)}
          className="mt-2"
        >
          {idea.body}
        </SuggestionCard>
      ) : null}
    </div>
  )
}
