"use client"

import { useActionState } from "react"

import { signIn } from "@/lib/auth/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function SignInForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, isPending] = useActionState(signIn, null)

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="next" value={nextPath} />
      <Input name="email" type="email" placeholder="Email" required />
      <Input name="password" type="password" placeholder="Password" required />
      <Button type="submit" size="lg" className="mt-2" disabled={isPending}>
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
      {state?.error ? (
        <p className="mt-1 text-sm text-destructive">{state.error}</p>
      ) : null}
    </form>
  )
}
