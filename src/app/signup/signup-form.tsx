"use client"

import { useActionState } from "react"

import { signUp } from "@/lib/auth/actions"

export function SignUpForm({ invite }: { invite?: string }) {
  const [state, formAction, isPending] = useActionState(signUp, null)

  return (
    <form action={formAction} className="mt-8 flex flex-col">
      {invite ? <input type="hidden" name="invite_token" value={invite} /> : null}

      <label className="block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Name
        </span>
        <input
          name="display_name"
          placeholder="Your name"
          required
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[16px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>

      <label className="mt-5 block">
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
          minLength={8}
          required
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[16px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
          min 8 characters
        </span>
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="mt-8 w-full rounded-full border-0 bg-foreground py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
      >
        {isPending ? "creating account…" : "create account"}
      </button>

      {state?.error ? (
        <p className="mt-3 font-mono text-[10px] text-clay">{state.error}</p>
      ) : null}
    </form>
  )
}
