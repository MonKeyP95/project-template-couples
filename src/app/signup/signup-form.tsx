"use client"

import { useActionState } from "react"

import { signUp } from "@/lib/auth/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function SignUpForm({ invite }: { invite?: string }) {
  const [state, formAction, isPending] = useActionState(signUp, null)

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      {invite ? <input type="hidden" name="invite_token" value={invite} /> : null}
      <Input name="display_name" placeholder="Your name" required />
      <Input name="email" type="email" placeholder="Email" required />
      <Input
        name="password"
        type="password"
        placeholder="Password (min 8)"
        minLength={8}
        required
      />
      <Button type="submit" size="lg" className="mt-2" disabled={isPending}>
        {isPending ? "Creating account…" : "Sign up"}
      </Button>
      {state?.error ? (
        <p className="mt-1 text-sm text-destructive">{state.error}</p>
      ) : null}
    </form>
  )
}
