"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useAiMode } from "@/components/ai-mode"
import { SuggestionCard } from "@/components/together"
import { dismissHomeIdea, refreshHomeIdeas } from "@/lib/ai/home-idea-actions"
import { suggestForSurface } from "@/lib/ai/suggestion-actions"
import type { EarlierIdea, TripIdea } from "@/lib/ai/suggestion-types"

import { EarlierIdeas } from "./earlier-ideas"

const OPTION_TINTS = ["bg-moss-tint", "bg-sand-tint", "bg-dusk-tint"]

const pill =
  "rounded-full border border-transparent px-3 py-1.5 text-left text-[12.5px] leading-tight text-foreground transition-colors hover:border-rule disabled:opacity-50"

/** One-line assistant for new trip ideas. `pills` are the saved ideas on the
 * pills and `earlier` the rest, both from the server. Tapping a pill opens its
 * idea with no call and "another" opens the next one; "dismiss" moves it to
 * the earlier list, and when no pill is left a new set is made. On load the
 * set is checked against the profile and only remade when it changed, or on
 * "new ideas". A typed ask gives a one-off idea; it switches AI mode on, since
 * asking is the consent. "let's do it" opens the new-trip walk with the
 * idea's plan and id; no call is made. */
export function IdeasLine({
  pills,
  earlier,
  className = "",
}: {
  pills: TripIdea[]
  earlier: EarlierIdea[]
  className?: string
}) {
  const { enabled, setEnabled } = useAiMode()
  const router = useRouter()
  const [text, setText] = React.useState("")
  // The open pill by id, so a remade set closes the card on its own.
  const [open, setOpen] = React.useState<string | null>(null)
  const [oneOff, setOneOff] = React.useState<{ ask: string; idea: TripIdea } | null>(null)
  const [hidden, setHidden] = React.useState<Set<string>>(new Set())
  const [listOpen, setListOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const shownPills = pills.filter((p) => !hidden.has(p.id))

  async function refresh(fresh: boolean) {
    setBusy(true)
    setError((await refreshHomeIdeas(fresh)).error ?? null)
    setBusy(false)
  }

  React.useEffect(() => {
    refreshHomeIdeas(false).then((res) => setError(res.error ?? null))
  }, [])

  function newIdeas() {
    setOneOff(null)
    setOpen(null)
    refresh(true)
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

  function openPill(id: string) {
    setOneOff(null)
    setOpen(id)
  }

  function another() {
    if (oneOff) {
      ask(oneOff.ask)
      return
    }
    const i = shownPills.findIndex((p) => p.id === open)
    setOpen(shownPills[(i + 1) % shownPills.length].id)
  }

  async function dismiss() {
    if (oneOff || open === null) {
      setOneOff(null)
      return
    }
    const id = open
    setHidden((h) => new Set(h).add(id))
    setOpen(null)
    await dismissHomeIdea(id)
    if (shownPills.length === 1) refresh(false)
  }

  function accept(accepted: TripIdea) {
    const params = new URLSearchParams({
      note: accepted.body,
      idea: JSON.stringify(accepted.plan),
    })
    if (accepted.id) params.set("ideaId", accepted.id)
    router.push(`/trips/new?${params}`)
  }

  const shown = oneOff?.idea ?? shownPills.find((p) => p.id === open)

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
        {shownPills.length || earlier.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {shownPills.map((p, i) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => openPill(p.id)}
                aria-pressed={!oneOff && open === p.id}
                className={`${pill} ${OPTION_TINTS[i % OPTION_TINTS.length]} ${!oneOff && open === p.id ? "border-foreground" : ""}`}
              >
                {p.pill}
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
            {earlier.length ? (
              <button
                type="button"
                onClick={() => setListOpen(!listOpen)}
                aria-expanded={listOpen}
                className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
              >
                Earlier ideas · {earlier.length} {listOpen ? "‹" : "›"}
              </button>
            ) : null}
          </div>
        ) : null}
        {listOpen && earlier.length ? (
          <EarlierIdeas ideas={earlier} onAccept={accept} />
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
          onDismiss={dismiss}
          className="mt-2"
        >
          {shown.body}
        </SuggestionCard>
      ) : null}
    </div>
  )
}
