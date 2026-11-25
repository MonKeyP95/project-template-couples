"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useAiMode } from "@/components/ai-mode"
import { SuggestionCard } from "@/components/together"
import { refreshHomeIdeas } from "@/lib/ai/home-idea-actions"
import { suggestForSurface } from "@/lib/ai/suggestion-actions"
import type { TripIdea } from "@/lib/ai/suggestion-types"

const OPTION_TINTS = ["bg-moss-tint", "bg-sand-tint", "bg-dusk-tint"]

const pill =
  "rounded-full border border-transparent px-3 py-1.5 text-left text-[12.5px] leading-tight text-foreground transition-colors hover:border-rule disabled:opacity-50"

/** One-line assistant for new trip ideas. `saved` is the couple's saved set of
 * full ideas, one per pill; tapping a pill opens its idea with no call and
 * "another" opens the next one. On load the set is checked against the
 * profile and trip learnings and only remade when they changed, or on
 * "new ideas". A typed ask gives a one-off idea; it switches AI mode on, since
 * asking is the consent. "let's do it" opens the new-trip walk with the
 * idea's plan; no call is made. */
export function IdeasLine({
  saved,
  className = "",
}: {
  saved: TripIdea[]
  className?: string
}) {
  const { enabled, setEnabled } = useAiMode()
  const router = useRouter()
  const [text, setText] = React.useState("")
  const [ideas, setIdeas] = React.useState<TripIdea[]>(saved)
  // The open idea by label, so a remade set closes the card on its own.
  const [open, setOpen] = React.useState<string | null>(null)
  const [oneOff, setOneOff] = React.useState<{ ask: string; idea: TripIdea } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  function showRefreshed(res: { ideas?: TripIdea[]; error?: string }) {
    if (res.ideas) setIdeas(res.ideas)
    setError(res.error ?? null)
  }

  React.useEffect(() => {
    refreshHomeIdeas(false).then(showRefreshed)
  }, [])

  async function newIdeas() {
    setBusy(true)
    setOneOff(null)
    setOpen(null)
    showRefreshed(await refreshHomeIdeas(true))
    setBusy(false)
  }

  async function ask(what: string) {
    if (!enabled) setEnabled(true)
    setBusy(true)
    setError(null)
    const res = await suggestForSurface("home", undefined, { kind: "free", text: what })
    const s = res.suggestion
    setOneOff(s && "plan" in s ? { ask: what, idea: s } : null)
    setError(res.error ?? null)
    setBusy(false)
  }

  function openIdea(label: string) {
    setOneOff(null)
    setOpen(label)
  }

  function another() {
    if (oneOff) ask(oneOff.ask)
    else {
      const i = ideas.findIndex((idea) => idea.label === open)
      setOpen(ideas[(i + 1) % ideas.length].label)
    }
  }

  function accept(accepted: TripIdea) {
    const params = new URLSearchParams({
      note: accepted.body,
      idea: JSON.stringify(accepted.plan),
    })
    router.push(`/trips/new?${params}`)
  }

  const shown = oneOff?.idea ?? ideas.find((idea) => idea.label === open)

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
        {ideas.length ? (
          <div className="flex flex-wrap gap-1.5">
            {ideas.map((idea, i) => (
              <button
                key={i}
                type="button"
                disabled={busy}
                onClick={() => openIdea(idea.label)}
                aria-pressed={!oneOff && open === idea.label}
                className={`${pill} ${OPTION_TINTS[i % OPTION_TINTS.length]} ${!oneOff && open === idea.label ? "border-foreground" : ""}`}
              >
                {idea.pill}
              </button>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={newIdeas}
              className={`${pill} text-muted-foreground`}
            >
              {busy ? "thinking..." : "↻ new ideas"}
            </button>
          </div>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-[12.5px] text-clay">{error}</p> : null}
      {shown ? (
        <SuggestionCard
          label={shown.label}
          acceptLabel="let's do it"
          onAccept={() => accept(shown)}
          applyLabel={busy ? "thinking..." : "another"}
          dismissLabel="dismiss"
          onApply={another}
          onDismiss={() => {
            setOneOff(null)
            setOpen(null)
          }}
          className="mt-2"
        >
          {shown.body}
        </SuggestionCard>
      ) : null}
    </div>
  )
}
