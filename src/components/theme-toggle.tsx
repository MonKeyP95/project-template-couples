"use client"

import * as React from "react"

import { THEME_COOKIE, type Theme } from "@/lib/theme-types"

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "cartoon", label: "Cartoon" },
]

/** Swaps the theme class on <html> and persists the choice in the cookie. */
function applyTheme(next: Theme) {
  const root = document.documentElement.classList
  root.remove("dark", "cartoon")
  if (next !== "light") root.add(next)
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
}

/**
 * Light / Dark / Cartoon picker. Applies the theme instantly; the cookie makes
 * the next server render match, so hydration is stable.
 */
export function ThemeToggle({ initialTheme }: { initialTheme: Theme }) {
  const [theme, setTheme] = React.useState(initialTheme)

  function pick(next: Theme) {
    setTheme(next)
    applyTheme(next)
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex shrink-0 rounded-full border border-border p-0.5"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          onClick={() => pick(o.value)}
          className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${
            theme === o.value
              ? "bg-sea text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
