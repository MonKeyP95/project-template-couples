"use client"

import * as React from "react"

import { useAiMode } from "@/components/ai-mode"
import { SuggestionCard } from "@/components/together"
import { refreshHomeIdea } from "@/lib/ai/home-idea-actions"
import { suggestForSurface } from "@/lib/ai/suggestion-actions"
import type { Suggestion, TripIdea } from "@/lib/ai/suggestion-types"

const OPTION_TINTS = ["bg-moss-tint", "bg-sand-tint", "bg-dusk-tint"]

const pill =
  "rounded-full border border-transparent px-3 py-1.5 text-left text-[12.5px] leading-tight text-foreground transition-colors hover:border-rule disabled:opacity-50"

/** One-line assistant for new trip ideas. `saved` is the couple's saved idea
 * and its three "ask next" options, shown at once; on load it is checked
 * against the profile and trip learnings and only remade when they changed,
 * or on "another" for the saved idea. An option or a typed ask gives a
 * one-off idea; those switch AI mode on, since asking is the consent. */
export function IdeasLine({
  saved,
  className = "",
}: {
  saved: TripIdea | null
  className?: string
}) {
  const { enabled, setEnabled } = useAiMode()
  const [text, setText] = React.useState("")
  // null = the saved idea; a string = a one-off ask.
  const [lastAsk, setLastAsk] = React.useState<string | null>(null)
  const [idea, setIdea] = React.useState<Suggestion | null>(saved)
  const [options, setOptions] = React.useState<string[]>(saved?.options ?? [])
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  function showRefreshed(res: { idea?: TripIdea; error?: string }) {
    if (res.idea) {
      setIdea(res.idea)
      setOptions(res.idea.options)
    }
    setError(res.error ?? null)
  }

  React.useEffect(() => {
    refreshHomeIdea(false).then(showRefreshed)
  }, [])

  async function another() {
    setBusy(true)
    setLastAsk(null)
    showRefreshed(await refreshHomeIdea(true))
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
      <div className="flex flex-col gap-2 rounded-[10px] bg-sea-tint py-2 pr-2.5 pl-4">
        <div className="flex items-center gap-1.5">
          <span className="mr-1.5 shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-foreground">
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
            className="w-0 min-w-0 flex-1 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-foreground"
          />
        </div>
        {options.length ? (
          <div className="flex flex-wrap gap-1.5">
            {options.map((o, i) => (
              <button
                key={o}
                type="button"
                disabled={busy}
                onClick={() => ask(o)}
                className={`${pill} ${OPTION_TINTS[i % OPTION_TINTS.length]}`}
              >
                {o}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-[12.5px] text-clay">{error}</p> : null}
      {idea ? (
        <SuggestionCard
          label={idea.label}
          applyLabel={busy ? "thinking..." : "another"}
          dismissLabel="dismiss"
          onApply={() => (lastAsk === null ? another() : ask(lastAsk))}
          onDismiss={() => setIdea(null)}
          className="mt-2"
        >
          {idea.body}
        </SuggestionCard>
      ) : null}
    </div>
  )
}
