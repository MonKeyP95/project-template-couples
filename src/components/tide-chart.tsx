import type { TideTurn } from "@/lib/conditions/get-conditions"

const AXIS_HOURS = [0, 6, 12, 18]

/** SVG path through the points, breaking the line where an hour is missing. */
function curvePath(points: ({ x: number; y: number } | null)[]): string {
  let d = ""
  let pen = false
  for (const p of points) {
    if (!p) {
      pen = false
      continue
    }
    d += `${pen ? "L" : "M"}${p.x},${p.y} `
    pen = true
  }
  return d.trim()
}

/** Keeps a label whose turn sits near the day's edge inside the card. */
function anchorShift(x: number): string {
  if (x < 12) return "0%"
  if (x > 88) return "-100%"
  return "-50%"
}

/** Signed metres from mean sea level, e.g. "+0.9 m". */
const metres = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} m`

/**
 * One day of tide as a curve: hour across, sea level up, each high and low
 * marked with its time. The y axis shows the day's highest and lowest level,
 * in metres from mean sea level.
 */
export function TideChart({
  levels,
  turns,
}: {
  levels: (number | null)[]
  turns: TideTurn[]
}) {
  const known = levels.filter((v): v is number => v != null)
  if (known.length < 2) {
    return <div className="t-num text-[12px] text-foreground">-</div>
  }
  const max = Math.max(...known)
  const min = Math.min(...known)
  const span = max - min || 1
  const last = levels.length - 1
  const x = (hour: number) => (hour / last) * 100
  const y = (v: number) => ((max - v) / span) * 100
  const points = levels.map((v, h) => (v == null ? null : { x: x(h), y: y(v) }))

  return (
    <div className="pt-5 pb-1">
      <div className="flex gap-2">
        <div className="relative h-14 w-10 shrink-0 text-right font-mono text-[9px] text-muted-foreground">
          <span className="absolute top-0 right-0 -translate-y-1/2">{metres(max)}</span>
          <span className="absolute right-0 bottom-0 translate-y-1/2">{metres(min)}</span>
        </div>
        <div className="relative h-14 flex-1">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
            className="absolute inset-0 h-full w-full overflow-visible text-foreground"
          >
            <path
              d={curvePath(points)}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {turns.map((t) => {
            const p = points[t.hour]!
            const high = t.kind === "high"
            return (
              <div key={t.hour} className="absolute" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                <span className="absolute size-2 -translate-1/2 rounded-full bg-foreground ring-2 ring-card" />
                <span
                  className="absolute whitespace-nowrap font-mono text-[10px] text-foreground"
                  style={{
                    transform: `translate(${anchorShift(p.x)}, ${high ? "calc(-100% - 6px)" : "6px"})`,
                  }}
                >
                  {high ? "High" : "Low"} {t.time}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="relative mt-5 ml-12 h-3 font-mono text-[9px] text-muted-foreground">
        {AXIS_HOURS.map((h) => (
          <span
            key={h}
            className="absolute"
            style={{ left: `${x(h)}%`, transform: `translateX(${anchorShift(x(h))})` }}
          >
            {String(h).padStart(2, "0")}
          </span>
        ))}
      </div>
    </div>
  )
}
