const INK = "#172434"
const SAIL = "M-2 -6 L-19 -62 Q4 -46 26 -58 Z"
const TEETH =
  "M-30 -33 L-27 -42 L-24 -33 L-21 -42 L-18 -33 L-15 -42 L-12 -33 L-9 -42 L-6 -33 L-3 -42 L0 -33 L3 -42 L6 -33 L9 -42 L12 -33 L15 -42 L18 -33 L21 -42 L24 -33 L27 -42 L30 -33 Z"

/**
 * Small sailing canoe for the voyage theme: a coral hull and a crab-claw sail
 * with a band of triangles. Our own drawing, as an SVG group whose origin is
 * the waterline at the hull's centre (~96 x 66 units).
 */
export function VoyageCanoe({ transform }: { transform: string }) {
  return (
    <g transform={transform}>
      <defs>
        <clipPath id="voyage-sail">
          <path d={SAIL} />
        </clipPath>
      </defs>
      <path d={SAIL} fill="#fff4d6" />
      <g clipPath="url(#voyage-sail)">
        <rect x="-30" y="-42" width="60" height="9" fill="#ff8a65" />
        <path d={TEETH} fill={INK} />
        <path d="M-30 -42 H30 M-30 -33 H30 M-30 -22 H30" stroke={INK} strokeWidth="1.6" />
      </g>
      <path d={SAIL} fill="none" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
      <line x1="0" y1="-4" x2="0" y2="-56" stroke={INK} strokeWidth="3.5" />
      <path
        d="M-45 -12 Q-39 0 -27 3 L27 3 Q39 0 45 -12 L37 -8 Q31 -4 25 -4 L-25 -4 Q-31 -4 -37 -8 Z"
        fill="#ff8a65"
        stroke={INK}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
    </g>
  )
}
