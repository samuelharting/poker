import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Poker Night',
  description: 'Multiplayer Texas Hold\'em poker',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
