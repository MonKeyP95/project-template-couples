import { cookies } from "next/headers"

import { normalizeTaste, TASTE_COOKIE, type TasteLevel } from "./taste-types"

/** The person's taste-dial setting; defaults to "balanced" when unset. */
export async function getTasteLevel(): Promise<TasteLevel> {
  return normalizeTaste((await cookies()).get(TASTE_COOKIE)?.value)
}
