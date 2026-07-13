"use client"

import * as React from "react"

import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { TripProfile } from "@/lib/trips/trip-profile-types"

/** Read-only summary of the trip profile. Each section is hidden when its data
 * is empty. When idea/transport/vibe are all empty the card shows a quiet
 * set-up prompt and the button reads "Set up profile". Categories are always
 * seeded, so that section is effectively always present. */
export function ProfileOverview({
  profile,
  categories,
  onEdit,
}: {
  profile: TripProfile
  categories: ExpenseCategoryRow[]
  onEdit: () => void
}) {
  const isEmpty =
    !profile.idea.trim() &&
    profile.transport.length === 0 &&
    profile.vibe.length === 0

  return (
    <section className="px-5 pt-5 lg:px-10 lg:pt-6">
      {isEmpty ? (
        <p className="t-display text-[20px] text-muted-foreground">
          No profile yet — add a few details
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {profile.idea.trim() ? (
            <h3 className="t-display text-[22px] text-foreground">
              {profile.idea}
            </h3>
          ) : null}

          {categories.length ? (
            <Section label="Categories">
              <div className="flex flex-col gap-2">
                {categories.map((c) => (
                  <div key={c.id} className="text-[15px] text-foreground">
                    {c.name}
                    {c.details.length ? (
                      <span className="text-muted-foreground">
                        {" · "}
                        {c.details.join(", ")}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {profile.transport.length ? (
            <Section label="Getting around">
              <Chips items={profile.transport} />
            </Section>
          ) : null}

          {profile.vibe.length ? (
            <Section label="Vibe">
              <Chips items={profile.vibe} />
            </Section>
          ) : null}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-background"
        >
          {isEmpty ? "set up profile" : "edit profile"}
        </button>
      </div>
    </section>
  )
}

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span
          key={t}
          className="inline-flex items-center rounded-xl border border-rule px-3 py-1.5 text-[14px] text-foreground"
        >
          {t}
        </span>
      ))}
    </div>
  )
}
