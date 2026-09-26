import { notFound } from 'next/navigation'
import BadgePreview from './BadgePreview'
import CompanionHarness from './CompanionHarness'

export const metadata = { title: 'Lady Luck harness' }

/** Dev-only turntable for the Lady Luck companion (`?badge=1` previews the 2D sticker). */
export default async function CompanionDevPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  const params = await searchParams
  return params.badge ? <BadgePreview /> : <CompanionHarness />
}
