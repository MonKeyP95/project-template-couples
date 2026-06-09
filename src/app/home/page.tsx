import Link from "next/link"
import { redirect } from "next/navigation"

import { InviteCard } from "@/components/invite-card"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Avatar,
  Chevron,
  Coord,
  Label,
  PairAvatar,
} from "@/components/together"
import { createClient } from "@/lib/supabase/server"
import { isDarkTheme } from "@/lib/theme"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import {
  getCurrentWorkspace,
  type CurrentWorkspace,
  type WorkspaceMember,
} from "@/lib/workspace/queries"

import { daysUntil, dayWithinTrip } from "./format-helpers"
import { CompactRow, DreamTile, HeroCard, TripCard } from "./trip-cards"
import { TripRoutePanel } from "./trip-route-panel"

function formatDateLabel(date: Date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" })
  return `${dd} / ${mm} · ${weekday}`
}

function orderMembers(
  workspace: CurrentWorkspace,
  currentUserId: string,
): WorkspaceMember[] {
  const me = workspace.members.find((m) => m.user_id === currentUserId)
  const others = workspace.members.filter((m) => m.user_id !== currentUserId)
  return me ? [me, ...others] : workspace.members
}

export default async function HomePage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/home")

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userData.user.id)
    .single()

  const dark = await isDarkTheme()
  const workspace = await getCurrentWorkspace()
  const youOnly = workspace?.members.length === 1
  const dateLabel = formatDateLabel(new Date())
  const members = workspace ? orderMembers(workspace, userData.user.id) : []
  const estYear = workspace ? new Date(workspace.createdAt).getFullYear() : null
  const memberCount = workspace?.members.length ?? 0
  const memberCountLabel = `${memberCount} member${memberCount === 1 ? "" : "s"}`

  const buckets = workspace
    ? await listTripsForWorkspace(workspace.id)
    : { now: [], upcoming: [], past: [], dreams: [] }

  // Hero claim: prefer the earliest "now" trip; otherwise the soonest "upcoming".
  const hero = buckets.now[0] ?? buckets.upcoming[0] ?? null
  const heroLocations = hero
    ? (await getItineraryLocations(hero.id)).map((l) => l.name)
    : []
  const trips = [
    ...buckets.now.slice(buckets.now[0] ? 1 : 0),
    ...buckets.upcoming.slice(hero && !buckets.now[0] ? 1 : 0),
  ]
  const activeCount = buckets.now.length + buckets.upcoming.length

  const heroCountdown = hero
    ? hero.state === "now"
      ? (() => {
          const d = dayWithinTrip(hero.startDate, hero.endDate)
          return d ? `day ${d.day} / ${d.total}` : null
        })()
      : (() => {
          const d = daysUntil(hero.startDate)
          return d != null ? `${d} days` : null
        })()
    : null

  return (
    <main className="mx-auto min-h-screen w-full max-w-[440px] px-5 pt-14 pb-10 md:max-w-[1200px] md:px-12 md:pt-12 md:pb-16">
      <header className="mb-14 flex items-center justify-between md:hidden">
        <Label>Together · Workspace</Label>
        {members.length >= 2 ? (
          <PairAvatar
            a={members[0].display_name}
            b={members[1].display_name}
            size={20}
          />
        ) : members.length === 1 ? (
          <Avatar name={members[0].display_name} size={20} tone="sea" />
        ) : null}
      </header>

      <section className="md:flex md:items-start md:justify-between">
        <div>
          <Label className="mb-2.5 block md:hidden">{dateLabel}</Label>
          <Label className="hidden md:block">Together · Workspace</Label>
          <h1 className="t-display text-[58px] text-foreground md:mt-2.5 md:text-[80px] md:leading-[0.95]">
            Hello,
            <br className="md:hidden" />
            <em>{profile?.display_name ?? "friend"}</em>.
          </h1>
        </div>
        <div className="hidden text-right md:block">
          <Coord>{dateLabel}</Coord>
          <div className="mt-2.5 flex justify-end">
            {members.length >= 2 ? (
              <PairAvatar
                a={members[0].display_name}
                b={members[1].display_name}
                size={26}
              />
            ) : members.length === 1 ? (
              <Avatar name={members[0].display_name} size={26} tone="sea" />
            ) : null}
          </div>
        </div>
      </section>

      <div className="my-5 h-px bg-border md:my-7" />

      <section className="flex items-baseline justify-between md:hidden">
        <div className="text-[13px] text-muted-foreground">
          {members.map((m, i) => (
            <span key={m.user_id}>
              {i > 0 ? " & " : null}
              <span className="font-serif italic text-foreground">
                {m.display_name}
              </span>
            </span>
          ))}
        </div>
        <Coord>
          {estYear ? `est. ${estYear} · ` : ""}
          {memberCountLabel}
        </Coord>
      </section>

      <section className="mb-3 hidden flex-wrap items-baseline gap-7 md:flex">
        <StatItem n={activeCount} label="Upcoming" />
        <StatItem n={buckets.dreams.length} label="Dreams" />
        <StatItem
          n={memberCount}
          label={memberCount === 1 ? "Member" : "Members"}
        />
        {estYear ? (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            est. {estYear}
          </span>
        ) : null}
      </section>

      {youOnly ? (
        <section className="mt-10 md:mt-12 md:max-w-[540px]">
          <InviteCard />
        </section>
      ) : (
        <>
          {hero ? (
            <section className="mt-10 md:mt-12">
              <div className="mb-2.5 flex items-center justify-between md:mb-4">
                <Label>
                  {hero.state === "now"
                    ? `Now · ${buckets.now.length}`
                    : `Upcoming · ${activeCount}`}
                </Label>
                {heroCountdown ? (
                  <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                    {heroCountdown}
                  </span>
                ) : null}
              </div>
              <div className="md:grid md:grid-cols-2 md:gap-5">
                <HeroCard trip={hero} />
                <div className="hidden md:block">
                  <TripRoutePanel slug={hero.slug} locations={heroLocations} />
                </div>
              </div>
            </section>
          ) : null}

          {trips.length > 0 ? (
            <section className="mt-9 md:mt-12">
              <div className="mb-2.5 flex items-center justify-between md:mb-4">
                <Label>Trips · {trips.length}</Label>
              </div>
              <div className="flex flex-col gap-2.5 md:grid md:grid-cols-2 md:gap-5 lg:grid-cols-3">
                {trips.map((t) => (
                  <TripCard key={t.id} trip={t} />
                ))}
              </div>
            </section>
          ) : null}

          {buckets.dreams.length > 0 ? (
            <section className="mt-9 md:mt-14">
              <div className="mb-2.5 flex items-center justify-between md:mb-4">
                <Label>Dreams · {buckets.dreams.length}</Label>
                <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                  someday, together
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-4">
                {buckets.dreams.map((d) => (
                  <DreamTile key={d.id} trip={d} />
                ))}
              </div>
            </section>
          ) : null}

          {buckets.past.length > 0 ? (
            <section className="mt-9 md:mt-12">
              <div className="mb-2.5 flex items-center justify-between md:mb-4">
                <Label>Past · {buckets.past.length}</Label>
                <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                  most recent first
                </span>
              </div>
              <div className="flex flex-col gap-2.5 md:grid md:grid-cols-3 md:gap-4 lg:grid-cols-4">
                {buckets.past.map((p) => (
                  <CompactRow key={p.id} trip={p} dimmed />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <Link
        href="/trips/new"
        className="mt-7 flex w-full items-center justify-between rounded-[10px] border border-dashed border-rule bg-transparent px-4 py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground md:mt-9 md:max-w-[280px] md:px-5 md:py-5"
      >
        <span>+ new trip or dream</span>
        <Chevron />
      </Link>

      <footer className="mt-12 flex items-center justify-center gap-5 md:mt-16">
        <ThemeToggle initialDark={dark} />
        <span className="text-rule">·</span>
        <form action="/api/signout" method="post">
          <button
            type="submit"
            className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </footer>
    </main>
  )
}

function StatItem({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="t-num text-[18px] text-foreground">
        {String(n).padStart(2, "0")}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
    </div>
  )
}
