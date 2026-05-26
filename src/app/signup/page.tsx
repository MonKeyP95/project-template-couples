import Link from "next/link"

import { SignUpForm } from "./signup-form"

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

        <SignUpForm invite={invite} />

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
