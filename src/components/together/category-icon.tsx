import {
  BedDouble,
  Bus,
  CircleDot,
  Handshake,
  ShoppingBasket,
  Tag,
  Ticket,
  UtensilsCrossed,
  Wine,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

import { categoryTone, type BarTone } from "./bar"

const ICONS: Record<string, LucideIcon> = {
  "Dining out": UtensilsCrossed,
  Drinks: Wine,
  Groceries: ShoppingBasket,
  Transportation: Bus,
  Accommodation: BedDouble,
  Activities: Ticket,
  Other: CircleDot,
  Settlement: Handshake,
}

const CHIP: Record<BarTone, string> = {
  sea: "bg-sea-tint text-sea",
  sea2: "bg-sea-tint text-sea-2",
  clay: "bg-clay-tint text-clay",
  moss: "bg-moss-tint text-moss",
  sand: "bg-sand-tint text-sand",
  dusk: "bg-dusk-tint text-dusk",
  red: "bg-destructive/10 text-destructive",
  ink: "bg-muted text-foreground",
  muted: "bg-muted text-muted-foreground",
}

/** A category's colour app-wide: its position in the trip's category list
 * (same palette as the category bars); muted when it is not in the list. */
export function categoryToneOf(name: string, names: string[]): BarTone {
  const i = names.indexOf(name)
  return i === -1 ? "muted" : categoryTone(i)
}

/** The category as a small tinted round icon; the name is its label. */
export function CategoryIcon({
  name,
  tone,
  size = 26,
  className,
}: {
  name: string
  tone: BarTone
  size?: number
  className?: string
}) {
  const Icon = ICONS[name] ?? Tag
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        CHIP[tone],
        className,
      )}
    >
      <Icon size={Math.round(size * 0.55)} strokeWidth={1.75} aria-hidden />
    </span>
  )
}
