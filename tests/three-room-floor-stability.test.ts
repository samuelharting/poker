import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sceneSource = readFileSync(join(process.cwd(), 'components', 'three', 'DesktopPokerRoom3D.tsx'), 'utf8')

describe('3D room floor stability', () => {
  it('keeps the contact-shadow pass lifted off the base floor plane', () => {
    expect(sceneSource).toMatch(/<ContactShadows[^>]*position=\{\[0,\s*0\.012,\s*0\]\}/s)
  })
})
