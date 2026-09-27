import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// A tool once re-saved a UTF-8 file as Windows-1252, turning 🍺 into "ðŸº"
// on screen. Catch double-encoded text anywhere in the shipped source.
const ROOTS = ['app', 'components', 'lib', 'partykit', 'shared', 'hooks']
const MOJIBAKE = /ðŸ|â€|Ã[\u0080-¿]/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(tsx?|css)$/.test(name) ? [full] : []
  })
}

describe('source encoding', () => {
  it('has no double-encoded (mojibake) characters', () => {
    const offenders = ROOTS.flatMap(root => sourceFiles(root))
      .filter(file => MOJIBAKE.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
