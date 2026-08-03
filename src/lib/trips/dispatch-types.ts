/** What kind of thing an item is. General news headlines are excluded by
 * design — they do not change the couple's day. */
export type DispatchKind = "whats_on" | "disrupted" | "conditions"

export interface DispatchItem {
  kind: DispatchKind
  title: string
  /** One line on what it is and why it matters today. */
  body: string
  /** The date or span it applies to, e.g. "Sat 8 Aug". Never empty. */
  window: string
  /** Real URL from the web search backing this item. Never empty. */
  sourceUrl: string
}

export interface TripDispatch {
  id: string
  tripId: string
  dayDate: string
  items: DispatchItem[]
  generatedAt: string
}

export const DISPATCH_KIND_LABEL: Record<DispatchKind, string> = {
  whats_on: "What's on",
  disrupted: "Heads up",
  conditions: "Conditions",
}

/** The most items one day's dispatch may carry. */
export const MAX_DISPATCH_ITEMS = 2
