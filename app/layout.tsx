import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans, Unbounded } from 'next/font/google'
import './styles/tokens.css'
import './globals.css'
import './styles/base.css'
import './poker-polish.css'
import './styles/table-2d.css'
import './styles/companion.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
})

const unbounded = Unbounded({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-unbounded',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Poker Night',
  description: 'Multiplayer Texas Hold\'em poker',
  icons: {
    icon: '/icon.svg',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a1112',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${jakarta.variable} ${unbounded.variable}`}>
      <body>{children}</body>
    </html>
  )
}
