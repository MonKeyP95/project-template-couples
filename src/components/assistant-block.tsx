"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useAiMode } from "@/components/ai-mode"
import { SuggestionCard } from "@/components/together"
import { NudgeLine } from "@/components/nudge-line"
import { suggestForSurface, getSuggestDays } from "@/lib/ai/suggestion-actions"
import type { SurfaceKey, Suggestion, SuggestScope, SuggestDay } from "@/lib/ai/suggestion-types"
import type { Nudge } from "@/lib/nudges/types"
import { sendChatMessage } from "@/lib/ai/chat-actions"
import type { ChatMessage } from "@/lib/ai/chat-types"

/** The single AI access point. One inline collapsible block whose header IS the
 * AI on/off: collapsed = off (just the label), expanded = on (suggest + optional
 * door + inline chat). State persists per-person via useAiMode / the ai cookie. */
export function AssistantBlock({
  surface,
  tripSlug,
  door,
  nudge,
  className,
}: {
  surface: SurfaceKey
  tripSlug?: string
  door?: React.ReactNode
  nudge?: Nudge | null
  className?: string
}) {
  const { enabled, setEnabled } = useAiMode()
  return (
    <div
      className={cn(
        "rounded-[14px] border border-l-2 border-border border-l-moss bg-card",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setEnabled(!enabled)}
        aria-expanded={enabled}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss">
          assistant
        </span>
        <span aria-hidden className="font-mono text-[12px] text-muted-foreground">
          {enabled ? "▾" : "▸"}
        </span>
      </button>

      {enabled ? (
        <div className="flex flex-col">
          {nudge ? (
            <>
              <Divider />
              <div className="px-4 py-3">
                <NudgeLine nudge={nudge} />
              </div>
            </>
          ) : null}
          <Divider />
          <div className="px-4 py-3">
            <SuggestLine surface={surface} tripSlug={tripSlug} />
          </div>
          {door ? (
            <>
              <Divider />
              <div className="px-4 py-3">{door}</div>
            </>
          ) : null}
          <Divider />
          <div className="px-4 py-3">
            <AskLine tripSlug={tripSlug} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Divider() {
  return <div className="mx-4 h-px bg-rule" />
}

type Stage = "idle" | "menu" | "day" | "free"

/** On-demand suggestion with a scope picker. Press "/ suggest" to reveal scope
 * chips; page/trip run at once, "a day" opens a mode-aware day picker, "free
 * text" opens a one-line input. Result renders in SuggestionCard; "another"
 * re-runs the same scope. Suggest-only: no writes. */
function SuggestLine({
  surface,
  tripSlug,
}: {
  surface: SurfaceKey
  tripSlug?: string
}) {
  const [stage, setStage] = React.useState<Stage>("idle")
  const [suggestion, setSuggestion] = React.useState<Suggestion | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [lastScope, setLastScope] = React.useState<SuggestScope>({ kind: "page" })
  const [days, setDays] = React.useState<SuggestDay[]>([])
  const [daysLoading, setDaysLoading] = React.useState(false)
  const [freeText, setFreeText] = React.useState("")

  const run = React.useCallback(
    async (scope: SuggestScope) => {
      setBusy(true)
      setError(null)
      setLastScope(scope)
      const res = await suggestForSurface(surface, tripSlug, scope)
      if (res.suggestion) {
        setSuggestion(res.suggestion)
        setStage("idle")
      } else {
        setError(res.error ?? "Couldn't reach the assistant.")
      }
      setBusy(false)
    },
    [surface, tripSlug],
  )

  const openDayPicker = React.useCallback(async () => {
    if (!tripSlug) return
    setStage("day")
    setDaysLoading(true)
    const { days } = await getSuggestDays(tripSlug)
    setDays(days)
    setDaysLoading(false)
  }, [tripSlug])

  function reset() {
    setSuggestion(null)
    setError(null)
    setFreeText("")
    setStage("idle")
  }

  // Result card.
  if (suggestion) {
    return (
      <SuggestionCard
        label={suggestion.label}
        applyLabel={busy ? "thinking..." : "another"}
        dismissLabel="dismiss"
        onApply={() => run(lastScope)}
        onDismiss={reset}
      >
        {suggestion.body}
      </SuggestionCard>
    )
  }

  const chip =
    "font-mono text-[9.5px] uppercase tracking-[0.2em] text-moss disabled:opacity-60"

  // Collapsed entry.
  if (stage === "idle") {
    return (
      <div>
        <button type="button" onClick={() => setStage("menu")} className={chip}>
          / suggest
        </button>
        {error ? (
          <p className="mt-1.5 text-[12.5px] leading-snug text-clay">{error}</p>
        ) : null}
      </div>
    )
  }

  // Day picker.
  if (stage === "day") {
    return (
      <div className="flex flex-col gap-2">
        {daysLoading ? (
          <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground">
            loading days...
          </span>
        ) : days.length === 0 ? (
          <span className="text-[12.5px] text-muted-foreground">No days yet.</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {days.map((d) => (
              <button
                key={d.date}
                type="button"
                disabled={busy}
                onClick={() => run({ kind: "day", date: d.date })}
                className={`rounded-full border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.16em] disabled:opacity-60 ${
                  d.isToday
                    ? "border-moss text-moss"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {d.label}
                {d.isToday ? " · today" : ""}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setStage("menu")}
          className="self-start font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
        >
          back
        </button>
      </div>
    )
  }

  // Free-text input.
  if (stage === "free") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <input
            type="text"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && freeText.trim() && !busy)
                run({ kind: "free", text: freeText.trim() })
            }}
            placeholder="a sunny spot for a drink..."
            className="flex-1 border-0 border-b border-rule bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
          />
          <button
            type="button"
            disabled={busy || freeText.trim() === ""}
            onClick={() => run({ kind: "free", text: freeText.trim() })}
            className="rounded-md bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {busy ? "..." : "go"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setStage("menu")}
          className="self-start font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
        >
          back
        </button>
      </div>
    )
  }

  // Scope menu. Trip-overview and a-day only when a trip is in context.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <button type="button" disabled={busy} onClick={() => run({ kind: "page" })} className={chip}>
        {busy && lastScope.kind === "page" ? "thinking..." : "this page"}
      </button>
      {tripSlug ? (
        <>
          <button type="button" disabled={busy} onClick={() => run({ kind: "trip" })} className={chip}>
            {busy && lastScope.kind === "trip" ? "thinking..." : "trip overview"}
          </button>
          <button type="button" disabled={busy} onClick={openDayPicker} className={chip}>
            a day
          </button>
        </>
      ) : null}
      <button type="button" disabled={busy} onClick={() => setStage("free")} className={chip}>
        free text
      </button>
      {error ? (
        <p className="w-full text-[12.5px] leading-snug text-clay">{error}</p>
      ) : null}
    </div>
  )
}

/** Inline chat. Same server seam (sendChatMessage) the floating panel used. */
function AskLine({ tripSlug }: { tripSlug?: string }) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const endRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, pending])

  function send() {
    const text = input.trim()
    if (!text || pending) return
    const next: ChatMessage[] = [...messages, { role: "user", content: text }]
    setMessages(next)
    setInput("")
    setPending(true)
    sendChatMessage(next, tripSlug).then((reply) => {
      setMessages((m) => [...m, { role: "assistant", content: reply }])
      setPending(false)
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {messages.length > 0 ? (
        <div className="flex max-h-60 flex-col gap-2 overflow-y-auto">
          {messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <span
                className={`max-w-[85%] rounded-lg px-3 py-1.5 text-[13px] leading-snug ${
                  m.role === "user"
                    ? "bg-foreground text-background"
                    : "border border-border bg-background text-foreground"
                }`}
              >
                {m.content}
              </span>
            </div>
          ))}
          {pending ? (
            <div className="flex justify-start">
              <span className="rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                typing…
              </span>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="ask me anything…"
          className="max-h-24 min-h-[2rem] flex-1 resize-none border-0 border-b border-rule bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || input.trim() === ""}
          className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          send
        </button>
      </div>
    </div>
  )
}
