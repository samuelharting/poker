import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sceneSource = readFileSync(join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'), 'utf8')

describe('desktop 3D dealer marker', () => {
  it('does not render the old white dealer button object in the 3D scene', () => {
    expect(sceneSource).not.toContain('<DealerButton3D')
    expect(sceneSource).not.toContain('function DealerButton3D')
  })
})
