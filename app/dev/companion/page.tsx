import { notFound } from 'next/navigation'
import CompanionHarness from './CompanionHarness'

export const metadata = { title: 'Lady Luck harness' }

/** Dev-only turntable for the Lady Luck companion. */
export default function CompanionDevPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <CompanionHarness />
}
