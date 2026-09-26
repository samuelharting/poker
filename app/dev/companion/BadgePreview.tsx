'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { CompanionBadge, CompanionToast } from '@/components/table/CompanionBadge'
import type { LadyLuckCompanionState } from '@/lib/poker/types'

const SEATS = [
  { id: 'ann', name: 'Ann', sx: 12, sy: 30 },
  { id: 'bob', name: 'Bob', sx: 50, sy: 12 },
  { id: 'cat', name: 'Cat', sx: 88, sy: 30 },
]

/** Dev-only preview of the 2D Lady Luck sticker + toast (mobile widths). */
export default function BadgePreview() {
  const [companion, setCompanion] = useState<LadyLuckCompanionState | null>(null)
  const [counter, setCounter] = useState(0)

  useEffect(() => {
    const api = {
      set(ownerId: string, mood: LadyLuckCompanionState['mood'], reason: LadyLuckCompanionState['reason'] = 'streak', fresh = false) {
        setCounter(value => value + 1)
        setCompanion(previous => ({
          id: fresh || !previous ? `dev-${Date.now()}` : previous.id,
          ownerId,
          reason,
          streak: mood === 'cheer' ? (previous?.streak ?? 2) + 1 : previous?.streak ?? 2,
          mood,
          since: Date.now(),
          muted: mood === 'arrive' && fresh ? false : previous?.muted ?? false,
        }))
      },
      mute() {
        setCompanion(previous => (previous ? { ...previous, muted: true } : previous))
      },
      clear() {
        setCompanion(null)
      },
    }
    ;(window as unknown as { __ladyBadge: typeof api }).__ladyBadge = api
  }, [])

  const nameOf = (id: string) => (id === 'hero' ? 'You' : SEATS.find(seat => seat.id === id)?.name ?? 'someone')

  return (
    <div data-layout="2d" style={{ position: 'fixed', inset: 0, background: '#0d1512', color: '#fff', overflow: 'hidden' }}>
      <CompanionToast companion={companion} nameOf={nameOf} yourId="hero" />
      <div style={{ position: 'absolute', inset: '0 0 30% 0' }}>
        {SEATS.map(seat => (
          <div
            key={seat.id}
            style={{ position: 'absolute', left: `${seat.sx}%`, top: `${seat.sy + 20}%`, width: 0, height: 0, '--sx': seat.sx } as CSSProperties}
          >
            <div
              style={{
                position: 'absolute', left: -24, top: -24, width: 48, height: 48, borderRadius: 999,
                background: '#2b3a36', display: 'grid', placeItems: 'center', font: '700 14px system-ui',
              }}
            >
              {seat.name[0]}
            </div>
            <CompanionBadge companion={companion} playerId={seat.id} />
          </div>
        ))}
      </div>
      <div className="mobile-hero-lane" style={{ position: 'absolute', left: 0, right: 0, bottom: 20, height: 120 }}>
        <div style={{ padding: 12, font: '700 14px system-ui' }}>Hero lane</div>
        <CompanionBadge companion={companion} playerId="hero" placement="hero" canMute />
      </div>
      <div style={{ position: 'absolute', bottom: 4, left: 8, fontSize: 11, opacity: 0.6 }}>updates: {counter}</div>
    </div>
  )
}
