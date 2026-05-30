import { cookies } from "next/headers"

export const THEME_COOKIE = "theme"

/** Reads the persisted theme cookie. Absent or non-"dark" means light. */
export async function isDarkTheme(): Promise<boolean> {
  const store = await cookies()
  return store.get(THEME_COOKIE)?.value === "dark"
}
