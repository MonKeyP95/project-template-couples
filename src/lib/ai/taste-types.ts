// Pure types + copy for the taste dial. No server-only import so the client
// toggle and the server read can both share them (the *-types.ts split rule).

export type TasteLevel = "surprise" | "balanced" | "feels-like-us"

export const TASTE_COOKIE = "taste"

/** Dial stops in display order, with their toggle labels. */
export const TASTE_LEVELS: { value: TasteLevel; label: string }[] = [
  { value: "surprise", label: "surprise us" },
  { value: "balanced", label: "balanced" },
  { value: "feels-like-us", label: "feels like us" },
]

/** Falls back to "balanced" for anything unrecognized. */
export function normalizeTaste(raw: string | undefined): TasteLevel {
  return raw === "surprise" || raw === "feels-like-us" ? raw : "balanced"
}

/** One prompt sentence per stop; sets how heavily the profile prior weighs. */
export const TASTE_DIRECTIVE: Record<TasteLevel, string> = {
  surprise:
    "Lean away from their usual patterns; suggest something outside their comfort zone to help them discover.",
  balanced:
    "Let their taste gently color the suggestion; generalize it, don't echo it, and feel free to stretch.",
  "feels-like-us":
    "Lean into what they clearly love; suggest something that will feel unmistakably theirs.",
}
