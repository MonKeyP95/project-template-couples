export type Theme = "light" | "dark" | "voyage"

export const THEME_COOKIE = "theme"

/** Maps a raw cookie value to a theme. Anything unknown means light. */
export function parseTheme(value: string | undefined): Theme {
  return value === "dark" || value === "voyage" ? value : "light"
}
