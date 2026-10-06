import {
  DEAL_DEFAULT_STEP_SECONDS,
  canDealerDeal,
  getDealFlightSeconds,
  getHoleCardDelay,
  getHoleDealTiming,
} from '@/components/three/dealerDeal'
import { TABLE_SEAT_POSITIONS } from '@/components/three/tableWagerLayout'

/** The bits of a seat the deal timing reads (ThreePlayerView satisfies this). */
export interface DealTimingPlayer {
  id: string
  visualSeat: number
  isDealer: boolean
  isHero: boolean
  isOutOfHand: boolean
  hasCards: boolean
  awayLabel?: string
  drinks?: { passedOut?: boolean } | null
}

/** Base flight of one hole card; the same value the 3D room uses. */
const DEAL_FLIGHT_SECONDS = 0.36

function seatXZ(visualSeat: number): [number, number] {
  const position = TABLE_SEAT_POSITIONS[(visualSeat >= 0 && visualSeat <= 7 ? visualSeat : 0) as keyof typeof TABLE_SEAT_POSITIONS]
  return [position[0], position[2]]
}

/**
 * When (seconds after the cards were dealt) each of the hero's two hole cards
 * lands in the 3D room's deal: the stagger clockwise from the button, the
 * dealer's reach for the deck and the flight over to the hero's seat. The room
 * hides the hero's own seat (the DOM tray stands in for it), so the tray uses
 * these times to show each card when it would have arrived. Mirrors
 * syncSeat/syncPlayers in DesktopPokerRoom3D (same helpers); if the dealer's rig
 * has not loaded the room deals faster, so the tray is at worst a beat late,
 * never early.
 */
export function getHeroHoleCardLandings(players: readonly DealTimingPlayer[]): [number, number] | null {
  const hero = players.find(player => player.isHero && player.hasCards)
  if (!hero) return null
  const dealerSeat = players.find(player => player.isDealer)?.visualSeat ?? -1
  const dealt = players
    .filter(player => player.hasCards)
    .map(player => ({ id: player.id, rank: (player.visualSeat - dealerSeat - 1 + 16) % 8 }))
    .sort((left, right) => left.rank - right.rank)
  const order = dealt.findIndex(entry => entry.id === hero.id)
  if (order < 0) return null

  const dealer = players.find(player => player.isDealer)
  const byHand = Boolean(dealer) && canDealerDeal({
    reducedMotion: false,
    isHero: dealer!.isHero,
    hasRig: true,
    away: Boolean(dealer!.awayLabel),
    passedOut: Boolean(dealer!.drinks?.passedOut),
    folded: dealer!.isOutOfHand,
  })
  const timing = byHand ? getHoleDealTiming(dealt.length, true) : { lead: 0, step: DEAL_DEFAULT_STEP_SECONDS }
  let flight = DEAL_FLIGHT_SECONDS
  if (byHand && dealer) {
    const [dx, dz] = seatXZ(dealer.visualSeat)
    const [hx, hz] = seatXZ(hero.visualSeat)
    flight = getDealFlightSeconds(Math.hypot(hx - dx, hz - dz), DEAL_FLIGHT_SECONDS)
  }
  return [
    getHoleCardDelay(order, 0, dealt.length, timing) + flight,
    getHoleCardDelay(order, 1, dealt.length, timing) + flight,
  ]
}
