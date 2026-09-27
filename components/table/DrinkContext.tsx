'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DRINK_COOLDOWN_MS,
  getDrunkEffectProfile,
  normalizeDrinkState,
  type DrinkEvent,
  type DrinkKind,
  type DrunkEffectProfile,
  type PlayerDrinkState,
} from '@/lib/drinks'
import type { SeatPlayer } from '@/lib/poker/types'

export interface DrinkContextValue {
  yourId: string
  isSeated: boolean
  isConnected: boolean
  myDrinks: PlayerDrinkState
  profile: DrunkEffectProfile
  events: DrinkEvent[]
  /** Server clock minus this device's clock (for server-timed windows like the chaser). */
  serverOffsetMs: number
  nicknames: ReadonlyMap<string, string>
  /** Client-side mirror of the server cooldown so buttons can show it. */
  lastOrderAt: number | null
  canOrder: boolean
  order: (kind: DrinkKind) => void
}

const DrinkContext = createContext<DrinkContextValue | null>(null)

export function DrinkProvider({
  yourId,
  players,
  events,
  serverNow,
  isConnected,
  onOrder,
  children,
}: {
  yourId: string
  players: readonly SeatPlayer[]
  events: DrinkEvent[]
  /** TableState.serverNow from the latest snapshot. */
  serverNow?: number
  isConnected: boolean
  onOrder: (kind: DrinkKind) => void
  children: ReactNode
}) {
  const [lastOrderAt, setLastOrderAt] = useState<number | null>(null)
  const me = players.find(player => player.id === yourId)
  const drinksKey = me?.drinks ? JSON.stringify(me.drinks) : ''
  const myDrinks = useMemo(
    () => normalizeDrinkState(drinksKey ? JSON.parse(drinksKey) : null),
    [drinksKey]
  )
  const profile = useMemo(
    () => getDrunkEffectProfile(myDrinks.level, myDrinks.passedOut),
    [myDrinks.level, myDrinks.passedOut]
  )
  const nicknameKey = JSON.stringify(players.map(player => [player.id, player.nickname]))
  const nicknames = useMemo(
    () => new Map(JSON.parse(nicknameKey) as Array<[string, string]>),
    [nicknameKey]
  )
  const serverOffsetMs = useMemo(
    () => (typeof serverNow === 'number' && serverNow > 0 ? serverNow - Date.now() : 0),
    [serverNow]
  )
  const isSeated = Boolean(me)
  const canOrder = isSeated && isConnected && !myDrinks.passedOut

  const order = useCallback((kind: DrinkKind) => {
    const now = Date.now()
    if (!canOrder || (lastOrderAt !== null && now - lastOrderAt < DRINK_COOLDOWN_MS)) {
      return
    }

    setLastOrderAt(now)
    onOrder(kind)
  }, [canOrder, lastOrderAt, onOrder])

  const value = useMemo<DrinkContextValue>(() => ({
    yourId,
    isSeated,
    isConnected,
    myDrinks,
    profile,
    events,
    serverOffsetMs,
    nicknames,
    lastOrderAt,
    canOrder,
    order,
  }), [canOrder, events, serverOffsetMs, isConnected, isSeated, lastOrderAt, myDrinks, nicknames, order, profile, yourId])

  return <DrinkContext.Provider value={value}>{children}</DrinkContext.Provider>
}

/**
 * Seconds left to chase a shot someone bought you with a water (0 = no
 * chaser window). Ticks while the window is open.
 */
export function useChaserSecondsLeft(): number {
  const drinks = useContext(DrinkContext)
  const until = drinks?.myDrinks.chaserUntil ?? 0
  const offset = drinks?.serverOffsetMs ?? 0
  const passedOut = drinks?.myDrinks.passedOut ?? false
  const [now, setNow] = useState(() => Date.now())
  const remainingMs = until > 0 && !passedOut ? until - (now + offset) : 0
  const open = remainingMs > 0

  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [open])

  useEffect(() => {
    setNow(Date.now())
  }, [until])

  return open ? Math.ceil(remainingMs / 1000) : 0
}

/** Returns null outside a DrinkProvider so table components stay renderable in isolation. */
export function useDrinks(): DrinkContextValue | null {
  return useContext(DrinkContext)
}
