import { cn } from "@/lib/utils"

const INK = "#172434"
const WIDTH = 1200

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
 * Drawn island backdrop for the cartoon theme. The sky fills the screen, the
 * sun sits in the top-right corner and the lagoon and sand are a thin strip
 * pinned to the bottom, so the wave line stays clear of page content.
 */
export function CartoonSceneBg({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none bg-linear-to-b from-[#2bb3d6] to-[#7ed9e8]", className)}
    >
      <svg viewBox="0 0 100 100" className="absolute top-5 right-5 size-14 md:size-20">
        <circle cx="50" cy="50" r="45" fill="#ffd23f" stroke={INK} strokeWidth="6" />
      </svg>
      <svg
        viewBox={`0 0 ${WIDTH} 160`}
        preserveAspectRatio="xMidYMin slice"
        className="absolute inset-x-0 bottom-0 h-24 w-full md:h-32"
      >
        <path d={wavePath(30, 60, 22, 160)} fill="#1590b5" stroke={INK} strokeWidth="5" strokeLinejoin="round" />
        <path d={wavePath(95, 100, 14, 160)} fill="#ffe9b8" stroke={INK} strokeWidth="5" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
