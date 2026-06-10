"use client"

import * as React from "react"

// Inlined rather than imported from lib/theme so this client bundle doesn't
// pull in next/headers (see memory: client/server split rule).
const THEME_COOKIE = "theme"
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/**
 * Light/dark switch. Toggles `.dark` on <html> for instant feedback and writes
 * the `theme` cookie so the next server render matches. `initialDark` comes from
 * the same cookie the root layout reads, so hydration is stable.
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
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      onClick={toggle}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        dark ? "bg-sea" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
          dark ? "translate-x-[19px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  )
}
