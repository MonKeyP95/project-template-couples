export type Theme = "light" | "dark" | "cartoon"

export const THEME_COOKIE = "theme"

/** Maps a raw cookie value to a theme. Anything unknown means light. */
export function parseTheme(value: string | undefined): Theme {
  return value === "dark" || value === "cartoon" ? value : "light"
}
