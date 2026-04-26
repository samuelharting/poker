'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  loadStoredPlayerProfile,
  saveStoredPlayerProfile,
  validatePlayerProfile,
  type PlayerProfile,
} from '@/lib/profile'

function generateRoomCode(): string {
  const storageKey = 'poker_room_counter'
  const raw = typeof window === 'undefined' ? '' : window.localStorage.getItem(storageKey)
  const current = raw ? parseInt(raw, 10) : 0
  const next = Number.isFinite(current) && current > 0 ? current + 1 : 1
  window.localStorage.setItem(storageKey, String(next))
  return String(next)
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
  const [showJoinForm, setShowJoinForm] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const stored = loadStoredPlayerProfile()
    if (stored) {
      setCreateProfile(stored)
      setJoinProfile(stored)
    }
  }, [])

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
    const trimmedCode = joinCode.trim()
    const result = validatePlayerProfile(joinProfile)

    if (!trimmedCode || !/^[0-9]+$/.test(trimmedCode)) {
      setError('Please enter a valid room number')
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
    <div className="landing-bg">
      <div className="landing-frame">
        <div className="landing-copy">
          <div className="landing-suits" aria-hidden="true">
            <span className="suit-red">&#x2665;</span>
            <span>&#x2660;</span>
            <span className="suit-red">&#x2666;</span>
            <span>&#x2663;</span>
          </div>
          <div className="landing-kicker">Private Texas Hold'em</div>
          <h1 className="landing-title gold-text">Poker Night</h1>
          <p className="landing-subtitle">
            Start a polished table for friends, then share the room code when seats are ready.
          </p>
          <div className="landing-status-strip" aria-label="Table defaults">
            <span>8 max</span>
            <span>10 / 20 blinds</span>
            <span>Live table</span>
          </div>
          <div className="landing-table-preview" aria-hidden="true">
            <div className="landing-preview-table">
              <span className="landing-preview-pot">$240</span>
              <span className="landing-preview-card landing-preview-card-a" />
              <span className="landing-preview-card landing-preview-card-b" />
              <span className="landing-preview-card landing-preview-card-c" />
              <span className="landing-preview-seat landing-preview-seat-one" />
              <span className="landing-preview-seat landing-preview-seat-two" />
              <span className="landing-preview-seat landing-preview-seat-three" />
            </div>
          </div>
        </div>

        <div className="landing-panel-wrap">
          <div className="landing-mode-toggle" role="tablist" aria-label="Table entry mode">
            <button
              type="button"
              className={!showJoinForm ? 'is-active' : ''}
              onClick={() => { setShowJoinForm(false); setError('') }}
            >
              Create
            </button>
            <button
              type="button"
              className={showJoinForm ? 'is-active' : ''}
              onClick={() => { setShowJoinForm(true); setError('') }}
            >
              Join
            </button>
          </div>

          {error && (
            <div className="entry-error" role="alert">
              {error}
            </div>
          )}

          {!showJoinForm ? (
            <div className="card-panel entry-panel">
              <div className="entry-panel-header">
                <span className="entry-panel-kicker">New table</span>
                <h2>Start a private table</h2>
              </div>

              <label className="entry-field">
                <span>Your nickname</span>
                <input
                  type="text"
                  className="input-dark"
                  placeholder="e.g. PhilIvey"
                  value={createProfile.nickname}
                  onChange={e => setCreateProfile(current => ({ ...current, nickname: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleCreateTable()}
                  maxLength={20}
                  autoComplete="nickname"
                  autoFocus
                  suppressHydrationWarning
                />
              </label>

              <label className="entry-field">
                <span>Email</span>
                <input
                  type="email"
                  className="input-dark"
                  placeholder="you@example.com"
                  value={createProfile.email}
                  onChange={e => setCreateProfile(current => ({ ...current, email: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleCreateTable()}
                  autoComplete="email"
                  suppressHydrationWarning
                />
              </label>

              <label className="entry-field">
                <span>Venmo username</span>
                <input
                  type="text"
                  className="input-dark"
                  placeholder="@samvenmo"
                  value={createProfile.venmoUsername}
                  onChange={e => setCreateProfile(current => ({ ...current, venmoUsername: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleCreateTable()}
                  maxLength={31}
                  autoComplete="username"
                  suppressHydrationWarning
                />
              </label>

              <button className="btn-gold" onClick={handleCreateTable}>
                Create Table
              </button>
            </div>
          ) : (
            <div className="card-panel entry-panel">
              <div className="entry-panel-header">
                <span className="entry-panel-kicker">Existing room</span>
                <h2>Join a table</h2>
              </div>

              <label className="entry-field">
                <span>Room code</span>
                <input
                  type="text"
                  className="input-dark input-room-code"
                  placeholder="1"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.replace(/[^0-9]/g, ''))}
                  maxLength={20}
                  autoFocus
                  suppressHydrationWarning
                />
              </label>

              <label className="entry-field">
                <span>Your nickname</span>
                <input
                  type="text"
                  className="input-dark"
                  placeholder="e.g. DanielN"
                  value={joinProfile.nickname}
                  onChange={e => setJoinProfile(current => ({ ...current, nickname: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleJoinTable()}
                  maxLength={20}
                  autoComplete="nickname"
                  suppressHydrationWarning
                />
              </label>

              <label className="entry-field">
                <span>Email</span>
                <input
                  type="email"
                  className="input-dark"
                  placeholder="you@example.com"
                  value={joinProfile.email}
                  onChange={e => setJoinProfile(current => ({ ...current, email: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleJoinTable()}
                  autoComplete="email"
                  suppressHydrationWarning
                />
              </label>

              <label className="entry-field">
                <span>Venmo username</span>
                <input
                  type="text"
                  className="input-dark"
                  placeholder="@samvenmo"
                  value={joinProfile.venmoUsername}
                  onChange={e => setJoinProfile(current => ({ ...current, venmoUsername: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleJoinTable()}
                  maxLength={31}
                  autoComplete="username"
                  suppressHydrationWarning
                />
              </label>

              <button className="btn-gold" onClick={handleJoinTable}>
                Join Table
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}



