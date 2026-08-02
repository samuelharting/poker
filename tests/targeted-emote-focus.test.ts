import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const pokerTableSource = readFileSync(
  join(process.cwd(), 'components', 'table', 'PokerTable.tsx'),
  'utf8'
)

describe('targeted emoji keyboard focus', () => {
  it('captures one trigger path for desktop, tablet, and mobile player controls', () => {
    expect(pokerTableSource).toContain('const targetEmoteTriggerRef = useRef<HTMLElement | null>(null)')
    expect(pokerTableSource).toContain('targetEmoteTriggerRef.current = activeElement')
    expect(pokerTableSource).toContain('onSelectPlayer={handleSelectEmoteTarget}')
    expect(pokerTableSource.match(/onNameClick=\{handleSelectEmoteTarget\}/g)).toHaveLength(2)
  })

  it('moves focus into the panel and restores the connected trigger on close', () => {
    expect(pokerTableSource).toContain('role="dialog"')
    expect(pokerTableSource).toContain('ref={closeButtonRef}')
    expect(pokerTableSource).toContain('closeButtonRef.current?.focus({ preventScroll: true })')
    expect(pokerTableSource).toContain('if (trigger?.isConnected)')
    expect(pokerTableSource).toContain('trigger.focus({ preventScroll: true })')
    expect(pokerTableSource).toContain('closeTargetedEmote()')
  })

  it('registers and cleans up Escape dismissal for the whole picker', () => {
    expect(pokerTableSource).toContain("if (event.key !== 'Escape')")
    expect(pokerTableSource).toContain("document.addEventListener('keydown', handleEscape)")
    expect(pokerTableSource).toContain("document.removeEventListener('keydown', handleEscape)")
  })

  it('keeps the compact target card to three recent reactions plus direct messaging', () => {
    expect(pokerTableSource).toContain("'\\uD83D\\uDD95'")
    expect(pokerTableSource).toContain("'\\uD83C\\uDDEE\\uD83C\\uDDF1'")
    expect(pokerTableSource).toContain("'\\uD83D\\uDC12'")
    expect(pokerTableSource).toContain('return next.slice(0, 3)')
    expect(pokerTableSource).toContain('className="targeted-message-compose"')
    expect(pokerTableSource).toContain("'More emojis'")
  })
})
