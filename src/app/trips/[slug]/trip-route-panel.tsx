import { TopoBg } from "@/components/together"
import { slugToTone } from "@/lib/trips/slug-tone"

const surface: Record<"sea" | "clay" | "moss" | "sand", string> = {
  sea: "bg-sea-tint",
  clay: "bg-clay-tint",
  moss: "bg-moss-tint",
  sand: "bg-sand-tint",
}

const VIEW_W = 320
const VIEW_H = 200
const PAD_X = 38
const PAD_Y = 46

type Pt = { x: number; y: number }

/** Small stable integer from a slug, so each trip's curve is distinct. */
function seedFromSlug(slug: string): number {
  let s = 0
  for (let i = 0; i < slug.length; i++) s = (s + slug.charCodeAt(i)) % 997
  return s
}

/**
 * Deterministic wandering points across the viewBox. Decorative layout for the
 * schematic route -- not real geography.
 */
function routePoints(n: number, seed: number): Pt[] {
  const span = VIEW_W - PAD_X * 2
  const amp = VIEW_H / 2 - PAD_Y
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1)
    const wobble = Math.sin((i + 1) * 1.7 + seed)
    return { x: PAD_X + t * span, y: VIEW_H / 2 + wobble * amp }
  })
}

function polyline(pts: Pt[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(" ")
}

/**
 * Desktop-only schematic route shown beside the hero card. `locations` are the
 * trip's location names in order. With zero locations it shows a quiet
 * placeholder awaiting the real interactive map (a later stage).
 */
export function TripRoutePanel({
  slug,
  locations,
}: {
  slug: string
  locations: string[]
}) {
  const tone = slugToTone(slug)
  const hasRoute = locations.length > 0
  const pts = routePoints(Math.max(locations.length, 1), seedFromSlug(slug))
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[14px] border border-border bg-card shadow-md">
      <div className={`relative min-h-0 flex-1 overflow-hidden ${surface[tone]}`}>
        <TopoBg tone={tone} opacity={0.16} />
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="relative h-full w-full"
        >
          {hasRoute ? (
            <>
              <polyline
                points={polyline(pts)}
                fill="none"
                stroke="var(--moss)"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={5} fill="var(--foreground)" />
                  <text
                    x={p.x}
                    y={p.y + (p.y > VIEW_H / 2 ? 16 : -10)}
                    textAnchor="middle"
                    fontFamily="monospace"
                    fontSize={9}
                    fill="var(--muted-foreground)"
                  >
                    {locations[i]}
                  </text>
                </g>
              ))}
            </>
          ) : (
            <>
              <circle cx={VIEW_W / 2} cy={VIEW_H / 2} r={6} fill="var(--clay)" />
              <text
                x={VIEW_W / 2}
                y={VIEW_H / 2 + 26}
                textAnchor="middle"
                fontFamily="monospace"
                fontSize={10}
                letterSpacing={2}
                fill="var(--muted-foreground)"
              >
                {"// map"}
              </text>
            </>
          )}
        </svg>
      </div>
      <div className="px-4 py-3 md:px-5 md:py-3.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {hasRoute
            ? `${locations.length} stop${locations.length === 1 ? "" : "s"} · route`
            : "route"}
        </span>
      </div>
    </div>
  )
}
