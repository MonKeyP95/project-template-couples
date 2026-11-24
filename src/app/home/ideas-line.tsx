"use client"

import * as React from "react"

import { useAiMode } from "@/components/ai-mode"
import { SuggestionCard } from "@/components/together"
import { suggestForSurface } from "@/lib/ai/suggestion-actions"
import type { Suggestion } from "@/lib/ai/suggestion-types"

const QUICK = [
  { label: "Weekend", ask: "a weekend away", tint: "bg-moss-tint" },
  { label: "Warm", ask: "somewhere warm", tint: "bg-sand-tint" },
]

const pill =
  "shrink-0 rounded-full border border-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground transition-colors hover:border-rule disabled:opacity-50"

/** One-line assistant for new trip ideas. Using it switches AI mode on, since
 * asking is the consent; the idea shows in a card under the line. */
export function IdeasLine({ className = "" }: { className?: string }) {
  const { enabled, setEnabled } = useAiMode()
  const [text, setText] = React.useState("")
  const [lastAsk, setLastAsk] = React.useState("")
  const [idea, setIdea] = React.useState<Suggestion | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

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
        {QUICK.map((q) => (
          <button
            key={q.label}
            type="button"
            disabled={busy}
            onClick={() => ask(q.ask)}
            className={`${pill} ${q.tint}`}
          >
            {q.label}
          </button>
        ))}
      </div>
      {error ? <p className="mt-2 text-[12.5px] text-clay">{error}</p> : null}
      {idea ? (
        <SuggestionCard
          label={idea.label}
          applyLabel={busy ? "thinking..." : "another"}
          dismissLabel="dismiss"
          onApply={() => ask(lastAsk)}
          onDismiss={() => setIdea(null)}
          className="mt-2"
        >
          {idea.body}
        </SuggestionCard>
      ) : null}
    </div>
  )
}
