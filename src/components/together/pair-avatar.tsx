import * as React from "react"
import { cn } from "@/lib/utils"
import { Avatar } from "./avatar"

export interface PairAvatarProps {
  a?: string
  b?: string
  size?: number
  className?: string
}

export function PairAvatar({
  a = "M",
  b = "G",
  size = 22,
  className,
}: PairAvatarProps) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <Avatar name={a} size={size} tone="sea" />
      <Avatar name={b} size={size} tone="clay" className="-ml-1.5" />
    </span>
  )
}
