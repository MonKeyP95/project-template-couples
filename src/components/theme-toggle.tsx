"use client"

import * as React from "react"

// Inlined rather than imported from lib/theme so this client bundle doesn't
// pull in next/headers (see memory: client/server split rule).
const THEME_COOKIE = "theme"
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/**
 * Flips light/dark by toggling `.dark` on <html> for instant feedback and
 * writing the `theme` cookie so the next server render matches. `initialDark`
 * comes from the same cookie the root layout reads, so hydration is stable.
 */
export function ThemeToggle({ initialDark }: { initialDark: boolean }) {
  const [dark, setDark] = React.useState(initialDark)

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle("dark", next)
    document.cookie = `${THEME_COOKIE}=${next ? "dark" : "light"}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
    >
      {dark ? "use light theme" : "use dark theme"}
    </button>
  )
}
