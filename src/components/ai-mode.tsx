"use client"

import * as React from "react"

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

/** Per-person AI on/off switch. Off by default; writes the `ai` cookie. */
export function AiToggle() {
  const { enabled, setEnabled } = useAiMode()

  function toggle() {
    const next = !enabled
    setEnabled(next)
    document.cookie = `${AI_COOKIE}=${next ? "on" : "off"}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
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
