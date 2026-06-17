// Suggest-only invariant: code under lib/ai returns data only. It must never
// import server actions or mutate state. Every write happens from an explicit
// user gesture (apply/confirm clicks, the manual budget field). This keeps the
// assistant suggest-only when a real model lands behind this seam.

import { cookies } from "next/headers"

export const AI_COOKIE = "ai"

/** AI mode is off unless the cookie is explicitly "on". */
export async function isAiEnabled(): Promise<boolean> {
  return (await cookies()).get(AI_COOKIE)?.value === "on"
}
