import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoomHud } from '@/components/ui/RoomHud'

describe('RoomHud mobile strip', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders mobile HUD like a poker app header with game type, stakes, menu, and settings', () => {
    vi.stubGlobal('React', React)

    const markup = renderToStaticMarkup(
      <RoomHud
        roomCode="ABCD"
        isConnected={true}
        isHost={true}
        playerCount={6}
        smallBlind={10}
        bigBlind={20}
        phase="in_hand"
        settingsOpen={false}
        onToggleSettings={() => {}}
      />
    )

    const mobileMarkup = markup.slice(
      markup.indexOf('room-hud-mobile-bar'),
      markup.indexOf('room-hud-main')
    )

    expect(mobileMarkup).toContain('room-hud-mobile-menu')
    expect(mobileMarkup).toContain('room-hud-mobile-game-pill')
    expect(mobileMarkup).toContain('NL Hold')
    expect(mobileMarkup).toContain('$10 / $20')
    expect(mobileMarkup).toContain('room-hud-mobile-settings')
    expect(mobileMarkup).not.toContain('Poker Night')
    expect(mobileMarkup).not.toContain('ABCD')
    expect(mobileMarkup).not.toContain('seated')
    expect(mobileMarkup).not.toContain('Host')
    expect(mobileMarkup).not.toContain('Hand live')
    expect(mobileMarkup).not.toContain('Options')
  })
})
