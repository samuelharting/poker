'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import type { TableState } from '@/lib/poker/types'
import type { RoomNotice, SessionEnded } from '@/hooks/useRoom'
import './membership-layer.css'

const NOTICE_LIFETIME_MS = 5_000

const SESSION_COPY: Record<SessionEnded['reason'], { title: string; action: string }> = {
  kicked: { title: 'You were removed from the table', action: 'Rejoin table' },
  replaced: { title: 'Open in another tab', action: 'Play in this tab' },
  name_taken: { title: 'That nickname is taken', action: 'Try again' },
}

export function getNoticeText(notice: RoomNotice, yourId: string): string {
  if (notice.kind === 'host_changed' && notice.playerId && notice.playerId === yourId) {
    return 'You are now the host'
  }
  return notice.message
}

interface MembershipLayerProps {
  tableState: TableState | null
  yourId: string
  isConnected: boolean
  sessionEnded: SessionEnded | null
  notices: RoomNotice[]
  onDismissNotice: (id: string) => void
  onSetSittingOut: (sittingOut: boolean) => void
}

/**
 * Seat-membership feedback that sits above both the 3D and 2D tables:
 * the "your session ended" screen, table notices (new host), and the
 * "Sitting out - I'm back" bar for players benched after missed hands.
 */
export function MembershipLayer({
  tableState,
  yourId,
  isConnected,
  sessionEnded,
  notices,
  onDismissNotice,
  onSetSittingOut,
}: MembershipLayerProps) {
  const latestNotice = notices[notices.length - 1]

  useEffect(() => {
    if (!latestNotice) return
    const timer = window.setTimeout(() => onDismissNotice(latestNotice.id), NOTICE_LIFETIME_MS)
    return () => window.clearTimeout(timer)
  }, [latestNotice, onDismissNotice])

  if (sessionEnded) {
    const copy = SESSION_COPY[sessionEnded.reason]
    return (
      <div className="membership-ended" role="alertdialog" aria-modal="true" aria-labelledby="membership-ended-title">
        <div className="membership-ended-card">
          <h2 id="membership-ended-title">{copy.title}</h2>
          {sessionEnded.message && <p>{sessionEnded.message}</p>}
          <div className="membership-ended-actions">
            <button type="button" className="btn-gold" onClick={() => window.location.reload()}>
              {copy.action}
            </button>
            <Link href="/" className="membership-ended-home">Back to lobby</Link>
          </div>
        </div>
      </div>
    )
  }

  const me = tableState?.players.find(player => player.id === yourId)
  const isSittingOut = Boolean(me?.isAway)

  return (
    <>
      {latestNotice && (
        <div className="membership-notice" role="status" aria-live="polite" key={latestNotice.id}>
          <span className="membership-notice-icon" aria-hidden="true">★</span>
          <span>{getNoticeText(latestNotice, yourId)}</span>
        </div>
      )}
      {isSittingOut && (
        <div className="membership-sitout" role="status" aria-live="polite">
          <span className="membership-sitout-copy">
            <strong>Sitting out</strong>
            <span>You keep your seat and chips but are not dealt in.</span>
          </span>
          <button
            type="button"
            className="btn-gold membership-sitout-back"
            disabled={!isConnected}
            onClick={() => onSetSittingOut(false)}
          >
            I&apos;m back
          </button>
        </div>
      )}
    </>
  )
}
