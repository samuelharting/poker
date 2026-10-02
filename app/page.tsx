'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  loadStoredPlayerProfile,
  saveStoredPlayerProfile,
  validatePlayerProfile,
  type PlayerProfile,
} from '@/lib/profile'
import { TABLE_ROOM_CODE } from '@/lib/roomCode'
import { LandingHeroArt } from '@/components/ui/LandingHeroArt'
import { NicknameField } from '@/components/ui/NicknameField'

export default function LandingPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<PlayerProfile>({
    nickname: '',
    email: '',
    venmoUsername: '',
  })
  // A returning player gets a one-tap "Sit down as Sam" until they ask to change name.
  const [savedName, setSavedName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const stored = loadStoredPlayerProfile()
    if (stored) {
      setProfile(stored)
      setSavedName(stored.nickname)
    }
  }, [])

  const useSavedName = Boolean(savedName) && !editingName

  const handleEnter = useCallback(() => {
    const result = validatePlayerProfile(profile)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError('')
    saveStoredPlayerProfile(result.profile)
    sessionStorage.setItem('poker_nickname', result.profile.nickname)
    router.push(`/room/${TABLE_ROOM_CODE}`)
  }, [profile, router])

  return (
    <main className="landing-bg">
      <div className="landing-frame">
        <LandingHeroArt />

        <div className="landing-copy">
          <header className="landing-brand">
            <span className="landing-kicker">Private Texas Hold&apos;em</span>
            <h1 className="landing-title">Poker Night</h1>
            <p className="landing-subtitle">
              One table, same crew. Grab a seat, shuffle up.
            </p>
            <ul className="landing-features" aria-label="What's at the table">
              <li><span aria-hidden="true">♠</span>3D table</li>
              <li><span aria-hidden="true">⇄</span>Run it twice</li>
              <li><span aria-hidden="true">♥</span>Drinks</li>
              <li><span aria-hidden="true">$</span>Venmo payouts</li>
            </ul>
          </header>

          <section className="landing-panel-wrap card-panel" aria-label="Take a seat">
            <div className="entry-panel">
              <h2 className="landing-sr-only">Take a seat</h2>

              <NicknameField
                savedName={useSavedName ? savedName : ''}
                value={profile.nickname}
                placeholder="e.g. PhilIvey"
                autoFocus
                onChange={nickname => setProfile(current => ({ ...current, nickname }))}
                onSubmit={handleEnter}
                onChangeName={() => setEditingName(true)}
              />

              {error && (
                <div className="entry-error" role="alert">
                  {error}
                </div>
              )}

              <button
                className="btn-gold entry-submit"
                onClick={handleEnter}
                autoFocus={useSavedName}
              >
                {useSavedName ? `Sit down as ${savedName}` : 'Take a seat'}
              </button>
            </div>

            <p className="landing-footnote">
              <span>Free to play</span>
              <span>Up to 8 seats</span>
              <span>No sign-up</span>
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
