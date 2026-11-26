import { bindMoney, countryLocale, type MoneyFns } from "@/lib/money"
import { resolveActiveMembership } from "@/lib/workspace/active"

/** Money formatters bound to the active workspace's home-country locale. */
export async function getMoney(): Promise<MoneyFns> {
  const membership = await resolveActiveMembership()
  return bindMoney(countryLocale(membership?.workspace.home_country ?? ""))
}
