"use client"

import { useActionState } from "react"

import { signIn } from "@/lib/auth/actions"

export function SignInForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, isPending] = useActionState(signIn, null)

  return (
    <form action={formAction} className="mt-8 flex flex-col">
      <input type="hidden" name="next" value={nextPath} />

      <label className="block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Email
        </span>
        <input
          name="email"
          type="email"
          placeholder="you@example.com"
          required
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[16px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>

      <label className="mt-5 block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Password
        </span>
        <input
          name="password"
          type="password"
          required
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[16px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="mt-8 w-full rounded-full border-0 bg-foreground py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
      >
        {isPending ? "signing in…" : "sign in"}
      </button>

      {state?.error ? (
        <p className="mt-3 font-mono text-[10px] text-clay">{state.error}</p>
      ) : null}
    </form>
  )
}
