import { cookies } from "next/headers"

import { TZ_COOKIE, todayInTimeZone } from "./today"

/** The device's IANA timezone, read from the tz cookie. */
export async function localTimeZone(): Promise<string> {
  return (await cookies()).get(TZ_COOKIE)?.value || "UTC"
}

/** Device-local "today" (yyyy-mm-dd), read from the tz cookie. */
export async function localToday(): Promise<string> {
  return todayInTimeZone(await localTimeZone())
}

/** Request time in ms, for render-time checks such as due note reminders. */
export function requestNowMs(): number {
  return Date.now()
}
