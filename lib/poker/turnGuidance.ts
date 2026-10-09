import type { BettingRound } from './types'

/**
 * Turn guidance: the words a player sees when action reaches them, and the
 * pre-action ("act in turn") queue they can set while someone else is deciding.
 *
 * Pre-actions stay client side on purpose: the client only ever sends a normal
 * player_action, and only from a snapshot where it is really this player's
 * turn, so the server's own turn/amount validation still guards every action.
 */

type Action = 'fold' | 'check' | 'call' | 'raise' | 'all_in'

export function formatChips(amount: number): string {
  return `$${Math.max(0, Math.round(amount)).toLocaleString()}`
}

// ---------------------------------------------------------------------------
// "Your turn" prompt
// ---------------------------------------------------------------------------

export interface TurnPromptInput {
  round: BettingRound | null
  /** Chips needed to call, already capped at the stack. */
  toCall: number
  /** Chips behind (not counting what is already in front of you). */
  stack: number
  /** What you already have in front of you this street. */
  myBet: number
  currentBet: number
  isSB: boolean
  isBB: boolean
  smallBlind: number
  bigBlind: number
  hasActedThisRound: boolean
}

export interface TurnPrompt {
  kicker: 'Your turn'
  /** One short line: what you face. "$10 to call", "Check or bet". */
  headline: string
  /** Blind context for the first decision of a hand, when it helps. */
  context: string | null
  /** The button that should look like the obvious choice. */
  primary: 'check' | 'call'
  /** Calling puts you all-in. */
  callIsAllIn: boolean
}

export function getTurnPrompt(input: TurnPromptInput): TurnPrompt {
  const toCall = Math.max(0, input.toCall)
  const canCheck = toCall <= 0
  const callIsAllIn = !canCheck && toCall >= input.stack
  const headline = canCheck
    ? input.currentBet > 0 ? 'Check or raise' : 'Check or bet'
    : `${formatChips(toCall)} to call${callIsAllIn ? ' (all-in)' : ''}`

  return {
    kicker: 'Your turn',
    headline,
    context: getBlindContext(input, toCall),
    primary: canCheck ? 'check' : 'call',
    callIsAllIn,
  }
}

function getBlindContext(input: TurnPromptInput, toCall: number): string | null {
  if (input.round !== 'preflop' || input.hasActedThisRound) {
    return null
  }

  if (input.isBB && input.myBet > 0) {
    return toCall <= 0
      ? 'Big blind: you can check'
      : `Big blind: raised to you, ${formatChips(toCall)} more to call`
  }

  if (input.isSB && input.myBet > 0 && toCall > 0) {
    return `You're the small blind: ${formatChips(toCall)} more to call`
  }

  return null
}

/**
 * The one-time beginner tip for a blind's first decision. Null when the
 * player is not facing a blind decision.
 */
export function getBlindTip(input: TurnPromptInput): string | null {
  if (input.round !== 'preflop' || input.hasActedThisRound || input.myBet <= 0) {
    return null
  }

  const toCall = Math.max(0, input.toCall)
  if (input.isSB && !input.isBB) {
    if (toCall <= 0) return null
    return `You posted the small blind (${formatChips(input.myBet)}). Call ${formatChips(toCall)} more to see the flop, or fold.`
  }

  // Facing a raise the prompt's context line already says it all.
  if (input.isBB && toCall <= 0) {
    return `You posted the big blind (${formatChips(input.myBet)}). Nobody raised, so you can check to see the flop for free.`
  }

  return null
}

// ---------------------------------------------------------------------------
// Pre-actions
// ---------------------------------------------------------------------------

export type PreActionKind = 'check_fold' | 'check' | 'call' | 'call_any' | 'fold'

export interface QueuedPreAction {
  kind: PreActionKind
  handNumber: number
  round: BettingRound | null
  /** 'call' only: the exact amount it was locked to. */
  amount?: number
}

export interface PreActionOption {
  kind: PreActionKind
  label: string
  /** Longer name for screen readers and tooltips. */
  description: string
}

/**
 * The chips offered while someone else is acting. Only choices that make
 * sense right now are listed (no "Check" while facing a bet).
 */
export function getPreActionOptions({ toCall, stack }: { toCall: number; stack: number }): PreActionOption[] {
  const owed = Math.max(0, toCall)
  if (owed <= 0) {
    return [
      { kind: 'check_fold', label: 'Check/Fold', description: 'Check if nobody bets, otherwise fold' },
      { kind: 'check', label: 'Check', description: 'Check if nobody bets (cancels if someone bets)' },
      { kind: 'call_any', label: 'Call any', description: 'Check, or call any bet' },
    ]
  }

  const callIsAllIn = owed >= stack
  const options: PreActionOption[] = [
    { kind: 'fold', label: 'Fold', description: 'Fold when it is your turn' },
    {
      kind: 'call',
      label: `Call ${formatChips(owed)}`,
      description: `Call ${formatChips(owed)}${callIsAllIn ? ' (all-in)' : ''} (cancels if the bet changes)`,
    },
  ]
  if (!callIsAllIn) {
    options.push({ kind: 'call_any', label: 'Call any', description: 'Call whatever the bet is when it is your turn' })
  }
  return options
}

/** Whether a chip should light up for the queued pre-action. */
export function isPreActionOptionActive(
  queued: QueuedPreAction | null,
  optionKind: PreActionKind
): boolean {
  if (!queued) return false
  if (queued.kind === optionKind) return true
  // Check/Fold facing a bet will fold: light the Fold chip.
  return queued.kind === 'check_fold' && optionKind === 'fold'
}

export function createPreAction(
  kind: PreActionKind,
  context: { handNumber: number; round: BettingRound | null; toCall: number }
): QueuedPreAction {
  return kind === 'call'
    ? { kind, handNumber: context.handNumber, round: context.round, amount: Math.max(0, context.toCall) }
    : { kind, handNumber: context.handNumber, round: context.round }
}

export type PreActionReconcile =
  | { keep: true }
  | { keep: false; note: string | null }

/**
 * Re-checks a queued pre-action against the latest snapshot. It only survives
 * within the hand and street it was set on, and cancels (with a note) when the
 * bet moves in a way the player did not sign up for.
 */
export function reconcilePreAction(
  queued: QueuedPreAction,
  context: { handNumber: number; round: BettingRound | null; toCall: number; isLive: boolean }
): PreActionReconcile {
  if (!context.isLive || queued.handNumber !== context.handNumber || queued.round !== context.round) {
    return { keep: false, note: null }
  }

  const toCall = Math.max(0, context.toCall)
  if (queued.kind === 'check' && toCall > 0) {
    return { keep: false, note: `Check cancelled: there's a bet, ${formatChips(toCall)} to call` }
  }

  if (queued.kind === 'call' && toCall !== (queued.amount ?? -1)) {
    return {
      keep: false,
      note: `Call ${formatChips(queued.amount ?? 0)} cancelled: the bet changed, ${formatChips(toCall)} to call now`,
    }
  }

  return { keep: true }
}

/**
 * The real action to send once it is this player's turn, or null when the
 * pre-action no longer applies. Never folds when checking is free.
 */
export function resolvePreAction(
  queued: QueuedPreAction,
  context: { handNumber: number; round: BettingRound | null; toCall: number; legalActions: readonly Action[] }
): 'check' | 'call' | 'fold' | null {
  if (queued.handNumber !== context.handNumber || queued.round !== context.round) {
    return null
  }

  const legal = context.legalActions
  const canCheck = legal.includes('check')
  const canCall = legal.includes('call')
  const canFold = legal.includes('fold')

  switch (queued.kind) {
    case 'check_fold':
    case 'fold':
      if (canCheck) return 'check'
      return canFold ? 'fold' : null
    case 'check':
      return canCheck ? 'check' : null
    case 'call':
      return canCall && Math.max(0, context.toCall) === queued.amount ? 'call' : null
    case 'call_any':
      if (canCall) return 'call'
      return canCheck ? 'check' : null
    default:
      return null
  }
}

export function describeAutoAction(action: 'check' | 'call' | 'fold', amount: number): string {
  if (action === 'check') return 'Auto-checked'
  if (action === 'fold') return 'Auto-folded'
  return `Auto-called ${formatChips(amount)}`
}

/** Seconds left on your clock at which the table warns what a timeout will do. */
export const TURN_TIMEOUT_WARNING_SECONDS = 5

/**
 * In the last few seconds of your turn: say what the clock will do for you
 * (check when checking is free, otherwise fold). Null while there is time.
 */
export function getTurnTimeoutWarning(secondsLeft: number, toCall: number): string | null {
  if (secondsLeft > TURN_TIMEOUT_WARNING_SECONDS) return null
  return toCall > 0 ? `Auto-fold in ${secondsLeft}s` : `Auto-check in ${secondsLeft}s`
}
