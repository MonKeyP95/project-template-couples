import Link from "next/link"

import { signUp } from "@/lib/auth/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>
}) {
  const { invite } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-5xl leading-[1] tracking-tight">
          Make space <span className="italic text-primary">for two</span>.
        </h1>

        {invite ? (
          <p className="mt-4 text-sm text-muted-foreground">
            You're joining a workspace you were invited to.
          </p>
        ) : null}

        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <form action={signUp as any} className="mt-8 flex flex-col gap-3">
          {invite ? (
            <input type="hidden" name="invite_token" value={invite} />
          ) : null}
          <Input name="display_name" placeholder="Your name" required />
          <Input name="email" type="email" placeholder="Email" required />
          <Input
            name="password"
            type="password"
            placeholder="Password (min 8)"
            minLength={8}
            required
          />
          <Button type="submit" size="lg" className="mt-2">
            Sign up
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={invite ? `/signin?invite=${invite}` : "/signin"}
            className="text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
