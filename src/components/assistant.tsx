"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { requestChatReply, type ChatMessage } from "@/lib/ai/chat"
import { AiToggle } from "@/components/ai-mode"

// Landing + auth have no assistant.
const HIDDEN_PATHS = new Set(["/", "/signin", "/signup"])

/**
 * The single floating assistant: a mock chat plus the AI on/off toggle in its header.
 * Replaces the separate bottom-left "AI on/off" pill and bottom-right "ask" button.
 * Chat always works; the toggle only gates the proactive surfaces (suggestion cards,
 * budget drafter), which read `useAiMode()` elsewhere.
 */
export function Assistant() {
  const pathname = usePathname()
  const [open, setOpen] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const endRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, pending, open])

  if (HIDDEN_PATHS.has(pathname)) return null

  function send() {
    const text = input.trim()
    if (!text || pending) return
    const next: ChatMessage[] = [...messages, { role: "user", content: text }]
    setMessages(next)
    setInput("")
    setPending(true)
    requestChatReply(next).then((reply) => {
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open assistant"
        className="fixed bottom-5 right-5 z-40 rounded-full border border-border bg-foreground px-4 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-background shadow-lg"
      >
        assistant
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex h-[28rem] w-[20rem] max-w-[calc(100vw-2.5rem)] flex-col rounded-xl border border-border bg-card shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">
          / assistant
        </span>
        <div className="flex items-center gap-3">
          <AiToggle />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
            className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3">
        {messages.length === 0 ? (
          <p className="font-mono text-[10px] leading-relaxed tracking-[0.04em] text-muted-foreground">
            Ask me anything — packing, budget, ideas. (I&apos;m a placeholder
            until I&apos;m connected to a real assistant.)
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user" ? "flex justify-end" : "flex justify-start"
              }
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
          ))
        )}
        {pending ? (
          <div className="flex justify-start">
            <span className="rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
              typing…
            </span>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-border px-3 py-2.5">
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a question…"
          className="max-h-24 min-h-[2rem] flex-1 resize-none border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
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
