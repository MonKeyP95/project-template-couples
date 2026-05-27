import * as React from "react"
import { cn } from "@/lib/utils"

export function Coord({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "t-mono text-[11px] tracking-[0.04em] text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
