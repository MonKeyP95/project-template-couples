"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

// Inlined so this client bundle doesn't import the next/headers server module
// (see memory: client/server split rule). Must match AI_COOKIE in lib/ai/ai-mode.ts.
const AI_COOKIE = "ai"
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

interface AiModeValue {
  enabled: boolean
  setEnabled: (v: boolean) => void
}

const AiModeContext = React.createContext<AiModeValue>({
  enabled: false,
  setEnabled: () => {},
})

export function AiModeProvider({
  initialEnabled,
  children,
}: {
  initialEnabled: boolean
  children: React.ReactNode
}) {
  const [enabled, setEnabled] = React.useState(initialEnabled)
  return (
    <AiModeContext.Provider value={{ enabled, setEnabled }}>
      {children}
    </AiModeContext.Provider>
  )
}

export function useAiMode(): AiModeValue {
  return React.useContext(AiModeContext)
}

function persistAi(next: boolean) {
  document.cookie = `${AI_COOKIE}=${next ? "on" : "off"}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
}

/** Per-person AI on/off switch. Off by default; writes the `ai` cookie. */
export function AiToggle() {
  const { enabled, setEnabled } = useAiMode()

  function toggle() {
    const next = !enabled
    setEnabled(next)
    persistAi(next)
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="AI assistant"
      onClick={toggle}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        enabled ? "bg-sea" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
          enabled ? "translate-x-[19px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  )
}

// The landing page and the auth flow have no AI surface, so the pill is hidden.
const AI_HIDDEN_PATHS = new Set(["/", "/signin", "/signup"])

/** AI on/off pill, fixed bottom-left on app pages (not landing or auth). */
export function AiFloatingToggle() {
  const { enabled, setEnabled } = useAiMode()
  const pathname = usePathname()

  if (AI_HIDDEN_PATHS.has(pathname)) return null

  function toggle() {
    const next = !enabled
    setEnabled(next)
    persistAi(next)
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="AI assistant"
      onClick={toggle}
      className={`fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] shadow-sm backdrop-blur transition-colors ${
        enabled
          ? "border-sea bg-sea/10 text-sea"
          : "border-border bg-card/80 text-muted-foreground"
      }`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          enabled ? "bg-sea" : "bg-muted-foreground/50"
        }`}
      />
      AI {enabled ? "on" : "off"}
    </button>
  )
}
