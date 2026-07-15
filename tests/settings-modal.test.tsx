import React, { act } from 'react'
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TableState } from '@/lib/poker/types'

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))

import { SettingsModal } from '@/components/table/PokerTable'

type SettingsModalProps = React.ComponentProps<typeof SettingsModal>

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function makeTableState(overrides: Partial<TableState> = {}): TableState {
  return {
    roomCode: 'ABC123',
    phase: 'between_hands',
    serverNow: 1,
    autoStartEnabled: true,
    autoStartDelay: 3_000,
    round: null,
    players: [],
    communityCards: [],
    pots: [],
    totalPot: 0,
    currentBet: 0,
    minRaise: 40,
    actingPlayerId: null,
    dealerSeatIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1_000,
    actionTimerStart: null,
    actionTimerDuration: 30_000,
    rabbitHuntingEnabled: false,
    sevenTwoRuleEnabled: true,
    sevenTwoBountyPercent: 2,
    handNumber: 1,
    recentActions: [],
    lobbyPlayers: [],
    ...overrides,
  }
}

function makeProps(overrides: Partial<SettingsModalProps> = {}): SettingsModalProps {
  return {
    state: makeTableState(),
    yourId: 'hero',
    isConnected: true,
    suitColorMode: 'two',
    roomCode: 'ABC123',
    canShareRoom: true,
    onClose: vi.fn(),
    onSetSuitColorMode: vi.fn(),
    onUpdateSettings: vi.fn(),
    onRemovePlayer: vi.fn(),
    onAdjustPlayerStack: vi.fn(),
    onSetPlayerSpectator: vi.fn(),
    onCopyRoom: vi.fn(),
    onShareRoom: vi.fn(),
    onFeedback: vi.fn(),
    ...overrides,
  }
}

function nodeText(node: ReactTestInstance): string {
  return node.children
    .map(child => typeof child === 'string' ? child : nodeText(child))
    .join('')
}

function findButton(root: ReactTestInstance, label: string): ReactTestInstance {
  const button = root.findAllByType('button').find(node => nodeText(node).trim() === label)
  if (!button) {
    throw new Error(`Could not find button: ${label}`)
  }
  return button
}

function findInput(root: ReactTestInstance, label: string): ReactTestInstance {
  const field = root.findAllByType('label').find(node => nodeText(node).includes(label))
  if (!field) {
    throw new Error(`Could not find field: ${label}`)
  }
  return field.findByType('input')
}

function findRuleButton(
  root: ReactTestInstance,
  ruleName: string,
  buttonLabel: string
): ReactTestInstance {
  const row = root.findAll(node => node.props.className === 'settings-rule-row')
    .find(node => nodeText(node).includes(ruleName))
  if (!row) {
    throw new Error(`Could not find rule: ${ruleName}`)
  }
  return findButton(row, buttonLabel)
}

let renderer: ReactTestRenderer | null = null

function renderModal(props: SettingsModalProps): ReactTestRenderer {
  act(() => {
    renderer = create(<SettingsModal {...props} />)
  })
  return renderer!
}

afterEach(() => {
  if (renderer) {
    act(() => renderer?.unmount())
    renderer = null
  }
})

describe('SettingsModal', () => {
  it('preserves unsaved numeric edits through rule toggles and resets to the server snapshot', () => {
    const onUpdateSettings = vi.fn()
    const view = renderModal(makeProps({ onUpdateSettings }))

    act(() => {
      findInput(view.root, 'Small blind').props.onChange({ target: { value: '35' } })
    })
    act(() => {
      findRuleButton(view.root, 'Rabbit hunting', 'On').props.onClick()
    })

    expect(findInput(view.root, 'Small blind').props.value).toBe(35)
    expect(findRuleButton(view.root, 'Rabbit hunting', 'On').props['aria-pressed']).toBe(true)
    expect(onUpdateSettings).not.toHaveBeenCalled()

    act(() => {
      findButton(view.root, 'Reset').props.onClick()
    })

    expect(findInput(view.root, 'Small blind').props.value).toBe(10)
    expect(findRuleButton(view.root, 'Rabbit hunting', 'Off').props['aria-pressed']).toBe(true)
    expect(findButton(view.root, 'Save table settings').props.disabled).toBe(true)
    expect(onUpdateSettings).not.toHaveBeenCalled()
  })

  it('submits one atomic payload with every value normalized at save time', () => {
    const onUpdateSettings = vi.fn()
    const view = renderModal(makeProps({ onUpdateSettings }))

    act(() => {
      findInput(view.root, 'Small blind').props.onChange({ target: { value: '25' } })
      findInput(view.root, 'Big blind').props.onChange({ target: { value: '15' } })
      findInput(view.root, 'Starting stack').props.onChange({ target: { value: '100' } })
      findInput(view.root, 'Action timer').props.onChange({ target: { value: '2' } })
      findInput(view.root, 'Next hand delay').props.onChange({ target: { value: '99' } })
    })
    act(() => {
      findRuleButton(view.root, 'Rabbit hunting', 'On').props.onClick()
      findRuleButton(view.root, '7 / 2 rule', 'Off').props.onClick()
      findButton(view.root, 'Customize').props.onClick()
    })
    act(() => {
      findInput(view.root, 'Bounty %').props.onChange({ target: { value: '200' } })
    })

    expect(onUpdateSettings).not.toHaveBeenCalled()

    act(() => {
      findButton(view.root, 'Save table settings').props.onClick()
    })

    expect(onUpdateSettings).toHaveBeenCalledTimes(1)
    expect(onUpdateSettings).toHaveBeenCalledWith({
      smallBlind: 25,
      bigBlind: 25,
      startingStack: 250,
      actionTimerDuration: 5_000,
      autoStartDelay: 30_000,
      rabbitHuntingEnabled: true,
      sevenTwoRuleEnabled: false,
      sevenTwoBountyPercent: 100,
    })
  })

  it('saves live-hand changes for the next hand and shows the queued state', () => {
    const onUpdateSettings = vi.fn()
    const liveState = makeTableState({ phase: 'in_hand' })
    const props = makeProps({ state: liveState, onUpdateSettings })
    const view = renderModal(props)

    act(() => {
      findInput(view.root, 'Small blind').props.onChange({ target: { value: '25' } })
    })

    expect(findButton(view.root, 'Save for next hand').props.disabled).toBe(false)
    expect(nodeText(view.root)).toContain('Save now and changes will apply automatically next hand.')

    act(() => {
      findButton(view.root, 'Save for next hand').props.onClick()
    })
    expect(onUpdateSettings).toHaveBeenCalledOnce()

    act(() => {
      view.update(<SettingsModal
        {...props}
        state={makeTableState({
          phase: 'in_hand',
          pendingTableSettings: {
            smallBlind: 25,
            bigBlind: 25,
            startingStack: 1_000,
            actionTimerDuration: 30_000,
            autoStartDelay: 3_000,
            rabbitHuntingEnabled: false,
            sevenTwoRuleEnabled: true,
            sevenTwoBountyPercent: 2,
          },
        })}
      />)
    })

    expect(findButton(view.root, 'Saved for next hand').props.disabled).toBe(true)
    expect(nodeText(view.root)).toContain('Settings saved. They’ll apply automatically next hand.')
  })

  it('keeps suit controls and both dialog close paths wired with accurate state', () => {
    const onClose = vi.fn()
    const onSetSuitColorMode = vi.fn()
    const props = makeProps({ onClose, onSetSuitColorMode })
    const view = renderModal(props)

    const dialog = view.root.findByProps({ role: 'dialog' })
    expect(dialog.props['aria-modal']).toBe('true')
    expect(dialog.props['aria-labelledby']).toBe('table-settings-dialog-title')
    expect(findButton(view.root, '2-color suits').props['aria-pressed']).toBe(true)
    expect(findButton(view.root, '4-color suits').props['aria-pressed']).toBe(false)

    act(() => {
      findButton(view.root, '4-color suits').props.onClick()
    })
    expect(onSetSuitColorMode).toHaveBeenCalledOnce()
    expect(onSetSuitColorMode).toHaveBeenCalledWith('four')

    act(() => {
      view.update(<SettingsModal {...props} suitColorMode="four" />)
    })
    expect(findButton(view.root, '2-color suits').props['aria-pressed']).toBe(false)
    expect(findButton(view.root, '4-color suits').props['aria-pressed']).toBe(true)

    const stopPropagation = vi.fn()
    act(() => {
      view.root.findByProps({ role: 'dialog' }).props.onClick({ stopPropagation })
    })
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      findButton(view.root, 'Close').props.onClick()
      view.root.findByProps({ className: 'settings-modal-overlay' }).props.onClick()
    })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('updates local sound preferences without saving table settings', () => {
    const onUpdateSettings = vi.fn()
    const onSetSoundMuted = vi.fn()
    const onSetSoundVolume = vi.fn()
    const view = renderModal(makeProps({
      soundMuted: false,
      soundVolume: 0.65,
      onSetSoundMuted,
      onSetSoundVolume,
      onUpdateSettings,
    }))

    expect(findButton(view.root, 'Sound on').props['aria-pressed']).toBe(true)
    expect(findButton(view.root, 'Muted').props['aria-pressed']).toBe(false)
    expect(findInput(view.root, 'Volume').props.value).toBe(65)

    act(() => {
      findButton(view.root, 'Muted').props.onClick()
      findInput(view.root, 'Volume').props.onChange({ target: { value: '25' } })
    })

    expect(onSetSoundMuted).toHaveBeenCalledWith(true)
    expect(onSetSoundVolume).toHaveBeenCalledWith(0.25)
    expect(onUpdateSettings).not.toHaveBeenCalled()
  })
})
