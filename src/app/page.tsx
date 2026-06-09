import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `
            radial-gradient(60% 55% at 12% -5%, var(--glow-peach) 0%, transparent 65%),
            radial-gradient(55% 50% at 100% 105%, var(--glow-teal) 0%, transparent 60%)
          `,
        }}
      />

      <header className="absolute left-6 top-6 z-10 sm:left-10 sm:top-10">
        <span
          className="reveal font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground/80"
          style={{ animationDelay: "0.05s" }}
        >
          Together
        </span>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center px-6 text-center sm:px-10">
        <h1
          className="reveal font-serif text-[clamp(3.25rem,11vw,8rem)] font-normal leading-[0.95] tracking-tight text-balance"
          style={{ animationDelay: "0.18s" }}
        >
          Plan trips
          <br />
          <span className="italic text-primary">together</span>.
        </h1>

        <p
          className="reveal mt-10 max-w-[34ch] text-[15px] leading-[1.75] text-muted-foreground sm:text-base"
          style={{ animationDelay: "0.42s" }}
        >
          A calm shared space for couples and families.
          <br />
          Itineraries, packing lists, ideas, dreams.
        </p>

        <div
          className="reveal mt-12 flex flex-col items-center gap-3"
          style={{ animationDelay: "0.66s" }}
        >
          <Link
            href="/signin"
            prefetch={false}
            className={cn(buttonVariants({ size: "lg" }), "px-10")}
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            prefetch={false}
            className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground/55 underline-offset-4 transition-colors hover:text-muted-foreground hover:underline"
          >
            Create an account
          </Link>
        </div>
      </section>

      <footer className="absolute bottom-6 right-6 z-10 sm:bottom-10 sm:right-10">
        <span
          className="reveal font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground/80"
          style={{ animationDelay: "0.9s" }}
        >
          Est. 2026 · For two
        </span>
      </footer>
    </main>
  )
}
