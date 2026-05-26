const AVATAR_COLORS = [
  "oklch(0.84 0.08 11)",   // pink (matches --primary)
  "oklch(0.83 0.09 80)",   // peach
  "oklch(0.85 0.07 200)",  // teal
  "oklch(0.83 0.08 280)",  // soft indigo
  "oklch(0.84 0.07 130)",  // sage
]

export function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase()
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
}

export function colorFromName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length
  return AVATAR_COLORS[index]!
}
