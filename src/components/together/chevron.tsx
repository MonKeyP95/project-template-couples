import * as React from "react"

export type ChevronDir = "left" | "right" | "up" | "down"

const rotations: Record<ChevronDir, number> = {
  right: 0,
  left: 180,
  up: -90,
  down: 90,
}

export interface ChevronProps {
  dir?: ChevronDir
  size?: number
  color?: string
  className?: string
}

export function Chevron({
  dir = "right",
  size = 10,
  color = "currentColor",
  className,
}: ChevronProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      aria-hidden
      className={className}
      style={{
        transform: `rotate(${rotations[dir]}deg)`,
        transition: "transform 0.2s",
      }}
    >
      <path
        d="M3 1.5 L7 5 L3 8.5"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
