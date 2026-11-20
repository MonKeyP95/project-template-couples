export type PillTone = "sea" | "dusk" | "clay" | "sand"

const PILL_TONE: Record<PillTone, { on: string; off: string }> = {
  sea: { on: "border-sea bg-sea", off: "border-sea/40 bg-sea-tint hover:border-sea" },
  dusk: { on: "border-dusk bg-dusk", off: "border-dusk/40 bg-dusk-tint hover:border-dusk" },
  clay: { on: "border-clay bg-clay", off: "border-clay/40 bg-clay-tint hover:border-clay" },
  sand: { on: "border-sand bg-sand", off: "border-sand/60 bg-sand-tint hover:border-sand" },
}

/** A button in a tab's top toolbar row, tinted with the tab's side-card colour;
 * `active` marks its panel open (solid). */
export function toolbarPill(active: boolean, tone: PillTone = "sea"): string {
  return `rounded-[10px] border px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
    active ? `${PILL_TONE[tone].on} text-background` : `${PILL_TONE[tone].off} text-foreground`
  }`
}
