import { cn } from "@/lib/utils"

const INK = "#172434"
const WIDTH = 1200

/**
 * A row of wave bumps along `y`, `step` units apart (must divide WIDTH),
 * closed down to `bottom`.
 */
function wavePath(y: number, step: number, rise: number, bottom: number) {
  const bumps = [`M0 ${y}`, `Q${step / 2} ${y - rise} ${step} ${y}`]
  for (let x = step * 2; x <= WIDTH; x += step) bumps.push(`T${x} ${y}`)
  return `${bumps.join(" ")} L${WIDTH} ${bottom} L0 ${bottom} Z`
}

/**
 * Drawn island backdrop for the cartoon theme: sky, sun, a wave line, lagoon
 * and sand. Sliced from the top so the sky always fills the upper screen; the
 * sun sits near the middle so phones (which see the centre) keep it.
 */
export function CartoonSceneBg({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${WIDTH} 900`}
      preserveAspectRatio="xMidYMin slice"
      aria-hidden
      className={cn("pointer-events-none h-full w-full", className)}
    >
      <defs>
        <linearGradient id="cartoon-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2bb3d6" />
          <stop offset="1" stopColor="#7ed9e8" />
        </linearGradient>
      </defs>
      <rect width={WIDTH} height="900" fill="url(#cartoon-sky)" />
      <circle cx="740" cy="110" r="48" fill="#ffd23f" stroke={INK} strokeWidth="5" />
      <path d={wavePath(360, 60, 22, 900)} fill="#1590b5" stroke={INK} strokeWidth="5" strokeLinejoin="round" />
      <path d={wavePath(440, 100, 14, 900)} fill="#ffe9b8" stroke={INK} strokeWidth="5" strokeLinejoin="round" />
    </svg>
  )
}
