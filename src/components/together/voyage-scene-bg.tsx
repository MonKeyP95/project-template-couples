import { cn } from "@/lib/utils"

import { VoyageCanoe } from "./voyage-canoe"

const INK = "#172434"
const WIDTH = 2400
const TOP = -70
const HEIGHT = 230

/**
 * A row of wave bumps along `y`, `step` units apart (must divide WIDTH),
 * filled down to `bottom`. The fill closes outside the viewBox so its outline
 * never shows along the screen edges.
 */
function wavePath(y: number, step: number, rise: number, bottom: number) {
  const bumps = [`M0 ${y}`, `Q${step / 2} ${y - rise} ${step} ${y}`]
  for (let x = step * 2; x <= WIDTH; x += step) bumps.push(`T${x} ${y}`)
  const out = 10
  return `${bumps.join(" ")} L${WIDTH + out} ${y} L${WIDTH + out} ${bottom + out} L${-out} ${bottom + out} L${-out} ${y} Z`
}

/**
 * Drawn island backdrop for the voyage theme. The sky fills the screen, the
 * sun sits in the top-right corner and the lagoon and sand are a thin strip
 * pinned to the bottom, with a canoe sailing on it, so the wave line stays
 * clear of page content.
 *
 * The strip is as tall as the drawing's aspect needs at full width (with a
 * floor for phones), so the whole height always shows: clear sky for the sail
 * on top, sand at the bottom. Phones see the centre, where the canoe sails.
 */
export function VoyageSceneBg({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none bg-linear-to-b from-[#2bb3d6] to-[#7ed9e8]", className)}
    >
      <svg viewBox="0 0 100 100" className="absolute top-5 right-5 size-14 md:size-20">
        <circle cx="50" cy="50" r="45" fill="#ffd23f" stroke={INK} strokeWidth="6" />
      </svg>
      <svg
        viewBox={`0 ${TOP} ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMin slice"
        className="absolute inset-x-0 bottom-0 h-[max(9rem,9.6vw)] w-full"
      >
        {/* Before the water, so the waves lap over the hull. */}
        <VoyageCanoe transform="translate(1380 22) scale(1.3)" />
        <path d={wavePath(30, 60, 22, HEIGHT + TOP)} fill="#1590b5" stroke={INK} strokeWidth="5" strokeLinejoin="round" />
        <path d={wavePath(95, 100, 14, HEIGHT + TOP)} fill="#ffe9b8" stroke={INK} strokeWidth="5" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
