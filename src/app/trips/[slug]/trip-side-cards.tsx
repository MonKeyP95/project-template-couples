import type { ReactNode } from "react"
import Link from "next/link"

import { Bar } from "@/components/together"
import { moneyRounded } from "@/lib/money"
import { documentTitle, type TripDocument } from "@/lib/trips/document-types"
import { daySummary, type ItineraryDay } from "@/lib/trips/itinerary-types"
import type { TripNote } from "@/lib/trips/note-queries"
import { isPlannedRow } from "@/lib/trips/outside-days"

export type SideCardId = "budget" | "itinerary" | "packing" | "notes"

const TOP_BORDER: Record<SideCardId, string> = {
  budget: "border-t-dusk",
  itinerary: "border-t-sea",
  packing: "border-t-clay",
  notes: "border-t-sand",
}

/** One small section in the desktop right rail; the header opens it as the main tab. */
export function SideCard({
  id,
  title,
  href,
  children,
}: {
  id: SideCardId
  title: string
  href: string
  children: ReactNode
}) {
  return (
    <section
      className={`overflow-hidden rounded-[14px] border border-t-[3px] border-border bg-background ${TOP_BORDER[id]}`}
    >
      <Link
        href={href}
        aria-label={`Open ${title}`}
        className="group flex items-center justify-between px-3.5 pt-3 pb-2.5"
      >
        <h3 className="font-serif text-[22px] italic leading-none text-foreground">
          {title}
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground group-hover:text-sea">
          open &rarr;
        </span>
      </Link>
      <div className="flex flex-col gap-2.5 px-3.5 pb-3.5">{children}</div>
    </section>
  )
}

function pctOf(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100)
}

function PctBar({ pct, tone }: { pct: number; tone: "sea" | "moss" }) {
  return (
    <div className="flex items-center gap-2">
      <Bar pct={pct} tone={tone} className="flex-1" />
      <span className="t-num font-mono text-[10px] text-muted-foreground">{pct}%</span>
    </div>
  )
}

export function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-serif text-[14px] italic text-foreground">{label}</span>
      <span className="t-num text-[11px] text-muted-foreground">{value}</span>
    </div>
  )
}

/** Spent and saved against the plan, plus the two biggest categories. */
export function BudgetMini({
  spentCents,
  savedCents,
  plannedCents,
  topCategories,
  currency,
  locale,
}: {
  spentCents: number
  savedCents: number
  plannedCents: number
  topCategories: { name: string; cents: number }[]
  currency: string
  locale: string
}) {
  const of = (cents: number) =>
    `${moneyRounded(cents, currency, locale)} / ${moneyRounded(plannedCents, currency, locale)}`
  return (
    <>
      <MiniRow label="Spent" value={of(spentCents)} />
      <PctBar pct={pctOf(spentCents, plannedCents)} tone="sea" />
      <MiniRow label="Saved" value={of(savedCents)} />
      <PctBar pct={pctOf(savedCents, plannedCents)} tone="moss" />
      {topCategories.length > 0 ? (
        <p className="text-[12px] text-muted-foreground">
          Biggest:{" "}
          {topCategories
            .map((c) => `${c.name} ${moneyRounded(c.cents, currency, locale)}`)
            .join(" · ")}
        </p>
      ) : null}
    </>
  )
}

/** The route as a strip of stops, then the next three days. */
export function ItineraryMini({
  locations,
  days,
  today,
}: {
  locations: string[]
  days: ItineraryDay[]
  today: string
}) {
  const upcoming = days.filter((d) => d.dayDate === null || d.dayDate >= today)
  const freeDays = days.filter((d) => !isPlannedRow(d)).length
  return (
    <>
      {locations.length > 0 ? <RouteStrip locations={locations} /> : null}
      {upcoming.slice(0, 3).map((day) => (
        <div key={day.id} className="grid grid-cols-[54px_1fr] gap-2 text-[12px]">
          <span className="pt-px font-mono text-[10px] tracking-[0.08em] text-muted-foreground">
            {day.dayDate ? `${day.dom} ${day.mon}`.toUpperCase() : `DAY ${day.d}`}
          </span>
          <span className="min-w-0 truncate text-foreground">
            {day.title || daySummary(day) || (
              <em className="text-muted-foreground">Free day</em>
            )}
          </span>
        </div>
      ))}
      {days.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No days yet</p>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          {freeDays === 0
            ? "Every day has a plan"
            : `${freeDays} free day${freeDays === 1 ? "" : "s"} left to plan`}
        </p>
      )}
    </>
  )
}

function RouteStrip({ locations }: { locations: string[] }) {
  return (
    <div className="flex items-start py-1.5">
      {locations.map((name, i) => (
        <div key={`${name}-${i}`} className="flex min-w-0 flex-1 items-start last:flex-none">
          <div className="flex min-w-0 flex-col items-center gap-1">
            <span
              className={`size-2.5 rounded-full border-2 border-sea ${i === 0 ? "bg-sea" : "bg-background"}`}
            />
            <span className="max-w-[72px] truncate font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
              {name}
            </span>
          </div>
          {i < locations.length - 1 ? (
            <span className="mt-[4px] h-0.5 min-w-3 flex-1 bg-[repeating-linear-gradient(90deg,var(--sea)_0_4px,transparent_4px_8px)]" />
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** First three documents, the newest note, and the counts. */
export function FolderMini({
  documents,
  notes,
}: {
  documents: TripDocument[]
  notes: TripNote[]
}) {
  return (
    <>
      {documents.slice(0, 3).map((doc) => (
        <a
          key={doc.id}
          href={doc.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 text-[12px] hover:text-sea"
        >
          <span className="flex h-8 w-[26px] shrink-0 items-end justify-center rounded-[4px] border border-border bg-sand-tint pb-[3px] font-mono text-[8px] text-muted-foreground">
            {doc.mimeType === "application/pdf" ? "PDF" : "IMG"}
          </span>
          <span className="min-w-0 truncate">{documentTitle(doc)}</span>
        </a>
      ))}
      {notes[0] ? (
        <p className="line-clamp-3 rounded-[12px] border border-border bg-sand-tint p-2.5 text-[12px] leading-snug text-foreground">
          {notes[0].body}
        </p>
      ) : null}
      <p className="text-[12px] text-muted-foreground">
        {documents.length} document{documents.length === 1 ? "" : "s"} ·{" "}
        {notes.length} note{notes.length === 1 ? "" : "s"}
      </p>
    </>
  )
}
