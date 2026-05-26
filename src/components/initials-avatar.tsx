import { cn } from "@/lib/utils"
import { colorFromName, makeInitials } from "@/lib/initials"

interface InitialsAvatarProps {
  name: string
  size?: "sm" | "md" | "lg"
  className?: string
}

const SIZES: Record<NonNullable<InitialsAvatarProps["size"]>, string> = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-base",
}

export function InitialsAvatar({ name, size = "md", className }: InitialsAvatarProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-medium text-foreground/80",
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: colorFromName(name) }}
      aria-label={name}
    >
      {makeInitials(name)}
    </span>
  )
}
