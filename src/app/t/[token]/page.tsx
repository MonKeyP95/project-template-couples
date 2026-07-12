import { Label, TopoBg, WaveGlyph } from "@/components/together"
import { createClient } from "@/lib/supabase/server"
import { formatEventTime } from "@/lib/trips/itinerary-types"
import { getSharedTrip } from "@/lib/trips/shared-trip-queries"
import type { SharedDay, SharedTrip } from "@/lib/trips/shared-trip-types"

import { CopyCta } from "./copy-cta"

export default async function SharedTripPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const trip = await getSharedTrip(token)

  if (!trip) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="font-serif text-4xl tracking-tight">This trip isn&apos;t shared.</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The link may be turned off or incorrect.
          </p>
        </div>
      </main>
    )
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const isAuthed = Boolean(userData.user)

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[440px] pb-24 lg:max-w-[760px]">
      <SharedHeader trip={trip} />
      <SharedBody trip={trip} />
      <CopyCta token={token} isAuthed={isAuthed} />
    </main>
  )
}

function SharedHeader({ trip }: { trip: SharedTrip }) {
  return (
    <header className="relative overflow-hidden bg-sea-tint px-5 pt-12 pb-6 lg:px-10 lg:pt-14">
      <TopoBg tone="sea" opacity={0.18} />
      <Label>Shared trip</Label>
      <div className="relative mt-1 flex items-baseline gap-4">
        <h1 className="t-display text-[56px] text-foreground lg:text-[80px] lg:leading-[0.9]">
          <em>{trip.name}</em>
        </h1>
        <WaveGlyph color="var(--sea)" w={56} h={14} className="hidden lg:block" />
      </div>
      <div className="relative mt-2 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {trip.country ? <span>{trip.country}</span> : null}
        <span>{trip.dayCount} days</span>
      </div>
    </header>
  )
}

function SharedBody({ trip }: { trip: SharedTrip }) {
  if (trip.days.length === 0) {
    return (
      <p className="px-5 pt-8 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground lg:px-10">
        No plan yet.
      </p>
    )
  }
  return (
    <div className="px-5 pt-6 lg:px-10">
      {trip.days.map((day) => (
        <SharedDayRow key={day.ordinal} day={day} />
      ))}
    </div>
  )
}

function SharedDayRow({ day }: { day: SharedDay }) {
  return (
    <article className="border-b border-border py-5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Day {String(day.ordinal).padStart(2, "0")}
          {day.locationName ? ` · ${day.locationName}` : ""}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {day.tag}
        </span>
      </div>
      <h2 className="mt-1 font-serif text-2xl italic text-foreground">{day.title}</h2>
      {day.events.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {day.events.map((e, i) => (
            <li key={i} className="flex gap-3 text-sm text-foreground">
              {e.time ? (
                <span className="t-num shrink-0 whitespace-nowrap text-muted-foreground">
                  {formatEventTime(e.time, e.endTime)}
                </span>
              ) : (
                <span className="w-12 shrink-0" />
              )}
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}
