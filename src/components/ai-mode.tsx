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
  const [enabled, setEnabledState] = React.useState(initialEnabled)
  const setEnabled = React.useCallback((v: boolean) => {
    setEnabledState(v)
    document.cookie = `${AI_COOKIE}=${v ? "on" : "off"}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
  }, [])
  return (
    <AiModeContext.Provider value={{ enabled, setEnabled }}>
      {children}
    </AiModeContext.Provider>
  )
}

export function useAiMode(): AiModeValue {
  return React.useContext(AiModeContext)
}