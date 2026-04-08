'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

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
  const [nickname, setNickname] = useState('')
  const [joinNickname, setJoinNickname] = useState('')
  const [showJoinForm, setShowJoinForm] = useState(false)
  const [error, setError] = useState('')

  const handleCreateTable = useCallback(() => {
    const trimmed = nickname.trim()
    if (!trimmed) {
      setError('Please enter your nickname')
      return
    }
    setError('')
    const code = generateRoomCode()
    sessionStorage.setItem('poker_nickname', trimmed)
    router.push(`/room/${code}`)
  }, [nickname, router])

  const handleJoinTable = useCallback(() => {
    const trimmedCode = joinCode.trim()
    const trimmedName = joinNickname.trim()

    if (!trimmedCode || !/^[0-9]+$/.test(trimmedCode)) {
      setError('Please enter a valid room number')
      return
    }
    if (!trimmedName) {
      setError('Please enter your nickname')
      return
    }
    setError('')
    sessionStorage.setItem('poker_nickname', trimmedName)
    router.push(`/room/${trimmedCode}`)
  }, [joinCode, joinNickname, router])

  return (
    <div className="landing-bg">
      <div className="w-full max-w-md px-4">
        {/* Header */}
        <div className="text-center mb-12">
          {/* Decorative card suits */}
          <div className="flex justify-center gap-4 mb-6 text-3xl opacity-50">
            <span style={{ color: '#e74c3c' }}>&#x2665;</span>
            <span style={{ color: '#e8e8e8' }}>&#x2660;</span>
            <span style={{ color: '#e74c3c' }}>&#x2666;</span>
            <span style={{ color: '#e8e8e8' }}>&#x2663;</span>
          </div>

          <h1 className="text-5xl font-bold mb-3 gold-text" style={{ fontFamily: 'Georgia, serif' }}>
            Poker Night
          </h1>
          <p className="text-base" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Texas Hold'em · Multiplayer · Real-time
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm text-center"
            style={{ background: 'rgba(192, 57, 43, 0.2)', border: '1px solid rgba(192,57,43,0.4)', color: '#ff8080' }}>
            {error}
          </div>
        )}

        {!showJoinForm ? (
          /* Create Table Panel */
          <div className="card-panel p-8 space-y-5">
            <h2 className="text-xl font-bold text-center" style={{ color: 'rgba(255,255,255,0.85)' }}>
              Start a New Table
            </h2>

            <div className="space-y-3">
              <label className="block text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Your Nickname
              </label>
              <input
                type="text"
                className="input-dark"
                placeholder="e.g. PhilIvey"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateTable()}
                maxLength={20}
                autoFocus
                suppressHydrationWarning
              />
            </div>

            <button className="btn-gold" onClick={handleCreateTable}>
              Create Table
            </button>

            <div className="text-center pt-2">
              <button
                className="text-sm transition-colors"
                style={{ color: 'rgba(255,255,255,0.35)', background: 'none', border: 'none', cursor: 'pointer' }}
                onClick={() => { setShowJoinForm(true); setError('') }}
              >
                Have a room code? Join instead →
              </button>
            </div>
          </div>
        ) : (
          /* Join Table Panel */
          <div className="card-panel p-8 space-y-5">
            <h2 className="text-xl font-bold text-center" style={{ color: 'rgba(255,255,255,0.85)' }}>
              Join a Table
            </h2>

            <div className="space-y-3">
              <label className="block text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Room Code
              </label>
              <input
                type="text"
                className="input-dark text-center font-mono tracking-widest text-lg"
                placeholder="1"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.replace(/[^0-9]/g, ''))}
                maxLength={20}
                autoFocus
                suppressHydrationWarning
              />
            </div>

            <div className="space-y-3">
              <label className="block text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Your Nickname
              </label>
              <input
                type="text"
                className="input-dark"
                placeholder="e.g. DanielN"
                value={joinNickname}
                onChange={e => setJoinNickname(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleJoinTable()}
                maxLength={20}
                suppressHydrationWarning
              />
            </div>

            <button className="btn-gold" onClick={handleJoinTable}>
              Join Table
            </button>

            <div className="text-center pt-2">
              <button
                className="text-sm transition-colors"
                style={{ color: 'rgba(255,255,255,0.35)', background: 'none', border: 'none', cursor: 'pointer' }}
                onClick={() => { setShowJoinForm(false); setError('') }}
              >
                ← Create a new table instead
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Share the room code with friends to play together
        </div>
      </div>
    </div>
  )
}



