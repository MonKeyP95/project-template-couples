"use client"

import * as React from "react"
import Link from "next/link"

import { deleteHomeIdea } from "@/lib/ai/home-idea-actions"
import type { EarlierIdea } from "@/lib/ai/suggestion-types"

/** `25 Nov`; UTC so the server and browser render the same text. */
function madeOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
}

/** The "Earlier ideas" list inside the assistant box, newest first. Tapping a
 * line opens its full text; × deletes it for good. An idea made into a trip is
 * faded and links to the trip instead of offering "let's do it". */
export function EarlierIdeas({
  ideas,
  onAccept,
}: {
  ideas: EarlierIdea[]
  onAccept: (idea: EarlierIdea) => void
}) {
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const [removed, setRemoved] = React.useState<Set<string>>(new Set())

  function remove(id: string) {
    setRemoved((r) => new Set(r).add(id))
    deleteHomeIdea(id)
  }

  return (
    <ul className="flex flex-col border-t border-rule">
      {ideas
        .filter((idea) => !removed.has(idea.id))
        .map((idea) => (
          <li
            key={idea.id}
            className={`border-b border-rule last:border-b-0 ${idea.tripSlug ? "opacity-60" : ""}`}
          >
            <div className="flex items-start gap-2 py-2">
              <button
                type="button"
                onClick={() => setExpanded(expanded === idea.id ? null : idea.id)}
                aria-expanded={expanded === idea.id}
                className="min-w-0 flex-1 text-left"
              >
                <span className="text-[13px] text-foreground">{idea.label}</span>
                <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {madeOn(idea.createdAt)}
                </span>
                {expanded === idea.id ? null : (
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {idea.body}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => remove(idea.id)}
                aria-label={`Delete ${idea.label}`}
                className="shrink-0 px-1 text-[14px] leading-none text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
            {expanded === idea.id ? (
              <div className="flex flex-col items-start gap-2 pb-2.5">
                <p className="text-[12.5px] leading-relaxed text-foreground">{idea.body}</p>
                {idea.tripSlug ? (
                  <Link
                    href={`/trips/${idea.tripSlug}`}
                    className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground hover:underline"
                  >
                    became a trip ›
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAccept(idea)}
                    className="rounded-full bg-sea px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
                  >
                    let&apos;s do it
                  </button>
                )}
              </div>
            ) : idea.tripSlug ? (
              <Link
                href={`/trips/${idea.tripSlug}`}
                className="-mt-1 mb-2 inline-block font-mono text-[10px] uppercase tracking-[0.18em] text-foreground hover:underline"
              >
                became a trip ›
              </Link>
            ) : null}
          </li>
        ))}
    </ul>
  )
}
