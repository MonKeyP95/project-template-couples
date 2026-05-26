import Link from "next/link"

import { signIn } from "@/lib/auth/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; invite?: string }>
}) {
  const { next, invite } = await searchParams
  const nextPath = next ?? (invite ? `/join/${invite}` : "/home")

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-5xl leading-[1] tracking-tight">
          Welcome <span className="italic text-primary">back</span>.
        </h1>

        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <form action={signIn as any} className="mt-8 flex flex-col gap-3">
          <input type="hidden" name="next" value={nextPath} />
          <Input name="email" type="email" placeholder="Email" required />
          <Input name="password" type="password" placeholder="Password" required />
          <Button type="submit" size="lg" className="mt-2">
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link
            href={invite ? `/signup?invite=${invite}` : "/signup"}
            className="text-foreground underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </main>
  )
}
