'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  loadStoredPlayerProfile,
  saveStoredPlayerProfile,
  validatePlayerProfile,
  type PlayerProfile,
} from '@/lib/profile'
import {
  createRoomCode,
  extractRoomCodeInput,
  isValidRoomCode,
  normalizeRoomCode,
} from '@/lib/roomCode'
import { LandingHeroArt } from '@/components/ui/LandingHeroArt'
import { NicknameField } from '@/components/ui/NicknameField'

function generateRoomCode(): string {
  return createRoomCode()
}

export default function LandingPage() {
  const router = useRouter()
  const [joinCode, setJoinCode] = useState('')
  const [createProfile, setCreateProfile] = useState<PlayerProfile>({
    nickname: '',
    email: '',
    venmoUsername: '',
  })
  const [joinProfile, setJoinProfile] = useState<PlayerProfile>({
    nickname: '',
    email: '',
    venmoUsername: '',
  })
  // A returning player gets a one-tap "Create table as Sam" until they ask to change name.
  const [savedName, setSavedName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [showJoinForm, setShowJoinForm] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const stored = loadStoredPlayerProfile()
    if (stored) {
      setCreateProfile(stored)
      setJoinProfile(stored)
      setSavedName(stored.nickname)
    }
  }, [])

  const useSavedName = Boolean(savedName) && !editingName

  const handleCreateTable = useCallback(() => {
    const result = validatePlayerProfile(createProfile)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError('')
    const code = generateRoomCode()
    saveStoredPlayerProfile(result.profile)
    sessionStorage.setItem('poker_nickname', result.profile.nickname)
    router.push(`/room/${code}`)
  }, [createProfile, router])

  const handleJoinTable = useCallback(() => {
    const trimmedCode = normalizeRoomCode(joinCode)
    const result = validatePlayerProfile(joinProfile)

    if (!isValidRoomCode(trimmedCode)) {
      setError('Please enter a valid room code')
      return
    }
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError('')
    saveStoredPlayerProfile(result.profile)
    sessionStorage.setItem('poker_nickname', result.profile.nickname)
    router.push(`/room/${trimmedCode}`)
  }, [joinCode, joinProfile, router])

  return (
    <main className="landing-bg" data-mode={showJoinForm ? 'join' : 'create'}>
      <div className="landing-frame">
        <LandingHeroArt />

        <div className="landing-copy">
          <header className="landing-brand">
            <span className="landing-kicker">Private Texas Hold&apos;em</span>
            <h1 className="landing-title">Poker Night</h1>
            <p className="landing-subtitle">
              Deal a private table for your crew. Share the code, grab a seat, shuffle up.
            </p>
          </header>

          <section className="landing-panel-wrap card-panel" aria-label="Get a seat">
            <div className="landing-mode-toggle" role="tablist" aria-label="Table entry mode">
              <button
                type="button"
                role="tab"
                id="landing-tab-create"
                aria-selected={!showJoinForm}
                aria-controls="landing-panel-create"
                className={!showJoinForm ? 'is-active' : ''}
                onClick={() => { setShowJoinForm(false); setError('') }}
              >
                Create
              </button>
              <button
                type="button"
                role="tab"
                id="landing-tab-join"
                aria-selected={showJoinForm}
                aria-controls="landing-panel-join"
                className={showJoinForm ? 'is-active' : ''}
                onClick={() => { setShowJoinForm(true); setError('') }}
              >
                Join
              </button>
              <span className="landing-mode-thumb" aria-hidden="true" />
            </div>

            {!showJoinForm ? (
              <div
                className="entry-panel"
                role="tabpanel"
                id="landing-panel-create"
                aria-label="Create a table"
              >
                <h2 className="landing-sr-only">Start a private table</h2>

                <NicknameField
                  savedName={useSavedName ? savedName : ''}
                  value={createProfile.nickname}
                  placeholder="e.g. PhilIvey"
                  autoFocus
                  onChange={nickname => setCreateProfile(current => ({ ...current, nickname }))}
                  onSubmit={handleCreateTable}
                  onChangeName={() => setEditingName(true)}
                />

                {error && (
                  <div className="entry-error" role="alert">
                    {error}
                  </div>
                )}

                <button
                  className="btn-gold entry-submit"
                  onClick={handleCreateTable}
                  autoFocus={useSavedName}
                >
                  {useSavedName ? `Create table as ${savedName}` : 'Create Table'}
                </button>
              </div>
            ) : (
              <div
                className="entry-panel"
                role="tabpanel"
                id="landing-panel-join"
                aria-label="Join a table"
              >
                <h2 className="landing-sr-only">Join a table</h2>

                <div className="entry-field">
                  <label htmlFor="landing-room-code">Room code</label>
                  <input
                    id="landing-room-code"
                    type="text"
                    className="input-dark input-room-code"
                    placeholder="AB23CD"
                    value={joinCode}
                    onChange={e => setJoinCode(extractRoomCodeInput(e.target.value))}
                    onKeyDown={e => e.key === 'Enter' && handleJoinTable()}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    enterKeyHint="go"
                    aria-describedby="landing-room-code-hint"
                    autoFocus
                    suppressHydrationWarning
                  />
                  <p id="landing-room-code-hint" className="entry-hint">
                    Paste the code or the whole room link.
                  </p>
                </div>

                <NicknameField
                  savedName={useSavedName ? savedName : ''}
                  value={joinProfile.nickname}
                  placeholder="e.g. DanielN"
                  onChange={nickname => setJoinProfile(current => ({ ...current, nickname }))}
                  onSubmit={handleJoinTable}
                  onChangeName={() => setEditingName(true)}
                />

                {error && (
                  <div className="entry-error" role="alert">
                    {error}
                  </div>
                )}

                <button className="btn-gold entry-submit" onClick={handleJoinTable}>
                  {useSavedName ? `Join table as ${savedName}` : 'Join Table'}
                </button>
              </div>
            )}

            <p className="landing-footnote">
              <span>Play money</span>
              <span>Up to 8 seats</span>
              <span>No sign-up</span>
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
