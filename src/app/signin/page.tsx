import Link from "next/link"

import { SignInForm } from "./signin-form"

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; invite?: string }>
}) {
  const { next, invite } = await searchParams
  const nextPath = next || (invite ? `/join/${invite}` : "/home")

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-5xl leading-[1] tracking-tight">
          Welcome <span className="italic text-primary">back</span>.
        </h1>

        <SignInForm nextPath={nextPath} />

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
