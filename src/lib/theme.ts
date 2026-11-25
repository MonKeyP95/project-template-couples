import { cookies } from "next/headers"

import { THEME_COOKIE, parseTheme, type Theme } from "@/lib/theme-types"

/** Reads the persisted theme cookie. */
export async function getTheme(): Promise<Theme> {
  const store = await cookies()
  return parseTheme(store.get(THEME_COOKIE)?.value)
}
