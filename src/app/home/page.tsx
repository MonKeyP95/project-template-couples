import Link from "next/link"
import { redirect } from "next/navigation"

import { InviteCard } from "@/components/invite-card"
import {
  Avatar,
  Chevron,
  Coord,
  Label,
  MonoBadge,
  PairAvatar,
  TopoBg,
  type TopoTone,
} from "@/components/together"
import { createClient } from "@/lib/supabase/server"
import {
  getCurrentWorkspace,
  type CurrentWorkspace,
  type WorkspaceMember,
} from "@/lib/workspace/queries"

type DreamTone = Extract<TopoTone, "sea" | "clay" | "moss" | "sand">

interface DreamPin {
  name: string
  coord: string
  tone: DreamTone
}

const DREAM_BOARD: DreamPin[] = [
  { name: "Faroe Islands", coord: "62.0° N · 6.8° W", tone: "moss" },
  { name: "Patagonia", coord: "50.0° S · 73.0° W", tone: "clay" },
  { name: "Hokkaido", coord: "43.0° N · 142° E", tone: "sea" },
  { name: "Aeolian Isles", coord: "38.5° N · 14.9° E", tone: "sand" },
]

const dreamSurface: Record<DreamTone, string> = {
  sea: "bg-sea-tint",
  clay: "bg-clay-tint",
  moss: "bg-moss-tint",
  sand: "bg-sand-tint",
}

const dreamLabel: Record<DreamTone, string> = {
  sea: "text-sea",
  clay: "text-clay",
  moss: "text-moss",
  sand: "text-sand",
}

function formatDateLabel(date: Date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" })
  return `${mm} / ${dd} · ${weekday}`
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

  const workspace = await getCurrentWorkspace()
  const youOnly = workspace?.members.length === 1
  const dateLabel = formatDateLabel(new Date())
  const members = workspace ? orderMembers(workspace, userData.user.id) : []
  const estYear = workspace ? new Date(workspace.createdAt).getFullYear() : null
  const memberCount = workspace?.members.length ?? 0
  const memberCountLabel = `${memberCount} member${memberCount === 1 ? "" : "s"}`

  return (
    <main className="mx-auto min-h-screen w-full max-w-[440px] bg-background px-5 pt-14 pb-10">
      <header className="mb-14 flex items-center justify-between">
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

      <section>
        <Label className="mb-2.5 block">{dateLabel}</Label>
        <h1 className="t-display text-[58px] text-foreground">
          Hello,
          <br />
          <em>{profile?.display_name ?? "friend"}</em>.
        </h1>
        <div className="my-5 h-px bg-border" />
        <div className="flex items-baseline justify-between">
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
        </div>
      </section>

      {youOnly ? (
        <section className="mt-10">
          <InviteCard />
        </section>
      ) : (
        <section className="mt-10">
          <div className="mb-2.5 flex items-center justify-between">
            <Label>Upcoming · 1</Label>
            <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
              17 days
            </span>
          </div>

          <Link
            href="/trips/lombok"
            className="block overflow-hidden rounded-[14px] border border-border bg-card shadow-md"
          >
            <div className="relative h-[132px] overflow-hidden bg-sea-tint">
              <TopoBg tone="sea" opacity={0.16} />
              <div className="relative flex h-full flex-col justify-between p-4">
                <div className="flex items-start justify-between">
                  <MonoBadge tone="sea">Surf · Dive · Trek</MonoBadge>
                  <Coord>8.7° S · 116.3° E</Coord>
                </div>
                <div>
                  <div className="t-display text-[38px] leading-none text-foreground">
                    <em>Lombok</em>
                  </div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Indonesia
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-mono text-[11px] tracking-[0.04em] text-foreground">
                  JUN 12 — JUN 20
                </div>
                <div className="mt-0.5 font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                  8 days · 2 travellers
                </div>
              </div>
              <div className="flex items-center gap-2.5 text-muted-foreground">
                {members.length >= 2 ? (
                  <PairAvatar
                    a={members[0].display_name}
                    b={members[1].display_name}
                    size={20}
                  />
                ) : null}
                <Chevron />
              </div>
            </div>
          </Link>
        </section>
      )}

      <section className="mt-9">
        <div className="mb-2.5 flex items-center justify-between">
          <Label>Dream board · {DREAM_BOARD.length}</Label>
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            someday
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {DREAM_BOARD.map((d) => (
            <DreamCard key={d.name} {...d} />
          ))}
        </div>
      </section>

      <button
        type="button"
        className="mt-7 flex w-full items-center justify-between rounded-[10px] border border-dashed border-rule bg-transparent px-4 py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>+ new trip</span>
        <Chevron />
      </button>

      <footer className="mt-12 flex justify-center">
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

function DreamCard({ name, coord, tone }: DreamPin) {
  return (
    <div
      className={`relative flex aspect-square flex-col justify-between overflow-hidden rounded-[10px] border border-border p-3 ${dreamSurface[tone]}`}
    >
      <TopoBg tone={tone} opacity={0.1} />
      <Label className={`relative ${dreamLabel[tone]}`}>{`// dream`}</Label>
      <div className="relative">
        <div className="t-display text-[20px] text-foreground">
          <em>{name}</em>
        </div>
        <Coord>{coord}</Coord>
      </div>
    </div>
  )
}
