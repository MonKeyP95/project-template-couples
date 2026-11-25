import { redirect } from "next/navigation"

import { InviteCard } from "@/components/invite-card"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Avatar,
  Coord,
  Label,
  PairAvatar,
} from "@/components/together"
import {
  LeftRail,
  MobileNavPill,
  SignOutButton,
  buildNavDestinations,
} from "@/components/app-nav"
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
import { createClient } from "@/lib/supabase/server"
import { getTheme } from "@/lib/theme"
import { getTodayForTrip } from "@/lib/trips/itinerary-queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { listEarlier, listPills } from "@/lib/ai/home-idea-queries"
import { localToday } from "@/lib/time/local-today"
import {
  getCurrentWorkspace,
  type CurrentWorkspace,
  type WorkspaceMember,
} from "@/lib/workspace/queries"

import { daysUntil, dayWithinTrip } from "./format-helpers"
import { DreamTile, HeroCard, PastChip, TripCard } from "./trip-cards"
import { IdeasLine } from "./ideas-line"
import { NewBox } from "./new-box"

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

  const theme = await getTheme()
  const workspace = await getCurrentWorkspace()
  const youOnly = workspace?.members.length === 1
  const dateLabel = formatDateLabel(new Date())
  const members = workspace ? orderMembers(workspace, userData.user.id) : []

  const [pills, earlier] = workspace
    ? await Promise.all([listPills(workspace.id), listEarlier(workspace.id)])
    : [[], []]
  const buckets = workspace
    ? await listTripsForWorkspace(workspace.id)
    : { now: [], upcoming: [], past: [], dreams: [] }

  const noTripsYet =
    buckets.now.length === 0 &&
    buckets.upcoming.length === 0 &&
    buckets.past.length === 0 &&
    buckets.dreams.length === 0

  // Hero claim: prefer the earliest "now" trip; otherwise the soonest "upcoming".
  const hero = buckets.now[0] ?? buckets.upcoming[0] ?? null
  const navDestinations = buildNavDestinations({
    onTheRoad: buckets.now.length > 0,
    tripSlug: hero?.slug ?? null,
  })
  const heroToday =
    hero && hero.state === "now"
      ? await getTodayForTrip(hero.id, await localToday())
      : null
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
    <div className="relative mx-auto min-h-screen w-full max-w-[440px] lg:flex lg:max-w-none lg:items-stretch">
      {workspace ? (
        <LeftRail
          workspace={workspace}
          initialTheme={theme}
          destinations={navDestinations}
          current="home"
        />
      ) : null}
      <main className="w-full px-5 pt-5 pb-28 lg:min-w-0 lg:flex-1 lg:px-12 lg:pt-12 lg:pb-16">
      {workspace ? (
        <MobileNavPill destinations={navDestinations} current="home" />
      ) : null}
      <section className="flex items-start justify-between">
        <div>
          <Label className="hidden md:block">Together · Workspace</Label>
          <h1 className="t-display text-[44px] text-foreground md:mt-2 md:text-[62px] md:leading-[0.95]">
            Hello,{" "}
            <br className="md:hidden" />
            <em>{profile?.display_name?.split(" ")[0] ?? "friend"}</em>.
          </h1>
        </div>
        <div className="flex items-start gap-4">
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
          <SignOutButton className="flex items-center pt-1 text-muted-foreground hover:text-foreground lg:hidden" />
        </div>
      </section>

      <div className="mt-2 flex items-center justify-between lg:hidden">
        <WorkspaceSwitcher />
        <div className="flex md:hidden">
          {members.length >= 2 ? (
            <PairAvatar
              a={members[0].display_name}
              b={members[1].display_name}
              size={20}
            />
          ) : members.length === 1 ? (
            <Avatar name={members[0].display_name} size={20} tone="sea" />
          ) : null}
        </div>
      </div>

      <div className="my-3 h-px bg-border md:my-7" />

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
        <Coord>{dateLabel}</Coord>
      </section>

      <div className="mt-5 grid gap-3 md:mt-10 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-start">
        <NewBox />
        <IdeasLine pills={pills} earlier={earlier} />
      </div>

      {youOnly && noTripsYet ? (
        <section className="mt-7 md:mt-10 md:max-w-[540px]">
          <InviteCard />
        </section>
      ) : (
        <>
          {hero ? (
            <div className="mt-7 md:mt-10 md:grid md:grid-cols-[minmax(0,1fr)_340px] md:gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-10">
              <section>
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
                <HeroCard trip={hero} today={heroToday} />
              </section>

              {trips.length > 0 ? (
                <details open className="group mt-9 border-t border-rule pt-6 md:mt-0 md:border-t-0 md:border-l md:pt-0 md:pl-8 lg:pl-10">
                  <summary className="mb-2.5 flex cursor-pointer list-none items-center gap-2 md:mb-4 [&::-webkit-details-marker]:hidden">
                    <span
                      aria-hidden
                      className="-rotate-90 font-mono text-[11px] text-muted-foreground transition-transform group-open:rotate-0 motion-reduce:transition-none"
                    >
                      ▾
                    </span>
                    <Label>Trips · {trips.length}</Label>
                  </summary>
                  <div className="flex flex-col gap-2.5 md:gap-3">
                    {trips.map((t) => (
                      <TripCard key={t.id} trip={t} />
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}

          {buckets.dreams.length > 0 ? (
            <section className="mt-9 md:mt-12">
              <div className="mb-2.5 flex items-center justify-between md:mb-4">
                <Label>Dreams · {buckets.dreams.length}</Label>
                <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                  someday, together
                </span>
              </div>
              <div className="flex snap-x gap-2.5 overflow-x-auto pb-1.5 md:gap-3">
                {buckets.dreams.map((d) => (
                  <DreamTile key={d.id} trip={d} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      {!youOnly && buckets.past.length > 0 ? (
        <section className="mt-9 md:mt-12">
          <div className="mb-2.5 flex items-center justify-between md:mb-4">
            <Label>Past · {buckets.past.length}</Label>
            <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
              most recent first
            </span>
          </div>
          <div className="flex snap-x gap-2.5 overflow-x-auto pb-1.5 md:gap-3">
            {buckets.past.map((p) => (
              <PastChip key={p.id} trip={p} />
            ))}
          </div>
        </section>
      ) : null}

      <footer className="mt-12 flex items-center justify-center gap-5 md:mt-16 lg:hidden">
        <ThemeToggle initialTheme={theme} />
      </footer>
      </main>
    </div>
  )
}
