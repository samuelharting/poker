import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sceneSource = readFileSync(join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'), 'utf8')
const normalizedSceneSource = sceneSource.replace(/\r\n/g, '\n')

describe('3D opponent nameplate readability', () => {
  it('keeps opponent name and stack text about three times larger than the old compact labels', () => {
    expect(sceneSource).toContain('const opponentLabelFontSize = 0.156')
    expect(sceneSource).toContain('const opponentStackFontSize = 0.138')
    expect(sceneSource).toContain('const opponentNameplateWidth = 1.2')
    expect(sceneSource).toContain('const opponentNameplateHeight = 0.48')
  })

  it('keeps blind roles visible on 3D nameplates and table felt markers', () => {
    expect(sceneSource).toContain('<BlindRoleBadge3D role={player.blindRole} isHero={isHero} />')
    expect(sceneSource).toContain('function BlindMarker3D')
    expect(sceneSource).toContain('<BlindMarker3D player={player} layout={layout} />')
  })

  it('keeps the hero identity out of the old floating 3D nameplate layer', () => {
    expect(normalizedSceneSource).toContain('{!isHero && (\n        <PlayerNameplate')
    expect(normalizedSceneSource).not.toContain('      <PlayerNameplate\n        player={player}')
  })
})
