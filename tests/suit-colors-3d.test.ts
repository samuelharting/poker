import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SUIT_INK, getSuitInk, normalizeSuitColorMode } from '@/lib/suitColors'

const fills: Array<{ key: string; color: string }> = []
let currentKey = ''

function fakeCanvas() {
  const context = new Proxy({ fillStyle: '' } as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop === 'fillStyle') return target.fillStyle
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} })
      return () => {}
    },
    set(target, prop: string, value) {
      target[prop] = value
      if (prop === 'fillStyle' && typeof value === 'string') fills.push({ key: currentKey, color: value })
      return true
    },
  })
  return { width: 0, height: 0, getContext: () => context, style: {} }
}

beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => fakeCanvas(),
    documentElement: {},
  })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }))
})
afterAll(() => vi.unstubAllGlobals())

describe('suit color palette', () => {
  it('uses spades black, hearts red, diamonds blue, clubs green in four-color mode', () => {
    const four = SUIT_INK.four
    expect(four.spades).toBe('#111417')
    expect(four.hearts).toBe('#d0202f')
    expect(four.diamonds).toBe('#1f62dd')
    expect(four.clubs).toBe('#12873f')
    expect(new Set(Object.values(four)).size).toBe(4)
  })

  it('keeps two-color mode as black/red pairs', () => {
    expect(getSuitInk('spades', 'two')).toBe(getSuitInk('clubs', 'two'))
    expect(getSuitInk('hearts', 'two')).toBe(getSuitInk('diamonds', 'two'))
    expect(getSuitInk('hearts', 'two')).not.toBe(getSuitInk('spades', 'two'))
  })

  it('normalizes unknown stored values to two-color', () => {
    expect(normalizeSuitColorMode('four')).toBe('four')
    expect(normalizeSuitColorMode('nope')).toBe('two')
    expect(normalizeSuitColorMode(null)).toBe('two')
  })
})

describe('3D card face textures', () => {
  it('caches one texture per suit-color mode with the right ink', async () => {
    const { getCardFaceTexture } = await import('@/components/three/sceneTextures')
    const twoDiamonds = getCardFaceTexture('7', 'diamonds', 'two')
    const fourDiamonds = getCardFaceTexture('7', 'diamonds', 'four')
    expect(fourDiamonds).not.toBe(twoDiamonds)
    expect(getCardFaceTexture('7', 'diamonds', 'four')).toBe(fourDiamonds)
    expect(getCardFaceTexture('7', 'diamonds')).toBe(twoDiamonds)
    expect(twoDiamonds.name).toContain('two')
    expect(fourDiamonds.name).toContain('four')
  })

  it('paints clubs green and diamonds blue only in four-color mode', async () => {
    fills.length = 0
    const { getCardFaceTexture } = await import('@/components/three/sceneTextures')
    getCardFaceTexture('K', 'clubs', 'four')
    getCardFaceTexture('Q', 'diamonds', 'four')
    const colors = new Set(fills.map(item => item.color))
    expect(colors.has(SUIT_INK.four.clubs)).toBe(true)
    expect(colors.has(SUIT_INK.four.diamonds)).toBe(true)
    fills.length = 0
    getCardFaceTexture('K', 'clubs', 'two')
    getCardFaceTexture('Q', 'diamonds', 'two')
    const twoColors = new Set(fills.map(item => item.color))
    expect(twoColors.has(SUIT_INK.four.clubs)).toBe(false)
    expect(twoColors.has(SUIT_INK.four.diamonds)).toBe(false)
  })

  it('swaps every live card texture in place when the mode changes', async () => {
    const { applySuitColorMode, createCardMesh, getActiveSuitMode, setCardFace } = await import('@/components/three/cardMeshes')
    const { getCardFaceTexture } = await import('@/components/three/sceneTextures')
    const boardCard = createCardMesh(0.68)
    const holeCard = createCardMesh(0.4)
    const faceDown = createCardMesh(0.4)
    setCardFace(boardCard, { rank: 'A', suit: 'clubs' }, 'two')
    setCardFace(holeCard, { rank: '9', suit: 'diamonds' }, 'two')
    const before = boardCard.faceMaterial.map

    expect(applySuitColorMode([boardCard, holeCard, faceDown], 'four')).toBe(getActiveSuitMode() === 'four')
    expect(boardCard.faceMaterial.map).toBe(getCardFaceTexture('A', 'clubs', 'four'))
    expect(boardCard.faceMaterial.map).not.toBe(before)
    expect(holeCard.faceMaterial.map).toBe(getCardFaceTexture('9', 'diamonds', 'four'))
    // Face-down cards keep their back and new faces use the active mode.
    expect(faceDown.face).toBeNull()
    setCardFace(faceDown, { rank: '2', suit: 'clubs' })
    expect(faceDown.faceMaterial.map).toBe(getCardFaceTexture('2', 'clubs', 'four'))

    applySuitColorMode([boardCard, holeCard], 'two')
    expect(boardCard.faceMaterial.map).toBe(getCardFaceTexture('A', 'clubs', 'two'))
  })
})

describe('suit color wiring', () => {
  const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8')

  it('hands the setting to the 3D room and applies it without rebuilding the scene', () => {
    expect(read('components', 'table', 'PokerTable.tsx')).toContain('suitColorMode={suitColorMode}')
    const room = read('components', 'three', 'DesktopPokerRoom3D.tsx')
    expect(room).toContain('suitColorMode?: SuitColorMode')
    expect(room).toContain('applySuitColorMode(cards, suitColorMode)')
    expect(room).toMatch(/\[suitColorMode, sceneGeneration\]/)
  })

  it('recolors the DOM card chips too and mirrors the setting on <html>', () => {
    const css = read('app', 'globals.css')
    for (const selector of ['.table-rabbit-card.is-clubs', '.hand-history-card.is-clubs', 'i.is-face.is-diamonds']) {
      expect(css).toContain(selector)
    }
    expect(read('app', 'room', '[code]', 'page.tsx')).toContain('documentElement.dataset.suitColors')
  })
})
