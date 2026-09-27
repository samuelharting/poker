import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DrinkProvider } from '@/components/table/DrinkContext'
import { DrinkControls } from '@/components/table/DrinkControls'
import { DrinkToasts } from '@/components/table/DrinkToasts'
import { DrunkVisionLayer } from '@/components/table/DrunkVisionLayer'
import { SeatDrinkBadge } from '@/components/table/SeatDrinkBadge'
import { EMPTY_DRINK_STATE, type PlayerDrinkState } from '@/lib/drinks'
import type { SeatPlayer } from '@/lib/poker/types'

function seat(id: string, drinks?: PlayerDrinkState): SeatPlayer {
  return {
    id,
    nickname: id === 'me' ? 'Sam' : 'Mia',
    stack: 1000,
    bet: 0,
    totalInPot: 0,
    status: 'active',
    isDealer: false,
    isSB: false,
    isBB: false,
    hasCards: true,
    showCards: 'none',
    isConnected: true,
    seatIndex: 0,
    hasActedThisRound: false,
    drinks,
  }
}

function drinks(overrides: Partial<PlayerDrinkState> = {}): PlayerDrinkState {
  return { ...EMPTY_DRINK_STATE, ...overrides }
}

function renderWithDrinks(node: React.ReactNode, me: PlayerDrinkState | undefined, seated = true) {
  return renderToStaticMarkup(
    <DrinkProvider
      yourId="me"
      players={seated ? [seat('me', me), seat('other')] : [seat('other')]}
      events={[]}
      isConnected
      onOrder={() => {}}
    >
      {node}
    </DrinkProvider>
  )
}

describe('drink components', () => {
  it('render nothing outside a DrinkProvider so PokerTable stays usable in isolation', () => {
    expect(renderToStaticMarkup(<DrinkControls variant="mobile" />)).toBe('')
    expect(renderToStaticMarkup(<DrinkToasts />)).toBe('')
    expect(renderToStaticMarkup(<DrunkVisionLayer />)).toBe('')
  })

  it('offers beer and water to a seated player and shows their buzz on a meter (no words)', () => {
    const html = renderWithDrinks(<DrinkControls variant="desktop" />, drinks({ level: 4, beers: 4 }))
    expect(html).toContain('Crack a beer (4 so far)')
    expect(html).toContain('Slow water')
    expect(html).toContain('data-tier="tipsy"')
    expect(html).toContain('class="buzz-meter"')
    expect(html).toContain('data-zone="sweet"')
    expect(html).toContain('aria-valuenow="4"')
    expect(html).not.toContain('Tipsy</span>')
    expect(html).not.toContain('disabled')
  })

  it('allows one beer per hand and nudges a sober player toward one', () => {
    const used = renderWithDrinks(<DrinkControls variant="desktop" handNumber={3} />, drinks({ level: 2, beers: 1, beerReadyAtHand: 4 }))
    expect(used).toContain('1/hand')
    expect(used).toContain('One beer per hand')
    const sober = renderWithDrinks(<DrinkControls variant="desktop" handNumber={3} />, drinks({ level: 0.5 }))
    expect(sober).toContain('data-sober-nudge="true"')
    expect(sober).toContain('data-zone="sober"')
  })

  it('hides the controls from players who are not seated', () => {
    expect(renderWithDrinks(<DrinkControls variant="desktop" />, undefined, false)).toBe('')
  })

  it('disables drinking while blacked out, with no text anywhere', () => {
    const passedOut = drinks({ level: 10, beers: 10, passedOut: true })
    const controls = renderWithDrinks(<DrinkControls variant="mobile" />, passedOut)
    expect(controls).toContain('💤')
    expect(controls.match(/disabled=""/g)).toHaveLength(2)

    const vision = renderWithDrinks(<DrunkVisionLayer />, passedOut)
    expect(vision).not.toContain('passed out')
    expect(vision).not.toContain('hic!')
  })


  it('does not count waters on the water button', () => {
    const html = renderWithDrinks(<DrinkControls variant="desktop" />, drinks({ level: 3, beers: 3, waters: 1, sobering: 1 }))
    expect(html).not.toContain('kicking in')
    expect(html).not.toContain('is-sobering')
  })

  it('renders seat badges for other players', () => {
    expect(renderToStaticMarkup(<SeatDrinkBadge drinks={drinks()} nickname="Mia" />)).toBe('')
    const tipsy = renderToStaticMarkup(<SeatDrinkBadge drinks={drinks({ level: 3, beers: 3 })} nickname="Mia" />)
    expect(tipsy).toContain('×3')
    expect(tipsy).not.toContain('data-wobble')
    const wobbly = renderToStaticMarkup(<SeatDrinkBadge drinks={drinks({ level: 5, beers: 6 })} nickname="Mia" />)
    expect(wobbly).toContain('data-wobble="true"')
    const asleep = renderToStaticMarkup(<SeatDrinkBadge drinks={drinks({ level: 10, beers: 10, passedOut: true })} nickname="Mia" />)
    expect(asleep).toContain('💤')
    expect(asleep).toContain('Mia passed out')
  })
})
