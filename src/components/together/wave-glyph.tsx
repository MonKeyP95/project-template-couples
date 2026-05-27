import * as React from "react"

export interface WaveGlyphProps {
  color?: string
  w?: number
  h?: number
  className?: string
}

export function WaveGlyph({
  color = "currentColor",
  w = 80,
  h = 16,
  className,
}: WaveGlyphProps) {
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 80 16"
      aria-hidden
      className={className}
      style={{ display: "block" }}
    >
      <path
        d="M0 8 Q 5 1, 10 8 T 20 8 T 30 8 T 40 8 T 50 8 T 60 8 T 70 8 T 80 8"
        fill="none"
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  )
}
