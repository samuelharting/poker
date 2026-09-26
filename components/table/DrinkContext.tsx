'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
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
  isConnected,
  onOrder,
  children,
}: {
  yourId: string
  players: readonly SeatPlayer[]
  events: DrinkEvent[]
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
    nicknames,
    lastOrderAt,
    canOrder,
    order,
  }), [canOrder, events, isConnected, isSeated, lastOrderAt, myDrinks, nicknames, order, profile, yourId])

  return <DrinkContext.Provider value={value}>{children}</DrinkContext.Provider>
}

/** Returns null outside a DrinkProvider so table components stay renderable in isolation. */
export function useDrinks(): DrinkContextValue | null {
  return useContext(DrinkContext)
}
