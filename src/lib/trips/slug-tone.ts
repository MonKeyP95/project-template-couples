/**
 * Map a slug to one of the four design tones deterministically.
 * Same slug always returns the same tone — no schema column needed.
 *
 *   "lombok" stays "sea" to match the existing visual.
 *   Any other slug hashes into sea | clay | moss | sand.
 */
export type CardTone = "sea" | "clay" | "moss" | "sand"

const TONES: CardTone[] = ["sea", "clay", "moss", "sand"]

export function slugToTone(slug: string): CardTone {
  if (slug === "lombok") return "sea"
  let hash = 0
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0
  }
  const idx = ((hash % TONES.length) + TONES.length) % TONES.length
  return TONES[idx]
}
