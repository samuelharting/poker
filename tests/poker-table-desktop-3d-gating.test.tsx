import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SocialSnapshot } from '@/shared/protocol'
import type { TableState } from '@/lib/poker/types'

vi.mock('@/components/three/DesktopPokerRoom3D', () => ({
  DesktopPokerRoom3D: () => <div className="desktop-3d-stage" />,
}))

vi.mock('@/components/table/CommunityCards', () => ({
  CommunityCards: () => <div className="community-cards" />,
}))

vi.mock('@/components/table/PotDisplay', () => ({
  PotDisplay: () => <div className="pot-display" />,
}))

import { PokerTable } from '@/components/table/PokerTable'

function makeTableState(): TableState {
  return {
    roomCode: '123',
    phase: 'waiting',
    serverNow: 1,
    round: 'preflop',
    players: [],
    communityCards: [],
    pots: [],
    totalPot: 0,
    currentBet: 0,
    minRaise: 20,
    actingPlayerId: null,
    dealerSeatIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    actionTimerStart: null,
    actionTimerDuration: 30000,
    rabbitHuntingEnabled: true,
    sevenTwoRuleEnabled: false,
    sevenTwoBountyPercent: 0,
    handNumber: 1,
    recentActions: [],
    lobbyPlayers: [],
  }
}

const noop = () => {}

describe('PokerTable desktop 3D gate', () => {
  it('does not render the desktop 3D room before a desktop viewport is confirmed', () => {
    const socialState: SocialSnapshot = {
      active: [],
      chatLog: [],
    }

    const markup = renderToStaticMarkup(
      <PokerTable
        state={makeTableState()}
        socialState={socialState}
        yourId="hero"
        isHost={false}
        isConnected={true}
        startingStackSetting={1000}
        settingsOpen={false}
        suitColorMode="two"
        roomCode="123"
        canShareRoom={false}
        onAction={noop}
        onStartGame={noop}
        onAddBots={noop}
        autoStartEnabled={true}
        onSetAutoStart={noop}
        onUpdateSettings={noop}
        onRemovePlayer={noop}
        onAdjustPlayerStack={noop}
        onSetPlayerSpectator={noop}
        onSetShowCards={noop}
        onSetSuitColorMode={noop}
        onCloseSettings={noop}
        onCopyRoom={noop}
        onShareRoom={noop}
        onSendEmote={noop}
        onSendTargetEmote={noop}
        onFeedback={noop}
      />
    )

    expect(markup).not.toContain('desktop-3d-stage')
  })
})
