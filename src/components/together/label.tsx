import * as React from "react"
import { cn } from "@/lib/utils"

export function Label({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("t-label", className)} {...props}>
      {children}
    </span>
  )
}
